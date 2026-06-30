import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

import ffmpeg from 'fluent-ffmpeg'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { v4 as uuid } from 'uuid'

import { toPublicMediaUrl } from '../../common/media-url'
import { DatabaseService } from '../../db/database.service'
import { characters, dramas, episodes, storyboards, tasks } from '../../db/schema'
import { AudioService } from '../audio/audio.service'
import { getStoryboardTtsDialogue, isNarratorSpeaker, parseDialogueForTTS } from '../audio/audio.dialogue'
import { readProjectDefaults, resolveProjectConfigId } from '../dramas/drama-metadata'
import { getAbsolutePath } from '../images/images.storage'
import { TaskQueueService } from '../queue/task-queue.service'
import { StorageService } from '../storage/storage.service'

const AUDIO_TAIL_PADDING_SECONDS = 0.35
const AUDIO_FADE_SECONDS = 0.12
const VIDEO_EXTEND_EPSILON_SECONDS = 0.05

function now() {
  return new Date()
}

function trimText(value: unknown, maxLength: number) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= maxLength) return text
  if (maxLength <= 3) return text.slice(0, maxLength)
  return `${text.slice(0, maxLength - 3)}...`
}

function sanitizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return null
  const cleanEntries = Object.entries(payload).filter(([, value]) => value !== undefined)
  if (!cleanEntries.length) return null
  return JSON.stringify(Object.fromEntries(cleanEntries))
}

function formatSeconds(seconds: number) {
  return Math.max(0, seconds).toFixed(3)
}

function formatSrtTimestamp(seconds: number) {
  const totalMs = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const wholeSeconds = Math.floor((totalMs % 60_000) / 1000)
  const milliseconds = totalMs % 1000

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    String(wholeSeconds).padStart(2, '0'),
  ].join(':') + `,${String(milliseconds).padStart(3, '0')}`
}

function subtitleContent(text: string, durationSeconds: number) {
  const endAt = Math.max(0.8, durationSeconds - 0.2)
  return `1\n00:00:00,500 --> ${formatSrtTimestamp(endAt)}\n${text}\n`
}

function audioFiltersForDuration(durationSeconds: number) {
  const fadeDuration = Math.min(AUDIO_FADE_SECONDS, Math.max(0.02, durationSeconds / 4))
  const fadeOutStart = Math.max(0, durationSeconds - fadeDuration)

  return [
    'aresample=48000',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
    'apad',
    `afade=t=in:st=0:d=${formatSeconds(fadeDuration)}`,
    `afade=t=out:st=${formatSeconds(fadeOutStart)}:d=${formatSeconds(fadeDuration)}`,
  ].join(',')
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

function shouldGenerateDialogueAudio() {
  return String(process.env.STORYBOARD_COMPOSE_TTS || '1').trim() !== '0'
}

function supportsSubtitleFilter() {
  try {
    const output = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' })
    return /\bsubtitles\b/.test(output)
  } catch {
    return false
  }
}

async function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (error, metadata: any) => {
      if (error) {
        resolve(1)
        return
      }
      resolve(Math.max(1, metadata?.format?.duration || 1))
    })
  })
}

async function hasAudioStream(filePath: string): Promise<boolean> {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (error, metadata: any) => {
      if (error) {
        resolve(false)
        return
      }
      resolve(Array.isArray(metadata?.streams) && metadata.streams.some((stream: any) => stream.codec_type === 'audio'))
    })
  })
}

@Injectable()
export class ComposeService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AudioService) private readonly audioService: AudioService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(TaskQueueService) private readonly taskQueueService: TaskQueueService,
  ) {}

  private async toAbsPath(relativePath: string) {
    if (path.isAbsolute(relativePath) && !this.storageService.isLocalStoragePath(relativePath)) {
      return relativePath
    }
    return this.storageService.ensureLocalFile(relativePath)
  }

  private async syncStoryboardComposeTask(args: {
    storyboardId: number
    userId?: number | null
    payload?: Record<string, unknown> | null
    status?: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
    errorMessage?: string | null
  }) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, args.storyboardId))
    if (!storyboard) return null

    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(eq(episodes.id, storyboard.episodeId))

    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.domainTable, 'storyboard_compose'), eq(tasks.domainId, storyboard.id), isNull(tasks.deletedAt)))

    const taskStatus = args.status
      || (storyboard.status === 'compose_failed'
        ? 'failed'
        : storyboard.status === 'compose_canceled'
          ? 'canceled'
          : storyboard.composedVideoUrl
            ? 'completed'
            : storyboard.status === 'compose_processing'
              ? 'running'
              : 'queued')
    const isTerminal = taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'canceled'
    const updatedAt = now()
    const createdAt = existing?.createdAt || updatedAt
    const title = trimText(storyboard.title || storyboard.description, 40) || `storyboard_compose_${storyboard.id}`

    const resultSummary = storyboard.composedVideoUrl
      ? JSON.stringify({
          video_url: toPublicMediaUrl(storyboard.composedVideoUrl),
          duration: storyboard.duration ?? null,
        })
      : null

    const values = {
      userId: args.userId ?? storyboard.userId ?? episode?.userId ?? existing?.userId ?? null,
      type: 'drama_video' as const,
      status: taskStatus,
      title,
      progress: taskStatus === 'completed' ? 100 : taskStatus === 'queued' ? 0 : existing?.progress ?? null,
      sourceType: 'drama_storyboard_compose' as const,
      dramaId: episode?.dramaId ?? existing?.dramaId ?? null,
      episodeId: storyboard.episodeId,
      storyboardId: storyboard.id,
      aiConfigId: existing?.aiConfigId ?? null,
      domainTable: 'storyboard_compose' as const,
      domainId: storyboard.id,
      providerTaskId: existing?.providerTaskId ?? null,
      attemptCount: existing?.attemptCount ?? 0,
      payloadJson: args.payload ? sanitizePayload(args.payload) : existing?.payloadJson ?? null,
      resultSummaryJson: resultSummary,
      errorKind: taskStatus === 'failed' ? 'provider' : taskStatus === 'canceled' ? 'canceled' : null,
      errorMessage:
        taskStatus === 'failed' || taskStatus === 'canceled'
          ? trimText(args.errorMessage || (taskStatus === 'canceled' ? 'Canceled by user' : '视频合成失败'), 240)
          : null,
      errorDetailsJson:
        taskStatus === 'failed' || taskStatus === 'canceled'
          ? JSON.stringify({
              error_kind: taskStatus === 'canceled' ? 'canceled' : 'provider',
              raw_error: args.errorMessage || null,
            })
          : null,
      createdAt,
      updatedAt,
      startedAt: taskStatus === 'queued' ? existing?.startedAt ?? null : existing?.startedAt ?? updatedAt,
      completedAt: isTerminal ? updatedAt : null,
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
      .values(values)
      .returning({ id: tasks.id })

    return created?.id ?? null
  }

  async composeStoryboard(storyboardId: number): Promise<string> {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, storyboardId))
    if (!storyboard) throw new Error(`Storyboard ${storyboardId} not found`)
    if (!storyboard.videoUrl) throw new Error(`Storyboard ${storyboardId} has no video`)
    if (storyboard.status === 'compose_canceled') throw new Error(`Storyboard ${storyboardId} compose canceled`)

    await this.databaseService.db
      .update(storyboards)
      .set({ status: 'compose_processing', composedVideoUrl: null, updatedAt: now() })
      .where(eq(storyboards.id, storyboardId))
    await this.syncStoryboardComposeTask({
      storyboardId,
      userId: storyboard.userId ?? null,
      payload: {
        storyboard_id: storyboardId,
        episode_id: storyboard.episodeId,
      },
      status: 'running',
    })

    const videoPath = await this.toAbsPath(storyboard.videoUrl)
    let audioPath: string | null = null
    let subtitlePath: string | null = null
    let subtitleUrl: string | null = null
    let subtitleFilename: string | null = null
    let ttsSkipped = false
    const useDialogueAudio = shouldGenerateDialogueAudio()
    const parsedDialogue = parseDialogueForTTS(getStoryboardTtsDialogue(storyboard))

    try {
      if (useDialogueAudio && !parsedDialogue.ignorable) {
        if (storyboard.ttsAudioUrl) {
          const existingAudioPath = await this.toAbsPath(storyboard.ttsAudioUrl)
          if (fs.existsSync(existingAudioPath)) audioPath = existingAudioPath
        }

        if (!audioPath && parsedDialogue.pureText) {
          let voiceId = 'alloy'
          const [episode] = await this.databaseService.db
            .select()
            .from(episodes)
            .where(eq(episodes.id, storyboard.episodeId))
          const [drama] = episode?.dramaId == null
            ? [null]
            : await this.databaseService.db
                .select()
                .from(dramas)
                .where(eq(dramas.id, episode.dramaId))
          const projectDefaults = readProjectDefaults(drama?.metadata)
          if (projectDefaults.lead_voice_id) {
            voiceId = projectDefaults.lead_voice_id
          }

          if (parsedDialogue.speaker && !isNarratorSpeaker(parsedDialogue.speaker) && episode) {
            const rows = await this.databaseService.db
              .select()
              .from(characters)
              .where(eq(characters.dramaId, episode.dramaId))
            const matched = rows.find((row) => row.name === parsedDialogue.speaker)
            if (matched?.voiceStyle) voiceId = matched.voiceStyle
          }

          try {
            const generated = await this.audioService.generateTTS({
              text: parsedDialogue.pureText,
              voice: voiceId,
              configId: episode?.audioConfigId ?? resolveProjectConfigId(drama?.metadata, 'audio') ?? null,
            })
            audioPath = await this.toAbsPath(generated.url)
            await this.databaseService.db
              .update(storyboards)
              .set({ ttsAudioUrl: generated.url, updatedAt: now() })
              .where(eq(storyboards.id, storyboardId))
          } catch {
            ttsSkipped = true
          }
        }
      }

      if (useDialogueAudio && !parsedDialogue.ignorable && !ttsSkipped && parsedDialogue.pureText) {
        const subtitleDir = getAbsolutePath(this.storageService, 'subtitles')
        fs.mkdirSync(subtitleDir, { recursive: true })
        subtitleFilename = `${uuid()}.srt`
        subtitlePath = path.join(subtitleDir, subtitleFilename)
        fs.writeFileSync(subtitlePath, subtitleContent(parsedDialogue.pureText, storyboard.duration || 10), 'utf-8')

      }

      const outputDir = getAbsolutePath(this.storageService, 'composed')
      fs.mkdirSync(outputDir, { recursive: true })
      const outputFilename = `${uuid()}.mp4`
      const outputPath = path.join(outputDir, outputFilename)
      let silentAudioPath: string | null = null

      try {
        const videoDuration = await getMediaDuration(videoPath)
        const sourceHasAudio = await hasAudioStream(videoPath)
        const audioDuration = audioPath ? await getMediaDuration(audioPath) : 0
        const targetDuration = audioPath
          ? Math.max(videoDuration, audioDuration + AUDIO_TAIL_PADDING_SECONDS)
          : videoDuration
        const videoExtendDuration = Math.max(0, targetDuration - videoDuration)

        if (subtitlePath && parsedDialogue.pureText) {
          const finalSubtitleContent = subtitleContent(parsedDialogue.pureText, targetDuration)
          fs.writeFileSync(subtitlePath, finalSubtitleContent, 'utf-8')
          const storedSubtitle = await this.storageService.saveBuffer({
            buffer: Buffer.from(finalSubtitleContent, 'utf-8'),
            subDir: 'subtitles',
            fileName: `${subtitleFilename}`,
            extension: '.srt',
            mimeType: 'application/x-subrip',
          })
          subtitleUrl = storedSubtitle.url

          await this.databaseService.db
            .update(storyboards)
            .set({ subtitleUrl: subtitleUrl, updatedAt: now() })
            .where(eq(storyboards.id, storyboardId))
        }

        if (!audioPath && !sourceHasAudio) {
          const tempDir = getAbsolutePath(this.storageService, 'temp')
          fs.mkdirSync(tempDir, { recursive: true })
          silentAudioPath = path.join(tempDir, `${uuid()}.wav`)
          writeSilentWav(silentAudioPath, targetDuration)
        }

        await new Promise<void>((resolve, reject) => {
          let command = ffmpeg(videoPath)

          if (audioPath) {
            command = command.input(audioPath)
          } else if (silentAudioPath) {
            command = command.input(silentAudioPath)
          }

          const filters: string[] = []
          if (subtitlePath && supportsSubtitleFilter()) {
            const escapedPath = subtitlePath
              .replace(/\\/g, '/')
              .replace(/:/g, '\\:')
              .replace(/'/g, "\\'")
            const forceStyle = 'FontSize=20\\,PrimaryColour=&HFFFFFF&\\,OutlineColour=&H000000&\\,Outline=2'
            filters.push(`subtitles=filename='${escapedPath}':force_style='${forceStyle}'`)
          }
          if (videoExtendDuration > VIDEO_EXTEND_EPSILON_SECONDS) {
            filters.push(`tpad=stop_mode=clone:stop_duration=${formatSeconds(videoExtendDuration)}`)
          }

          if (filters.length) {
            command = command.videoFilter(filters)
          }

          const shouldMixSourceAndDialogue = sourceHasAudio && !!audioPath
          const shouldUseSourceAudio = sourceHasAudio && !audioPath
          const outputOptions = [
            '-map', '0:v:0',
            '-t', formatSeconds(targetDuration),
          ]

          if (shouldMixSourceAndDialogue) {
            const mixFilter = [
              '[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[source_audio]',
              '[1:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[dialogue_audio]',
              `[source_audio][dialogue_audio]amix=inputs=2:duration=longest:dropout_transition=0,${audioFiltersForDuration(targetDuration)}[mixed_audio]`,
            ].join(';')
            outputOptions.push('-filter_complex', mixFilter, '-map', '[mixed_audio]')
          } else if (shouldUseSourceAudio) {
            outputOptions.push('-map', '0:a:0')
          } else {
            outputOptions.push('-map', '1:a:0')
          }

          if (filters.length) {
            outputOptions.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18')
          } else {
            outputOptions.push('-c:v', 'copy')
          }

          if (!shouldMixSourceAndDialogue) {
            outputOptions.push('-af', audioFiltersForDuration(targetDuration))
          }

          outputOptions.push(
            '-c:a', 'aac',
            '-ar', '48000',
            '-ac', '2',
            '-b:a', '256k',
            '-movflags', '+faststart',
          )

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

      const composedBuffer = fs.readFileSync(outputPath)
      const storedVideo = await this.storageService.saveBuffer({
        buffer: composedBuffer,
        subDir: 'composed',
        fileName: outputFilename,
        extension: '.mp4',
        mimeType: 'video/mp4',
      })
      const [latest] = await this.databaseService.db
        .select()
        .from(storyboards)
        .where(eq(storyboards.id, storyboardId))

      if (!latest || latest.status === 'compose_canceled') {
        await this.syncStoryboardComposeTask({
          storyboardId,
          userId: storyboard.userId ?? null,
          payload: {
            storyboard_id: storyboardId,
            episode_id: storyboard.episodeId,
          },
          status: 'canceled',
          errorMessage: 'Canceled by user',
        })
        throw new Error(`Storyboard ${storyboardId} compose canceled`)
      }

      await this.databaseService.db
        .update(storyboards)
        .set({ composedVideoUrl: storedVideo.url, status: 'compose_completed', updatedAt: now() })
        .where(eq(storyboards.id, storyboardId))
      await this.syncStoryboardComposeTask({
        storyboardId,
        userId: storyboard.userId ?? null,
        payload: {
          storyboard_id: storyboardId,
          episode_id: storyboard.episodeId,
        },
        status: 'completed',
      })

      return storedVideo.url
    } catch (error) {
      const message = error instanceof Error ? error.message : 'compose failed'
      if (message.toLowerCase().includes('canceled')) {
        await this.databaseService.db
          .update(storyboards)
          .set({ status: 'compose_canceled', composedVideoUrl: null, updatedAt: now() })
          .where(eq(storyboards.id, storyboardId))
        await this.syncStoryboardComposeTask({
          storyboardId,
          userId: storyboard.userId ?? null,
          payload: {
            storyboard_id: storyboardId,
            episode_id: storyboard.episodeId,
          },
          status: 'canceled',
          errorMessage: 'Canceled by user',
        })
        throw error
      }

      await this.databaseService.db
        .update(storyboards)
        .set({ status: 'compose_failed', composedVideoUrl: null, updatedAt: now() })
        .where(eq(storyboards.id, storyboardId))
      await this.syncStoryboardComposeTask({
        storyboardId,
        userId: storyboard.userId ?? null,
        payload: {
          storyboard_id: storyboardId,
          episode_id: storyboard.episodeId,
        },
        status: 'failed',
        errorMessage: message,
      })
      throw error
    }
  }

  async enqueueStoryboardCompose(storyboardId: number, userId?: number | null) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, storyboardId))
    if (!storyboard) throw new Error(`Storyboard ${storyboardId} not found`)
    if (!storyboard.videoUrl) throw new Error(`Storyboard ${storyboardId} has no video`)

    await this.databaseService.db
      .update(storyboards)
      .set({ status: 'compose_queued', composedVideoUrl: null, updatedAt: now() })
      .where(eq(storyboards.id, storyboardId))

    const taskId = await this.syncStoryboardComposeTask({
      storyboardId,
      userId: userId ?? storyboard.userId ?? null,
      payload: {
        storyboard_id: storyboardId,
        episode_id: storyboard.episodeId,
      },
      status: 'queued',
    })

    if (taskId != null) {
      await this.taskQueueService.enqueueTask(taskId)
    }

    return taskId
  }

  async enqueueEpisodeCompose(episodeId: number, userId?: number | null) {
    const rows = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(and(eq(storyboards.episodeId, episodeId), isNull(storyboards.deletedAt)))
      .orderBy(storyboards.storyboardNumber)

    if (!rows.length) throw new Error('No storyboards found')

    const withVideo = rows.filter((storyboard) => storyboard.videoUrl)
    if (!withVideo.length) throw new Error('No storyboards have video yet')

    const taskIds: number[] = []
    for (const storyboard of withVideo) {
      const taskId = await this.enqueueStoryboardCompose(storyboard.id, userId)
      if (taskId != null) taskIds.push(taskId)
    }

    return {
      message: `Queued composing ${withVideo.length} storyboards`,
      total: withVideo.length,
      task_ids: taskIds,
      status: 'queued',
    }
  }

  async startEpisodeCompose(episodeId: number) {
    return this.enqueueEpisodeCompose(episodeId)
  }

  async getEpisodeComposeStatus(episodeId: number) {
    const rows = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(and(eq(storyboards.episodeId, episodeId), isNull(storyboards.deletedAt)))
      .orderBy(storyboards.storyboardNumber)

    const withVideo = rows.filter((storyboard) => !!storyboard.videoUrl)
    const completed = withVideo.filter((storyboard) => !!storyboard.composedVideoUrl)
    const incomplete = withVideo.filter((storyboard) => !storyboard.composedVideoUrl)
    const failed = incomplete.filter((storyboard) => storyboard.status === 'compose_failed')
    const canceled = incomplete.filter((storyboard) => storyboard.status === 'compose_canceled')
    const processing = incomplete.filter((storyboard) => storyboard.status === 'compose_processing')
    const queued = incomplete.filter((storyboard) => storyboard.status === 'compose_queued')
    const idle = incomplete.filter((storyboard) => !storyboard.status || !String(storyboard.status).startsWith('compose_'))

    return {
      total: withVideo.length,
      completed: completed.length,
      failed: failed.length,
      canceled: canceled.length,
      processing: processing.length,
      queued: queued.length,
      idle: idle.length,
      items: withVideo.map((storyboard) => ({
        id: storyboard.id,
        storyboard_number: storyboard.storyboardNumber,
        status: storyboard.composedVideoUrl ? 'compose_completed' : storyboard.status || 'pending',
        composed_video_url: toPublicMediaUrl(storyboard.composedVideoUrl),
        error_msg: storyboard.composedVideoUrl
          ? ''
          : storyboard.status === 'compose_failed'
            ? '视频合成失败，请检查视频、配音或字幕素材'
            : storyboard.status === 'compose_canceled'
              ? '已取消'
              : '',
      })),
    }
  }
}
