import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasConcatService } from './canvas-concat.service'

let tempDir = ''

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-concat-test-'))
})

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

describe('CanvasConcatService', () => {
  it('resolves public media URLs through storage before concatenating', async () => {
    const sourcePath = path.join(tempDir, 'shot.mp4')
    fs.writeFileSync(sourcePath, 'video')

    const ensureLocalFile = vi.fn().mockResolvedValue(sourcePath)
    const saveBuffer = vi.fn().mockResolvedValue({ url: 'static/canvas/videos/movie.mp4' })
    const service = new CanvasConcatService({ ensureLocalFile, saveBuffer } as any)

    await expect(
      service.concatVideos(['http://127.0.0.1:3010/static/videos/shot.mp4']),
    ).resolves.toBe('static/canvas/videos/movie.mp4')

    expect(ensureLocalFile).toHaveBeenCalledWith(
      'http://127.0.0.1:3010/static/videos/shot.mp4',
    )
    expect(saveBuffer).toHaveBeenCalledWith(expect.objectContaining({
      subDir: 'canvas/videos',
      extension: 'mp4',
      mimeType: 'video/mp4',
    }))
  })
})
