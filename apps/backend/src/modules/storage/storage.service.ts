import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { Inject, Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { toPublicMediaUrl } from '../../common/media-url'

import type { StorageDownloadResult, StorageSaveBufferParams, StorageWriteResult } from './storage.types'

const LOCAL_STORAGE_PREFIX = 'static/'

function ensureLeadingDot(extension: string | null | undefined) {
  if (!extension) return ''
  return extension.startsWith('.') ? extension : `.${extension}`
}

function detectExtensionFromMimeType(mimeType: string | null | undefined) {
  const map: Record<string, string> = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'audio/mpeg': '.mp3',
    'audio/mp3': '.mp3',
    'audio/wav': '.wav',
    'audio/ogg': '.ogg',
    'video/mp4': '.mp4',
    'video/webm': '.webm',
    'application/json': '.json',
  }
  return map[String(mimeType || '').toLowerCase()] || ''
}

function getExtFromUrl(url: string) {
  try {
    const pathname = new URL(url).pathname
    return path.extname(pathname)
  } catch {
    return ''
  }
}

function sanitizeFileName(rawName: string | null | undefined) {
  const normalized = path.basename(String(rawName || '').trim())
  return normalized.replace(/[^a-zA-Z0-9._() -]/g, '_')
}

@Injectable()
export class StorageService {
  private readonly driver: 'local' | 's3'
  private readonly localRoot: string
  private readonly publicBaseUrl: string | null
  private readonly s3Endpoint: string | null
  private readonly s3Region: string | null
  private readonly s3Bucket: string | null
  private readonly s3AccessKeyId: string | null
  private readonly s3SecretAccessKey: string | null
  private readonly s3ForcePathStyle: boolean

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {
    this.driver = this.configService.get<'local' | 's3'>('STORAGE_DRIVER', 'local')
    this.localRoot = path.resolve(process.cwd(), this.configService.get<string>('STORAGE_LOCAL_PATH', '../data/static'))
    this.publicBaseUrl = String(this.configService.get<string>('STORAGE_PUBLIC_BASE_URL') || '').trim() || null
    this.s3Endpoint = String(this.configService.get<string>('S3_ENDPOINT') || '').trim() || null
    this.s3Region = String(this.configService.get<string>('S3_REGION') || '').trim() || null
    this.s3Bucket = String(this.configService.get<string>('S3_BUCKET') || '').trim() || null
    this.s3AccessKeyId = String(this.configService.get<string>('S3_ACCESS_KEY_ID') || '').trim() || null
    this.s3SecretAccessKey = String(this.configService.get<string>('S3_SECRET_ACCESS_KEY') || '').trim() || null
    this.s3ForcePathStyle = this.configService.get<boolean>('STORAGE_S3_FORCE_PATH_STYLE', true)
  }

  getAbsolutePath(relativePath: string) {
    if (this.isLocalStoragePath(relativePath)) {
      const normalized = relativePath.startsWith('/static/')
        ? relativePath.slice(1)
        : relativePath
      const localRelativePath = normalized.startsWith(LOCAL_STORAGE_PREFIX)
        ? normalized.slice(LOCAL_STORAGE_PREFIX.length)
        : normalized
      return path.resolve(this.localRoot, localRelativePath)
    }

    if (path.isAbsolute(relativePath)) return relativePath
    const normalized = relativePath.startsWith(LOCAL_STORAGE_PREFIX)
      ? relativePath.slice(LOCAL_STORAGE_PREFIX.length)
      : relativePath
    return path.resolve(this.localRoot, normalized)
  }

  isLocalStoragePath(value: string | null | undefined) {
    const raw = String(value || '').trim()
    return raw.startsWith(LOCAL_STORAGE_PREFIX) || raw.startsWith('/static/')
  }

  toPublicUrl(value: string | null | undefined) {
    return toPublicMediaUrl(value, this.publicBaseUrl)
  }

  async saveBuffer(params: StorageSaveBufferParams): Promise<StorageWriteResult> {
    const normalizedExtension = ensureLeadingDot(params.extension) || detectExtensionFromMimeType(params.mimeType)
    const originalName = sanitizeFileName(params.fileName)
    const nameWithoutExt = originalName
      ? originalName.replace(path.extname(originalName), '')
      : crypto.randomUUID()
    const fileName = `${nameWithoutExt || crypto.randomUUID()}${normalizedExtension || '.bin'}`
    const key = `${params.subDir.replace(/^\/+|\/+$/g, '')}/${crypto.randomUUID()}-${fileName}`
    const localPath = this.keyToLocalPath(key)

    if (this.driver === 's3') {
      const url = await this.putObjectToS3(key, params.buffer, params.mimeType)
      this.writeLocalCache(key, params.buffer)
      return {
        key,
        url,
        mimeType: params.mimeType || null,
        size: params.buffer.byteLength,
      }
    }

    this.writeLocalCache(key, params.buffer)
    return {
      key,
      url: this.toPublicUrl(localPath) || localPath,
      mimeType: params.mimeType || null,
      size: params.buffer.byteLength,
    }
  }

  async downloadToStorage(url: string, subDir: string, options?: { headers?: Record<string, string> }) {
    const response = await fetch(url, {
      headers: options?.headers,
      signal: AbortSignal.timeout(120_000),
    })
    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const mimeType = response.headers.get('content-type')
    const result = await this.saveBuffer({
      buffer,
      subDir,
      extension: getExtFromUrl(url),
      mimeType,
    })

    return {
      key: result.key,
      url: result.url,
      mimeType: result.mimeType,
      size: result.size,
    } satisfies StorageDownloadResult
  }

  async ensureLocalFile(input: string) {
    const raw = String(input || '').trim()
    if (!raw) {
      throw new Error('Missing storage path')
    }

    if (path.isAbsolute(raw) && fs.existsSync(raw)) {
      return raw
    }

    if (this.isLocalStoragePath(raw)) {
      const normalized = raw.startsWith('/static/') ? raw.slice(1) : raw
      const absolutePath = this.getAbsolutePath(normalized)
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Local storage file not found: ${normalized}`)
      }
      return absolutePath
    }

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
      const key = this.urlToStorageKey(raw) || this.remoteUrlToCacheKey(raw)
      const cachedAbsolute = this.getAbsolutePath(key)
      if (fs.existsSync(cachedAbsolute)) {
        return cachedAbsolute
      }

      const response = await fetch(raw, {
        signal: AbortSignal.timeout(120_000),
      })
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`)
      }
      const buffer = Buffer.from(await response.arrayBuffer())
      this.writeLocalCache(key, buffer)
      return this.getAbsolutePath(key)
    }

    return this.getAbsolutePath(raw)
  }

  async readBuffer(input: string) {
    const absolutePath = await this.ensureLocalFile(input)
    return fs.readFileSync(absolutePath)
  }

  keyToLocalPath(key: string) {
    return `${LOCAL_STORAGE_PREFIX}${key.replace(/^\/+/, '')}`
  }

  private writeLocalCache(key: string, buffer: Buffer) {
    const localPath = this.keyToLocalPath(key)
    const absolutePath = this.getAbsolutePath(localPath)
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
    fs.writeFileSync(absolutePath, buffer)
    return localPath
  }

  private urlToStorageKey(url: string) {
    if (!this.s3Bucket) return null
    try {
      const parsed = new URL(url)
      const pathName = parsed.pathname.replace(/^\/+/, '')

      if (this.s3ForcePathStyle) {
        if (!pathName.startsWith(`${this.s3Bucket}/`)) return null
        return pathName.slice(this.s3Bucket.length + 1)
      }

      const hostPrefix = parsed.hostname.split('.')[0]
      if (hostPrefix !== this.s3Bucket) return null
      return pathName
    } catch {
      return null
    }
  }

  private remoteUrlToCacheKey(url: string) {
    const ext = getExtFromUrl(url) || '.bin'
    const hash = crypto.createHash('sha256').update(url).digest('hex')
    return `remote-cache/${hash}${ext.startsWith('.') ? ext : `.${ext}`}`
  }

  private async putObjectToS3(key: string, buffer: Buffer, mimeType: string | null | undefined) {
    if (!this.s3Endpoint || !this.s3Bucket || !this.s3AccessKeyId || !this.s3SecretAccessKey) {
      throw new Error('S3 storage is not fully configured')
    }

    const url = this.buildS3ObjectUrl(key)
    const target = new URL(url)
    const payloadHash = crypto.createHash('sha256').update(buffer).digest('hex')
    const timestamp = new Date()
    const amzDate = this.formatAmzDate(timestamp)
    const dateStamp = amzDate.slice(0, 8)
    const canonicalUri = target.pathname
    const canonicalQuery = ''
    const canonicalHeaders = [
      `content-length:${buffer.byteLength}`,
      `content-type:${mimeType || 'application/octet-stream'}`,
      `host:${target.host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
    ].join('\n') + '\n'
    const signedHeaders = 'content-length;content-type;host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = [
      'PUT',
      canonicalUri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const scope = `${dateStamp}/${this.s3Region || 'auto'}/s3/aws4_request`
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n')

    const signingKey = this.getSignatureKey(this.s3SecretAccessKey, dateStamp, this.s3Region || 'auto', 's3')
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.s3AccessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        authorization,
        'content-length': String(buffer.byteLength),
        'content-type': mimeType || 'application/octet-stream',
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
      body: buffer,
      signal: AbortSignal.timeout(120_000),
    })

    if (!response.ok) {
      throw new Error(`S3 upload failed: ${response.status} ${await response.text()}`)
    }

    return this.publicBaseUrl
      ? `${this.publicBaseUrl.replace(/\/+$/, '')}/${key}`
      : url
  }

  private buildS3ObjectUrl(key: string) {
    if (!this.s3Endpoint || !this.s3Bucket) {
      throw new Error('S3 storage is not fully configured')
    }

    const endpoint = new URL(this.s3Endpoint)
    const normalizedKey = key.replace(/^\/+/, '')

    if (this.s3ForcePathStyle) {
      endpoint.pathname = path.posix.join(endpoint.pathname, this.s3Bucket, normalizedKey)
      return endpoint.toString()
    }

    endpoint.hostname = `${this.s3Bucket}.${endpoint.hostname}`
    endpoint.pathname = path.posix.join(endpoint.pathname, normalizedKey)
    return endpoint.toString()
  }

  private formatAmzDate(value: Date) {
    const pad = (input: number) => String(input).padStart(2, '0')
    return [
      value.getUTCFullYear(),
      pad(value.getUTCMonth() + 1),
      pad(value.getUTCDate()),
      'T',
      pad(value.getUTCHours()),
      pad(value.getUTCMinutes()),
      pad(value.getUTCSeconds()),
      'Z',
    ].join('')
  }

  private getSignatureKey(secret: string, dateStamp: string, region: string, service: string) {
    const kDate = crypto.createHmac('sha256', `AWS4${secret}`).update(dateStamp).digest()
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest()
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest()
    return crypto.createHmac('sha256', kService).update('aws4_request').digest()
  }
}
