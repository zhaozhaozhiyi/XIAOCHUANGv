import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'

import { StorageService } from '../storage/storage.service'
import { normalizeImageReferenceForAdapter } from './images.storage'

let tempDir = ''

function createStorageService(env: Record<string, unknown>) {
  return new StorageService({
    get: (key: string, fallback?: unknown) => env[key] ?? fallback,
  } as any)
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'images-storage-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('normalizeImageReferenceForAdapter', () => {
  it('inlines an application public URL when local storage is active', async () => {
    const uploadDir = path.join(tempDir, 'uploads')
    fs.mkdirSync(uploadDir, { recursive: true })
    await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 3,
        background: '#2684ff',
      },
    }).jpeg().toFile(path.join(uploadDir, 'reference.jpg'))

    const service = createStorageService({
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_PATH: tempDir,
      STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:3010/static',
    })

    const result = await normalizeImageReferenceForAdapter(
      service,
      'http://127.0.0.1:3010/static/uploads/reference.jpg',
    )

    expect(result).toMatch(/^data:image\/jpeg;base64,/)
  })

  it('keeps a public object URL when S3 storage is active', async () => {
    const service = createStorageService({
      STORAGE_DRIVER: 's3',
      STORAGE_LOCAL_PATH: tempDir,
      STORAGE_PUBLIC_BASE_URL: 'https://media.example.com/xiaochuang-media',
    })
    const url = 'https://media.example.com/xiaochuang-media/uploads/reference.jpg'

    await expect(normalizeImageReferenceForAdapter(service, url)).resolves.toBe(url)
  })

  it('converts a cached storage path to its public object URL for S3', async () => {
    const service = createStorageService({
      STORAGE_DRIVER: 's3',
      STORAGE_LOCAL_PATH: tempDir,
      STORAGE_PUBLIC_BASE_URL: 'https://media.example.com/xiaochuang-media',
    })

    await expect(
      normalizeImageReferenceForAdapter(service, 'static/uploads/reference.jpg'),
    ).resolves.toBe('https://media.example.com/xiaochuang-media/uploads/reference.jpg')
  })
})
