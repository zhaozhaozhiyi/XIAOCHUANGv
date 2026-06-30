import 'reflect-metadata'

import { ConfigService } from '@nestjs/config'
import { NestFactory } from '@nestjs/core'
import type { FastifyRequest } from 'fastify'

import { AppModule } from './app.module'
import { UploadsService } from './modules/uploads/uploads.service'

type SmokeOptions = {
  requireObjectStorage: boolean
  requirePublicFetch: boolean
}

const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wn3n0cAAAAASUVORK5CYII='

function parseArgs(): SmokeOptions {
  const args = new Set(process.argv.slice(2))
  return {
    requireObjectStorage: args.has('--require-object-storage'),
    requirePublicFetch: args.has('--require-public-fetch') || args.has('--require-object-storage'),
  }
}

function isRemoteHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || '').trim())
}

function buildMultipartRequest() {
  const boundary = `----xiaochuang-upload-smoke-${Date.now()}`
  const imageBuffer = Buffer.from(PNG_1X1_BASE64, 'base64')
  const header = Buffer.from(
    `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="smoke.png"\r\n' +
      'Content-Type: image/png\r\n\r\n',
    'utf8',
  )
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')
  const body = Buffer.concat([header, imageBuffer, footer])

  const request = {
    body,
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
  } as FastifyRequest

  return {
    request,
    expectedBytes: imageBuffer,
  }
}

async function main() {
  const options = parseArgs()
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })

  try {
    const configService = app.get(ConfigService)
    const uploadsService = app.get(UploadsService)
    const storageDriver = configService.get<'local' | 's3'>('STORAGE_DRIVER', 'local')
    const publicBaseUrl = configService.get<string>('STORAGE_PUBLIC_BASE_URL') || null
    const { request, expectedBytes } = buildMultipartRequest()
    const uploaded = await uploadsService.uploadImage(request)

    const result: Record<string, unknown> = {
      ok: true,
      storage_driver: storageDriver,
      storage_public_base_url: publicBaseUrl,
      storage_key: uploaded.storage_key,
      url: uploaded.url,
      remote_public_url: isRemoteHttpUrl(uploaded.url),
    }

    if (options.requireObjectStorage && storageDriver !== 's3') {
      throw new Error(`upload smoke requires STORAGE_DRIVER=s3, got ${storageDriver}`)
    }

    if (options.requireObjectStorage && !isRemoteHttpUrl(uploaded.url)) {
      throw new Error(`upload smoke requires remote public url, got ${uploaded.url}`)
    }

    if (options.requirePublicFetch) {
      const response = await fetch(uploaded.url, {
        signal: AbortSignal.timeout(30_000),
      })
      const actualBytes = Buffer.from(await response.arrayBuffer())
      result.public_fetch_status = response.status
      result.public_fetch_ok = response.ok && actualBytes.equals(expectedBytes)

      if (!response.ok) {
        throw new Error(`public fetch failed with status ${response.status}`)
      }

      if (!actualBytes.equals(expectedBytes)) {
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
