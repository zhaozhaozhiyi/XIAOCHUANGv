import fs from 'fs'
import path from 'path'

import ffmpeg from 'fluent-ffmpeg'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'

import { toSnakeCaseWithPublicMedia } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import {
  episodeEditRevisions,
  episodes,
  storyboards,
  tasks,
  videoMerges,
} from '../../db/schema'
import { assertLegacyEpisodeProductionAllowed } from '../drama-workspace/continuity-production-gate'
import { getAbsolutePath } from '../images/images.storage'
import { sanitizePayload, toPublicMediaUrl, trimText } from '../images/images.utils'
import { TaskQueueService } from '../queue/task-queue.service'
import { StorageService } from '../storage/storage.service'

const MERGE_VIDEO_CRF = '18'
const MERGE_AUDIO_BITRATE = '256k'

type TimelineClip = {
  storyboard_id: number
  video_generation_id: number
  video_url: string
  transition?: { type?: string | null; boundary_id?: number | null } | null
  audio_policy?: string | null
}

type TimelineDialogueCue = {
  cue_id: number
  dialogue_take_id: number
  audio_url: string
  speaker_name?: string | null
  take_in_ms: number
  take_out_ms: number
  timeline_in_ms: number
  subtitle_segments?: Array<{
    start_ms?: number
    end_ms?: number
    text?: string
  }>
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) return {} as Record<string, unknown>
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function normalizeTimelineClips(value: unknown): TimelineClip[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const storyboardId = Number(record.storyboard_id)
    const generationId = Number(record.video_generation_id)
    const videoUrl = String(record.video_url || '').trim()
    if (!Number.isInteger(storyboardId) || !Number.isInteger(generationId) || !videoUrl) return []
    const transition =
      record.transition && typeof record.transition === 'object' && !Array.isArray(record.transition)
        ? record.transition as TimelineClip['transition']
        : null
    return [{
      storyboard_id: storyboardId,
      video_generation_id: generationId,
      video_url: videoUrl,
      transition,
      audio_policy: String(record.audio_policy || 'mute'),
    }]
  })
}

function normalizeTimelineDialogueCues(value: unknown): TimelineDialogueCue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const cueId = Number(record.cue_id)
    const takeId = Number(record.dialogue_take_id)
    const audioUrl = String(record.audio_url || '').trim()
    const takeInMs = Number(record.take_in_ms)
    const takeOutMs = Number(record.take_out_ms)
    const timelineInMs = Number(record.timeline_in_ms)
    if (
      !Number.isInteger(cueId) ||
      !Number.isInteger(takeId) ||
      !audioUrl ||
      !Number.isInteger(takeInMs) ||
      !Number.isInteger(takeOutMs) ||
      !Number.isInteger(timelineInMs) ||
      takeInMs < 0 ||
      takeOutMs <= takeInMs ||
      timelineInMs < 0
    ) {
      return []
    }
    const subtitleSegments = Array.isArray(record.subtitle_segments)
      ? record.subtitle_segments.flatMap((segment) => {
        if (!segment || typeof segment !== 'object' || Array.isArray(segment)) return []
        const value = segment as Record<string, unknown>
        const startMs = Number(value.start_ms)
        const endMs = Number(value.end_ms)
        const text = String(value.text || '').trim()
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || !text) return []
        return [{ start_ms: startMs, end_ms: endMs, text }]
      })
      : []
    return [{
      cue_id: cueId,
      dialogue_take_id: takeId,
      audio_url: audioUrl,
      speaker_name: typeof record.speaker_name === 'string' ? record.speaker_name : null,
      take_in_ms: takeInMs,
      take_out_ms: takeOutMs,
      timeline_in_ms: timelineInMs,
      subtitle_segments: subtitleSegments,
    }]
  })
}

function keepsOriginalAudio(policy: string | null | undefined) {
  return ['verified_ambience', 'sfx_only', 'music_only'].includes(String(policy || 'mute'))
}

function formatSecondsFromMs(value: number) {
  return Math.max(0, value / 1000).toFixed(3)
}

function formatSrtTimestamp(seconds: number) {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((totalMs % 60_000) / 1000)
  const milliseconds = totalMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

function subtitleFileContent(cues: TimelineDialogueCue[]) {
  const rows: string[] = []
  let index = 1
  for (const cue of cues) {
    for (const segment of cue.subtitle_segments || []) {
      const startMs = cue.timeline_in_ms + Math.max(0, Number(segment.start_ms || 0) - cue.take_in_ms)
      const endMs = cue.timeline_in_ms + Math.max(0, Number(segment.end_ms || 0) - cue.take_in_ms)
      if (endMs <= startMs || !segment.text) continue
      rows.push(
        `${index}\n${formatSrtTimestamp(startMs / 1000)} --> ${formatSrtTimestamp(endMs / 1000)}\n${segment.text}\n`,
      )
      index += 1
    }
  }
  return rows.join('\n')
}

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
      .onConflictDoNothing({
        target: [tasks.domainTable, tasks.domainId],
        where: sql`${tasks.deletedAt} IS NULL`,
      })
      .returning({ id: tasks.id })

    if (created?.id) return created.id

    const [conflicted] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.domainTable, 'video_merges'), eq(tasks.domainId, merge.id), isNull(tasks.deletedAt)))
    if (!conflicted) return null

    await this.databaseService.db
      .update(tasks)
      .set({
        ...values,
        userId: values.userId ?? episode?.userId ?? conflicted.userId ?? null,
        aiConfigId: conflicted.aiConfigId ?? null,
        providerTaskId: merge.taskId ?? conflicted.providerTaskId ?? null,
        attemptCount: conflicted.attemptCount ?? 0,
        payloadJson: args.payload ? sanitizePayload(args.payload) : conflicted.payloadJson ?? null,
        progress: taskStatus === 'completed' ? 100 : taskStatus === 'queued' ? 0 : conflicted.progress ?? null,
        createdAt: conflicted.createdAt ?? createdAt,
        startedAt: taskStatus === 'queued' ? conflicted.startedAt ?? null : conflicted.startedAt ?? updatedAt,
        lockedBy: isTerminal ? null : conflicted.lockedBy ?? null,
        lockedAt: isTerminal ? null : conflicted.lockedAt ?? null,
        lockExpiresAt: isTerminal ? null : conflicted.lockExpiresAt ?? null,
      })
      .where(eq(tasks.id, conflicted.id))

    return conflicted.id
  }

  async enqueueEpisodeMerge(episodeId: number, dramaId: number, userId?: number | null) {
    await assertLegacyEpisodeProductionAllowed(
      this.databaseService,
      episodeId,
      userId,
    )
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

  async enqueueEditRevision(editRevisionId: number, userId: number) {
    const [revision] = await this.databaseService.db
      .select()
      .from(episodeEditRevisions)
      .where(
        and(
          eq(episodeEditRevisions.id, editRevisionId),
          eq(episodeEditRevisions.userId, userId),
          isNull(episodeEditRevisions.deletedAt),
        ),
      )
    if (!revision) throw new Error('episode_edit_revision_not_found')
    if (revision.status !== 'approved') {
      throw new Error('episode_edit_revision_not_approved')
    }

    const timeline = parseJsonObject(revision.timelineJson)
    const clips = normalizeTimelineClips(timeline.clips)
    if (!clips.length) throw new Error('episode_edit_revision_clips_missing')

    const [created] = await this.databaseService.db
      .insert(videoMerges)
      .values({
        userId,
        episodeId: revision.episodeId,
        dramaId: revision.dramaId,
        title: `Episode ${revision.episodeId} Edit ${revision.id}`,
        provider: 'ffmpeg',
        model: 'ffmpeg-timeline-h264-aac',
        status: 'pending',
        scenes: JSON.stringify(clips.map((clip) => clip.video_url)),
        editRevisionId: revision.id,
        createdAt: now(),
      })
      .returning({ id: videoMerges.id })
    const mergeId = created?.id
    if (!mergeId) throw new Error('episode_edit_merge_create_failed')

    await this.databaseService.db
      .update(episodeEditRevisions)
      .set({
        status: 'rendering',
        failureCode: null,
        failureDetail: null,
        updatedAt: now(),
      })
      .where(eq(episodeEditRevisions.id, revision.id))
    const taskId = await this.syncVideoMergeTask({
      mergeId,
      userId,
      payload: {
        episode_id: revision.episodeId,
        drama_id: revision.dramaId,
        edit_revision_id: revision.id,
        clips: clips.map((clip) => ({
          storyboard_id: clip.storyboard_id,
          video_generation_id: clip.video_generation_id,
        })),
      },
    })
    if (taskId != null) await this.taskQueueService.enqueueTask(taskId)
    return mergeId
  }

  async resetEditRevisionRenderForRetry(mergeId: number) {
    const [merge] = await this.databaseService.db
      .select({ editRevisionId: videoMerges.editRevisionId })
      .from(videoMerges)
      .where(eq(videoMerges.id, mergeId))
    if (!merge?.editRevisionId) return
    await this.databaseService.db
      .update(episodeEditRevisions)
      .set({
        status: 'rendering',
        failureCode: null,
        failureDetail: null,
        updatedAt: now(),
      })
      .where(eq(episodeEditRevisions.id, merge.editRevisionId))
  }

  async cancelEditRevisionRender(mergeId: number) {
    const [merge] = await this.databaseService.db
      .select({ editRevisionId: videoMerges.editRevisionId })
      .from(videoMerges)
      .where(eq(videoMerges.id, mergeId))
    if (!merge?.editRevisionId) return
    await this.databaseService.db
      .update(episodeEditRevisions)
      .set({
        status: 'approved',
        failureCode: null,
        failureDetail: null,
        updatedAt: now(),
      })
      .where(eq(episodeEditRevisions.id, merge.editRevisionId))
  }

  async failEditRevisionRender(mergeId: number, detail: string) {
    const [merge] = await this.databaseService.db
      .select({ editRevisionId: videoMerges.editRevisionId })
      .from(videoMerges)
      .where(eq(videoMerges.id, mergeId))
    if (!merge?.editRevisionId) return
    await this.databaseService.db
      .update(episodeEditRevisions)
      .set({
        status: 'failed',
        failureCode: 'timeline_render_failed',
        failureDetail: detail,
        updatedAt: now(),
      })
      .where(eq(episodeEditRevisions.id, merge.editRevisionId))
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
    if (merge.editRevisionId) {
      return this.processEditRevisionMerge(merge)
    }

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

  private async processEditRevisionMerge(merge: typeof videoMerges.$inferSelect) {
    const revisionId = merge.editRevisionId
    if (!revisionId) throw new Error('episode_edit_revision_not_found')
    const [revision] = await this.databaseService.db
      .select()
      .from(episodeEditRevisions)
      .where(eq(episodeEditRevisions.id, revisionId))
    if (!revision || revision.deletedAt) throw new Error('episode_edit_revision_not_found')
    if (!merge.episodeId || !merge.dramaId) {
      throw new Error(`Video merge ${merge.id} missing episode or drama`)
    }

    const timeline = parseJsonObject(revision.timelineJson)
    const clips = normalizeTimelineClips(timeline.clips)
    const dialogueCues = normalizeTimelineDialogueCues(timeline.dialogue_cues)
    if (!clips.length) throw new Error('episode_edit_revision_clips_missing')

    await this.databaseService.db
      .update(videoMerges)
      .set({ status: 'processing', errorMsg: null })
      .where(eq(videoMerges.id, merge.id))
    await this.databaseService.db
      .update(episodeEditRevisions)
      .set({
        status: 'rendering',
        failureCode: null,
        failureDetail: null,
        updatedAt: now(),
      })
      .where(eq(episodeEditRevisions.id, revision.id))
    await this.syncVideoMergeTask({
      mergeId: merge.id,
      userId: merge.userId ?? null,
      payload: {
        episode_id: merge.episodeId,
        drama_id: merge.dramaId,
        edit_revision_id: revision.id,
        clips: clips.map((clip) => ({
          storyboard_id: clip.storyboard_id,
          video_generation_id: clip.video_generation_id,
        })),
      },
    })

    const tempDir = getAbsolutePath(this.storageService, 'temp')
    const outputDir = getAbsolutePath(this.storageService, 'merged')
    fs.mkdirSync(tempDir, { recursive: true })
    fs.mkdirSync(outputDir, { recursive: true })
    const listPath = path.join(tempDir, `${uuid()}.txt`)
    const concatPath = path.join(tempDir, `${uuid()}-timeline.mp4`)
    const outputFilename = `${uuid()}.mp4`
    const outputPath = path.join(outputDir, outputFilename)
    const normalizedPaths: string[] = []
    const dialoguePaths: string[] = []
    let subtitlePath: string | null = null

    try {
      for (const clip of clips) {
        const inputPath = await this.toAbsPath(clip.video_url)
        const sourceHasAudio = await hasAudioStream(inputPath)
        const normalizedPath = path.join(tempDir, `${uuid()}.mp4`)
        await normalizeClipForConcat(
          inputPath,
          normalizedPath,
          sourceHasAudio && keepsOriginalAudio(clip.audio_policy),
        )
        normalizedPaths.push(normalizedPath)
      }

      fs.writeFileSync(
        listPath,
        normalizedPaths.map((video) => `file '${video}'`).join('\n'),
        'utf-8',
      )
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
          .output(concatPath)
          .on('end', () => resolve())
          .on('error', (error) => reject(error))
          .run()
      })

      for (const cue of dialogueCues) {
        dialoguePaths.push(await this.toAbsPath(cue.audio_url))
      }
      const srt = subtitleFileContent(dialogueCues)
      if (srt) {
        subtitlePath = path.join(tempDir, `${uuid()}.srt`)
        fs.writeFileSync(subtitlePath, srt, 'utf-8')
      }

      await new Promise<void>((resolve, reject) => {
        let command = ffmpeg(concatPath)
        for (const dialoguePath of dialoguePaths) {
          command = command.input(dialoguePath)
        }
        const audioFilters = [
          '[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[base_audio]',
        ]
        const mixInputs = ['[base_audio]']
        dialogueCues.forEach((cue, index) => {
          const inputIndex = index + 1
          const outputLabel = `dialogue_${index}`
          audioFilters.push(
            `[${inputIndex}:a:0]atrim=start=${formatSecondsFromMs(cue.take_in_ms)}:end=${formatSecondsFromMs(cue.take_out_ms)},asetpts=PTS-STARTPTS,adelay=${cue.timeline_in_ms}|${cue.timeline_in_ms},aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[${outputLabel}]`,
          )
          mixInputs.push(`[${outputLabel}]`)
        })
        if (mixInputs.length === 1) {
          audioFilters.push('[base_audio]anull[mixed_audio]')
        } else {
          audioFilters.push(
            `${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11[mixed_audio]`,
          )
        }

        let shouldReencodeVideo = false
        if (subtitlePath) {
          const escapedPath = subtitlePath
            .replace(/\\/g, '/')
            .replace(/:/g, '\\:')
            .replace(/'/g, "\\'")
          command = command.videoFilter(
            `subtitles=filename='${escapedPath}':force_style='FontSize=20\\,PrimaryColour=&HFFFFFF&\\,OutlineColour=&H000000&\\,Outline=2'`,
          )
          shouldReencodeVideo = true
        }
        command
          .outputOptions([
            '-map',
            '0:v:0',
            '-filter_complex',
            audioFilters.join(';'),
            '-map',
            '[mixed_audio]',
            '-c:v',
            shouldReencodeVideo ? 'libx264' : 'copy',
            ...(shouldReencodeVideo
              ? ['-preset', 'medium', '-crf', MERGE_VIDEO_CRF]
              : []),
            '-c:a',
            'aac',
            '-ar',
            '48000',
            '-ac',
            '2',
            '-b:a',
            MERGE_AUDIO_BITRATE,
            '-movflags',
            '+faststart',
          ])
          .output(outputPath)
          .on('end', () => resolve())
          .on('error', (error) => reject(error))
          .run()
      })

      const duration = await getVideoDuration(outputPath)
      const buffer = fs.readFileSync(outputPath)
      const storedVideo = await this.storageService.saveBuffer({
        buffer,
        subDir: 'merged',
        fileName: outputFilename,
        extension: '.mp4',
        mimeType: 'video/mp4',
      })
      await this.databaseService.db
        .update(videoMerges)
        .set({
          status: 'completed',
          mergedUrl: storedVideo.url,
          duration,
          completedAt: now(),
        })
        .where(eq(videoMerges.id, merge.id))
      await this.databaseService.db
        .update(episodeEditRevisions)
        .set({
          status: 'completed',
          mergedVideoUrl: storedVideo.url,
          failureCode: null,
          failureDetail: null,
          completedAt: now(),
          updatedAt: now(),
        })
        .where(eq(episodeEditRevisions.id, revision.id))
      await this.databaseService.db
        .update(episodes)
        .set({ videoUrl: storedVideo.url, updatedAt: now() })
        .where(eq(episodes.id, merge.episodeId))
      await this.syncVideoMergeTask({
        mergeId: merge.id,
        userId: merge.userId ?? null,
        payload: {
          episode_id: merge.episodeId,
          drama_id: merge.dramaId,
          edit_revision_id: revision.id,
        },
      })
      return storedVideo.url
    } catch (error) {
      const message = error instanceof Error ? error.message : 'timeline_render_failed'
      const canceled = message.toLowerCase().includes('canceled')
      await this.databaseService.db
        .update(videoMerges)
        .set({
          status: canceled ? 'canceled' : 'failed',
          errorMsg: canceled ? 'Canceled by user' : message,
          completedAt: now(),
        })
        .where(eq(videoMerges.id, merge.id))
      await this.databaseService.db
        .update(episodeEditRevisions)
        .set({
          status: canceled ? 'approved' : 'failed',
          failureCode: canceled ? 'canceled' : 'timeline_render_failed',
          failureDetail: canceled ? 'Canceled by user' : message,
          updatedAt: now(),
        })
        .where(eq(episodeEditRevisions.id, revision.id))
      await this.syncVideoMergeTask({
        mergeId: merge.id,
        userId: merge.userId ?? null,
        payload: {
          episode_id: merge.episodeId,
          drama_id: merge.dramaId,
          edit_revision_id: revision.id,
        },
        errorMessage: canceled ? 'Canceled by user' : message,
      })
      throw error
    } finally {
      for (const file of [
        listPath,
        concatPath,
        subtitlePath,
        outputPath,
        ...normalizedPaths,
      ]) {
        if (file && fs.existsSync(file)) fs.unlinkSync(file)
      }
    }
  }
}
