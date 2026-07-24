import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Inject, Injectable } from '@nestjs/common'
import ffmpeg from 'fluent-ffmpeg'
import { v4 as uuid } from 'uuid'

import { StorageService } from '../storage/storage.service'

function probeDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        resolve(0)
        return
      }
      resolve(Math.max(0, Number(metadata?.format?.duration || 0)))
    })
  })
}

@Injectable()
export class ContinuityTailFrameService {
  constructor(
    @Inject(StorageService) private readonly storageService: StorageService,
  ) {}

  async extractTailFrame(videoUrl: string) {
    const sourcePath = await this.storageService.ensureLocalFile(videoUrl)
    const duration = await probeDuration(sourcePath)
    if (!duration) {
      throw new Error('continuity_tail_frame_duration_unavailable')
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-tail-frame-'))
    const fileName = `${uuid()}.jpg`
    const outputPath = path.join(tempDir, fileName)
    const timestamp = Math.max(0, duration - 0.04)

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(sourcePath)
          .on('end', () => resolve())
          .on('error', (error) => reject(error))
          .screenshots({
            timestamps: [timestamp],
            filename: fileName,
            folder: tempDir,
          })
      })
      if (!fs.existsSync(outputPath)) {
        throw new Error('continuity_tail_frame_not_created')
      }
      return this.storageService.saveBuffer({
        buffer: fs.readFileSync(outputPath),
        subDir: 'continuity-tails',
        fileName,
        extension: '.jpg',
        mimeType: 'image/jpeg',
      })
    } finally {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  async extractFirstFrame(videoUrl: string) {
    const sourcePath = await this.storageService.ensureLocalFile(videoUrl)
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaochuang-first-frame-'))
    const fileName = `${uuid()}.jpg`
    const outputPath = path.join(tempDir, fileName)

    try {
      await new Promise<void>((resolve, reject) => {
        ffmpeg(sourcePath)
          .on('end', () => resolve())
          .on('error', (error) => reject(error))
          .screenshots({
            timestamps: [0],
            filename: fileName,
            folder: tempDir,
          })
      })
      if (!fs.existsSync(outputPath)) {
        throw new Error('continuity_first_frame_not_created')
      }
      return this.storageService.saveBuffer({
        buffer: fs.readFileSync(outputPath),
        subDir: 'continuity-first-frames',
        fileName,
        extension: '.jpg',
        mimeType: 'image/jpeg',
      })
    } finally {
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
      if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
}
