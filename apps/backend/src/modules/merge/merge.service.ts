import fs from 'fs'
import path from 'path'

import ffmpeg from 'fluent-ffmpeg'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'

import { toSnakeCaseWithPublicMedia } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import { episodes, storyboards, tasks, videoMerges } from '../../db/schema'
import { getAbsolutePath } from '../images/images.storage'
import { sanitizePayload, toPublicMediaUrl, trimText } from '../images/images.utils'
import { TaskQueueService } from '../queue/task-queue.service'
import { StorageService } from '../storage/storage.service'

const MERGE_VIDEO_CRF = '18'
const MERGE_AUDIO_BITRATE = '256k'

function now() {
  return new Date()
}

async function getVideoDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        resolve(0)
        return
      }
      resolve(Math.round(metadata?.format?.duration || 0))
    })
  })
}

async function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        resolve(1)
        return
      }
      resolve(Math.max(1, metadata?.format?.duration || 1))
    })
  })
}

function writeSilentWav(filePath: string, durationSeconds: number) {
  const sampleRate = 48000
  const channels = 2
  const bytesPerSample = 2
  const samples = Math.max(1, Math.ceil(durationSeconds * sampleRate))
  const dataSize = samples * channels * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(channels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  buffer.writeUInt16LE(channels * bytesPerSample, 32)
  buffer.writeUInt16LE(bytesPerSample * 8, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  fs.writeFileSync(filePath, buffer)
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        resolve(false)
        return
      }
      resolve(Array.isArray(metadata?.streams) && metadata.streams.some((stream) => stream.codec_type === 'audio'))
    })
  })
}

async function normalizeClipForConcat(inputPath: string, outputPath: string, hasAudio: boolean) {
  let silentAudioPath: string | null = null
  const duration = await getMediaDuration(inputPath)

  try {
    if (!hasAudio) {
      silentAudioPath = path.join(path.dirname(outputPath), `${uuid()}.wav`)
      writeSilentWav(silentAudioPath, duration)
    }

    await new Promise<void>((resolve, reject) => {
      let command = ffmpeg(inputPath)
      if (!hasAudio && silentAudioPath) {
        command = command.input(silentAudioPath)
      }

      const outputOptions = hasAudio
        ? [
            '-map', '0:v:0',
            '-map', '0:a:0',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', MERGE_VIDEO_CRF,
            '-af', 'aresample=48000:async=1:first_pts=0',
            '-c:a', 'aac',
            '-ar', '48000',
            '-ac', '2',
            '-b:a', MERGE_AUDIO_BITRATE,
            '-movflags', '+faststart',
          ]
        : [
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-t', duration.toFixed(3),
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', MERGE_VIDEO_CRF,
            '-c:a', 'aac',
            '-ar', '48000',
            '-ac', '2',
            '-b:a', MERGE_AUDIO_BITRATE,
            '-movflags', '+faststart',
          ]

      command
        .outputOptions(outputOptions)
        .output(outputPath)
        .on('end', () => resolve())
        .on('error', (error) => reject(error))
        .run()
    })
  } finally {
    if (silentAudioPath && fs.existsSync(silentAudioPath)) fs.unlinkSync(silentAudioPath)
  }
}

function parseMergeScenes(value: string | null | undefined) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

@Injectable()
export class MergeService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(TaskQueueService) private readonly taskQueueService: TaskQueueService,
  ) {}

  private async toAbsPath(relativePath: string) {
    if (path.isAbsolute(relativePath) && !this.storageService.isLocalStoragePath(relativePath)) {
      return relativePath
    }
    return this.storageService.ensureLocalFile(relativePath)
  }

  private async getEpisodeMergeVideos(episodeId: number) {
    const rows = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(and(eq(storyboards.episodeId, episodeId), isNull(storyboards.deletedAt)))
      .orderBy(storyboards.storyboardNumber)

    const composed = rows.filter((storyboard) => !!storyboard.composedVideoUrl)
    if (composed.length !== rows.length) {
      throw new Error(`Only composed storyboards can be merged (${composed.length}/${rows.length} ready)`)
    }

    const videos = composed
      .map((storyboard) => storyboard.composedVideoUrl)
      .filter((value): value is string => !!value)

    if (!videos.length) throw new Error('No videos to merge')
    return videos
  }

  private async syncVideoMergeTask(args: {
    mergeId: number
    userId?: number | null
    payload?: Record<string, unknown> | null
    errorMessage?: string | null
  }) {
    const [merge] = await this.databaseService.db
      .select()
      .from(videoMerges)
      .where(eq(videoMerges.id, args.mergeId))
    if (!merge) return null

    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.domainTable, 'video_merges'), eq(tasks.domainId, merge.id), isNull(tasks.deletedAt)))

    const taskStatus = String(merge.status || '').toLowerCase() === 'pending'
      ? 'queued'
      : String(merge.status || '').toLowerCase() === 'processing'
        ? 'running'
        : String(merge.status || '').toLowerCase() === 'completed'
          ? 'completed'
          : String(merge.status || '').toLowerCase() === 'failed'
            ? 'failed'
            : String(merge.status || '').toLowerCase() === 'canceled'
              ? 'canceled'
              : 'queued'
    const updatedAt = now()
    const createdAt = merge.createdAt || existing?.createdAt || updatedAt
    const isTerminal = taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'canceled'
    const resultSummary = merge.mergedUrl
      ? JSON.stringify({
          video_url: toPublicMediaUrl(merge.mergedUrl),
          duration: merge.duration ?? null,
        })
      : null
    const errorKind = taskStatus === 'failed' ? 'provider' : taskStatus === 'canceled' ? 'canceled' : null
    const [episode] = merge.episodeId == null
      ? [null]
      : await this.databaseService.db
          .select()
          .from(episodes)
          .where(eq(episodes.id, merge.episodeId))

    const values = {
      userId: args.userId ?? merge.userId ?? existing?.userId ?? null,
      type: 'drama_video' as const,
      status: taskStatus,
      title: trimText(merge.title, 40) || `video_merge_${merge.id}`,
      progress: taskStatus === 'completed' ? 100 : taskStatus === 'queued' ? 0 : existing?.progress ?? null,
      sourceType: 'drama_episode_merge' as const,
      dramaId: merge.dramaId ?? existing?.dramaId ?? null,
      episodeId: merge.episodeId ?? null,
      storyboardId: null,
      aiConfigId: existing?.aiConfigId ?? null,
      domainTable: 'video_merges' as const,
      domainId: merge.id,
      providerTaskId: merge.taskId ?? null,
      attemptCount: existing?.attemptCount ?? 0,
      payloadJson: args.payload ? sanitizePayload(args.payload) : existing?.payloadJson ?? null,
      resultSummaryJson: resultSummary,
      errorKind,
      errorMessage:
        taskStatus === 'failed' || taskStatus === 'canceled'
          ? trimText(args.errorMessage || merge.errorMsg || (taskStatus === 'canceled' ? 'Canceled by user' : 'Task failed'), 240)
          : null,
      errorDetailsJson:
        taskStatus === 'failed' || taskStatus === 'canceled'
          ? JSON.stringify({
              error_kind: errorKind,
              provider: merge.provider || null,
              provider_task_id: merge.taskId || null,
              raw_error: args.errorMessage || merge.errorMsg || null,
            })
          : null,
      createdAt,
      updatedAt,
      startedAt: taskStatus === 'queued' ? existing?.startedAt ?? null : existing?.startedAt ?? updatedAt,
      completedAt: isTerminal ? merge.completedAt || updatedAt : null,
      lockedBy: isTerminal ? null : existing?.lockedBy ?? null,
      lockedAt: isTerminal ? null : existing?.lockedAt ?? null,
      lockExpiresAt: isTerminal ? null : existing?.lockExpiresAt ?? null,
      deletedAt: existing?.deletedAt ?? null,
    }

    if (existing) {
      await this.databaseService.db
        .update(tasks)
        .set(values)
        .where(eq(tasks.id, existing.id))
      return existing.id
    }

    const [created] = await this.databaseService.db
      .insert(tasks)
      .values({
        ...values,
        userId: values.userId ?? episode?.userId ?? null,
      })
      .returning({ id: tasks.id })

    return created?.id ?? null
  }

  async enqueueEpisodeMerge(episodeId: number, dramaId: number, userId?: number | null) {
    const videos = await this.getEpisodeMergeVideos(episodeId)

    const [created] = await this.databaseService.db
      .insert(videoMerges)
      .values({
        userId: userId ?? null,
        episodeId,
        dramaId,
        title: `Episode ${episodeId} Merge`,
        provider: 'ffmpeg',
        model: 'ffmpeg-concat-h264-aac',
        status: 'pending',
        scenes: JSON.stringify(videos),
        createdAt: now(),
      })
      .returning({ id: videoMerges.id })

    const mergeId = created?.id
    if (!mergeId) throw new Error('Failed to create video merge')

    const taskId = await this.syncVideoMergeTask({
      mergeId,
      userId: userId ?? null,
      payload: {
        episode_id: episodeId,
        drama_id: dramaId,
        videos,
      },
    })

    if (taskId != null) {
      await this.taskQueueService.enqueueTask(taskId)
    }

    return mergeId
  }

  async mergeEpisodeVideos(episodeId: number, dramaId: number, userId?: number | null) {
    return this.enqueueEpisodeMerge(episodeId, dramaId, userId)
  }

  async getLatestEpisodeMerge(episodeId: number) {
    const rows = await this.databaseService.db
      .select()
      .from(videoMerges)
      .where(and(eq(videoMerges.episodeId, episodeId), isNull(videoMerges.deletedAt)))
      .orderBy(videoMerges.id)

    const latest = rows.at(-1)
    return latest ? toSnakeCaseWithPublicMedia(latest as unknown as Record<string, unknown>, { urlFields: ['mergedUrl'] }) : null
  }

  async processVideoMerge(mergeId: number) {
    const [merge] = await this.databaseService.db
      .select()
      .from(videoMerges)
      .where(eq(videoMerges.id, mergeId))
    if (!merge) throw new Error(`Video merge ${mergeId} not found`)
    if (String(merge.status || '').toLowerCase() === 'canceled') return
    if (!merge.episodeId || !merge.dramaId) throw new Error(`Video merge ${mergeId} missing episode or drama`)

    const videos = parseMergeScenes(merge.scenes)
    if (!videos.length) throw new Error(`Video merge ${mergeId} has no videos`)

    await this.databaseService.db
      .update(videoMerges)
      .set({ status: 'processing', errorMsg: null })
      .where(eq(videoMerges.id, mergeId))

    await this.syncVideoMergeTask({
      mergeId,
      userId: merge.userId ?? null,
      payload: {
        episode_id: merge.episodeId,
        drama_id: merge.dramaId,
        videos,
      },
    })

    const tempDir = getAbsolutePath(this.storageService, 'temp')
    const outputDir = getAbsolutePath(this.storageService, 'merged')
    fs.mkdirSync(tempDir, { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })

    const listPath = path.join(tempDir, `${uuid()}.txt`)
    const normalizedPaths: string[] = []
    const outputFilename = `${uuid()}.mp4`
    const outputPath = path.join(outputDir, outputFilename)

    try {
      for (const video of videos) {
        const inputPath = await this.toAbsPath(video)
        const clipHasAudio = await hasAudioStream(inputPath)
        const normalizedPath = path.join(tempDir, `${uuid()}.mp4`)
        await normalizeClipForConcat(inputPath, normalizedPath, clipHasAudio)
        normalizedPaths.push(normalizedPath)
      }

      fs.writeFileSync(listPath, normalizedPaths.map((video) => `file '${video}'`).join('\n'), 'utf-8')

      await new Promise<void>((resolve, reject) => {
        ffmpeg()
          .input(listPath)
          .inputOptions(['-f', 'concat', '-safe', '0'])
          .outputOptions([
            '-fflags', '+genpts',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', MERGE_VIDEO_CRF,
            '-af', 'aresample=48000:async=1:first_pts=0',
            '-c:a', 'aac',
            '-ar', '48000',
            '-ac', '2',
            '-b:a', MERGE_AUDIO_BITRATE,
            '-movflags', '+faststart',
          ])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (error) => reject(error))
          .run()
      })

      const duration = await getVideoDuration(outputPath)
      const mergedBuffer = fs.readFileSync(outputPath)
      const storedVideo = await this.storageService.saveBuffer({
        buffer: mergedBuffer,
        subDir: 'merged',
        fileName: outputFilename,
        extension: '.mp4',
        mimeType: 'video/mp4',
      })
      const [latest] = await this.databaseService.db
        .select()
        .from(videoMerges)
        .where(eq(videoMerges.id, mergeId))

      if (!latest || String(latest.status || '').toLowerCase() === 'canceled') {
        await this.syncVideoMergeTask({
          mergeId,
          userId: merge.userId ?? null,
          payload: {
            episode_id: merge.episodeId,
            drama_id: merge.dramaId,
            videos,
          },
          errorMessage: 'Canceled by user',
        })
        throw new Error(`Video merge ${mergeId} canceled`)
      }

      await this.databaseService.db
        .update(videoMerges)
        .set({ status: 'completed', mergedUrl: storedVideo.url, duration, completedAt: now() })
        .where(eq(videoMerges.id, mergeId))
      await this.syncVideoMergeTask({
        mergeId,
        userId: merge.userId ?? null,
        payload: {
          episode_id: merge.episodeId,
          drama_id: merge.dramaId,
          videos,
        },
      })

      await this.databaseService.db
        .update(episodes)
        .set({ videoUrl: storedVideo.url, updatedAt: now() })
        .where(eq(episodes.id, merge.episodeId))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'merge failed'

      if (message.toLowerCase().includes('canceled')) {
        await this.databaseService.db
          .update(videoMerges)
          .set({ status: 'canceled', errorMsg: 'Canceled by user', completedAt: now() })
          .where(eq(videoMerges.id, mergeId))
        await this.syncVideoMergeTask({
          mergeId,
          userId: merge.userId ?? null,
          payload: {
            episode_id: merge.episodeId,
            drama_id: merge.dramaId,
            videos,
          },
          errorMessage: 'Canceled by user',
        })
        throw error
      }

      await this.databaseService.db
        .update(videoMerges)
        .set({ status: 'failed', errorMsg: message, completedAt: now() })
        .where(eq(videoMerges.id, mergeId))
      await this.syncVideoMergeTask({
        mergeId,
        userId: merge.userId ?? null,
        payload: {
          episode_id: merge.episodeId,
          drama_id: merge.dramaId,
          videos,
        },
        errorMessage: message,
      })
      throw error
    } finally {
      if (fs.existsSync(listPath)) fs.unlinkSync(listPath)
      for (const normalizedPath of normalizedPaths) {
        if (fs.existsSync(normalizedPath)) fs.unlinkSync(normalizedPath)
      }
    }
  }
}
