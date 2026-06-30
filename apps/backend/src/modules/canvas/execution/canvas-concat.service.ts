import fs from 'fs'
import os from 'os'
import path from 'path'

import ffmpeg from 'fluent-ffmpeg'
import { Inject, Injectable } from '@nestjs/common'
import { v4 as uuid } from 'uuid'

import { StorageService } from '../../storage/storage.service'
import { downloadFile } from '../../images/images.storage'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function resolveLocalPath(storageService: StorageService, url: string, subDir: string): Promise<string> {
  if (storageService.isLocalStoragePath(url)) {
    return storageService.ensureLocalFile(url)
  }
  const stored = await downloadFile(storageService, url, subDir)
  return storageService.ensureLocalFile(stored.url)
}

async function concatVideoFiles(inputPaths: string[], outputPath: string): Promise<void> {
  if (inputPaths.length === 1) {
    fs.copyFileSync(inputPaths[0], outputPath)
    return
  }

  const listPath = path.join(path.dirname(outputPath), `${uuid()}.txt`)
  const listContent = inputPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n')
  fs.writeFileSync(listPath, listContent)

  try {
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(listPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .outputOptions(['-c', 'copy', '-movflags', '+faststart'])
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (err) => reject(err))
        .run()
    })
  } finally {
    fs.unlinkSync(listPath)
  }
}

@Injectable()
export class CanvasConcatService {
  constructor(@Inject(StorageService) private readonly storageService: StorageService) {}

  async concatVideos(videoUrls: string[]): Promise<string> {
    if (!videoUrls.length) throw new Error('concat requires at least one video input')

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-concat-'))
    const localPaths: string[] = []

    try {
      for (let i = 0; i < videoUrls.length; i++) {
        localPaths.push(await resolveLocalPath(this.storageService, videoUrls[i], 'videos'))
      }

      const outputPath = path.join(workDir, `${uuid()}.mp4`)
      await concatVideoFiles(localPaths, outputPath)

      const buffer = fs.readFileSync(outputPath)
      const stored = await this.storageService.saveBuffer({
        buffer,
        subDir: 'canvas/videos',
        extension: 'mp4',
        mimeType: 'video/mp4',
      })
      return stored.url
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
    }
  }
}

export async function waitForRecordStatus<T extends { status?: string | null }>(
  load: () => Promise<T | undefined>,
  opts: {
    isDone: (row: T) => boolean
    isFailed: (row: T) => boolean
    getError?: (row: T) => string | undefined
    timeoutMs?: number
    intervalMs?: number
  },
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 600_000
  const intervalMs = opts.intervalMs ?? 2_000
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    const row = await load()
    if (!row) throw new Error('record_not_found')
    if (opts.isDone(row)) return row
    if (opts.isFailed(row)) throw new Error(opts.getError?.(row) || 'generation_failed')
    await sleep(intervalMs)
  }

  throw new Error('generation_timeout')
}
