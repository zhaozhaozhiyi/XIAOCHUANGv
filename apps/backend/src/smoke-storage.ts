import 'reflect-metadata'

import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'
import { StorageService } from './modules/storage/storage.service'

type SmokeOptions = {
  requireObjectStorage: boolean
  requirePublicFetch: boolean
  subDir: string
}

function parseArgs(): SmokeOptions {
  const args = new Set(process.argv.slice(2))
  const getValue = (flag: string, fallback: string) => {
    const prefix = `${flag}=`
    const value = process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
    return value?.trim() || fallback
  }

  return {
    requireObjectStorage: args.has('--require-object-storage'),
    requirePublicFetch: args.has('--require-public-fetch') || args.has('--require-object-storage'),
    subDir: getValue('--sub-dir', 'storage-smoke'),
  }
}

function isRemoteHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || '').trim())
}

async function main() {
  const options = parseArgs()
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })

  try {
    const configService = app.get(ConfigService)
    const storageService = app.get(StorageService)

    const storageDriver = configService.get<'local' | 's3'>('STORAGE_DRIVER', 'local')
    const publicBaseUrl = configService.get<string>('STORAGE_PUBLIC_BASE_URL') || null
    const payload = `xiaochuang-storage-smoke:${Date.now()}`
    const saved = await storageService.saveBuffer({
      buffer: Buffer.from(payload, 'utf8'),
      subDir: options.subDir,
      fileName: 'smoke.txt',
      extension: '.txt',
      mimeType: 'text/plain',
    })

    const result: Record<string, unknown> = {
      ok: true,
      storage_driver: storageDriver,
      storage_public_base_url: publicBaseUrl,
      key: saved.key,
      url: saved.url,
      mime_type: saved.mimeType,
      size: saved.size,
      remote_public_url: isRemoteHttpUrl(saved.url),
    }

    if (options.requireObjectStorage && storageDriver !== 's3') {
      throw new Error(`storage smoke requires STORAGE_DRIVER=s3, got ${storageDriver}`)
    }

    if (options.requireObjectStorage && !isRemoteHttpUrl(saved.url)) {
      throw new Error(`storage smoke requires remote public url, got ${saved.url}`)
    }

    if (options.requirePublicFetch) {
      const response = await fetch(saved.url, {
        signal: AbortSignal.timeout(30_000),
      })
      const text = await response.text()
      result.public_fetch_status = response.status
      result.public_fetch_ok = response.ok && text === payload

      if (!response.ok) {
        throw new Error(`public fetch failed with status ${response.status}`)
      }

      if (text !== payload) {
        throw new Error('public fetch content mismatch')
      }
    }

    console.log(JSON.stringify(result, null, 2))
  } finally {
    await app.close()
  }
}

void main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2))
  process.exitCode = 1
})
