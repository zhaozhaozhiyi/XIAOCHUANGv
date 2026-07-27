import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { StorageService } from './storage.service'

let tempDir = ''

function createStorageService(env: Record<string, unknown> = {}) {
  return new StorageService({
    get: (key: string, fallback?: unknown) => env[key] ?? fallback,
  } as any)
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'storage-service-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('StorageService remote URL hardening', () => {
  it('resolves the configured public media URL to its local storage file', async () => {
    const videoDir = path.join(tempDir, 'videos')
    const videoPath = path.join(videoDir, 'shot.mp4')
    fs.mkdirSync(videoDir, { recursive: true })
    fs.writeFileSync(videoPath, 'video')
    const service = createStorageService({
      STORAGE_DRIVER: 'local',
      STORAGE_LOCAL_PATH: tempDir,
      STORAGE_PUBLIC_BASE_URL: 'http://127.0.0.1:3010/static',
    })

    await expect(
      service.ensureLocalFile('http://127.0.0.1:3010/static/videos/shot.mp4'),
    ).resolves.toBe(videoPath)
  })

  it('rejects localhost remote downloads', async () => {
    const service = createStorageService({ STORAGE_LOCAL_PATH: tempDir })

    await expect(service.ensureLocalFile('http://127.0.0.1:3010/static/a.png')).rejects.toThrow('private address')
    await expect(service.ensureLocalFile('http://localhost:3010/static/a.png')).rejects.toThrow('not allowed')
  })

  it('rejects non-allowlisted remote hosts when an allowlist is configured', async () => {
    const service = createStorageService({
      STORAGE_LOCAL_PATH: tempDir,
      STORAGE_REMOTE_URL_ALLOWLIST: 'media.example.com',
    })

    await expect(service.downloadToStorage('https://example.org/a.png', 'images')).rejects.toThrow('not allowlisted')
  })
})
