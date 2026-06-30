import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { dramas, episodes, storyboards, tasks, videoGenerations } from '../../db/schema'
import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'
import type { AIConfig } from '../audio/audio.config'
import { resolveProjectConfigId } from '../dramas/drama-metadata'
import { requireOwnedStoryboard } from '../images/images.ownership'
import { downloadFile, normalizeImageReferenceForAdapter } from '../images/images.storage'
import { appendDramaStyleHint, parseConfigModelList, resolveConfiguredModel, toPublicMediaUrl } from '../images/images.utils'
import { TaskQueueService } from '../queue/task-queue.service'
import { StorageService } from '../storage/storage.service'
import { getVideoAdapter } from './videos.providers.registry'
import { VideosTasksService } from './videos.tasks'

type GenerateVideoArgs = {
  userId: number
  storyboardId?: number
  dramaId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  duration?: number
  aspectRatio?: string
  configId?: number
  taskPayload?: Record<string, unknown>
}

function now() {
  return new Date()
}

function isReferencePrivacyBlocked(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('InputImageSensitiveContentDetected.PrivacyInformation')
}

function parseStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item || '').trim()).filter(Boolean)
    } catch {}
  }
  return undefined
}

function normalizeReferenceMode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const raw = value.trim()
  if (!raw) return undefined
  const aliasMap: Record<string, string> = {
    'all-around': 'multiple',
    'first-last-frame': 'first_last',
    'single-image': 'single',
  }
  return aliasMap[raw] || raw
}

function resolveStoryboardVideoPrompt(sb: typeof storyboards.$inferSelect) {
  return [
    sb.videoPrompt,
    sb.imagePrompt,
    sb.description,
    sb.action,
    sb.result,
    sb.atmosphere,
    sb.title,
    sb.dialogue,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('，')
}

function resolveStoryboardStatusAfterVideoSuccess(storyboard: typeof storyboards.$inferSelect | null | undefined) {
  return storyboard?.composedVideoUrl ? 'compose_completed' : 'video_completed'
}

function resolveStoryboardStatusAfterVideoFailure(storyboard: typeof storyboards.$inferSelect | null | undefined) {
  if (!storyboard) return 'video_failed'
  if (storyboard.composedVideoUrl) return 'compose_completed'
  if (storyboard.videoUrl) return 'video_completed'
  return 'video_failed'
}

@Injectable()
export class VideosService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AiConfigResolverService) private readonly aiConfigResolver: AiConfigResolverService,
    @Inject(VideosTasksService) private readonly videosTasksService: VideosTasksService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(TaskQueueService) private readonly taskQueueService: TaskQueueService,
  ) {}

  async listOwnedVideoGenerations(userId: number, query: { dramaId?: number; storyboardId?: number }) {
    let rows = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(and(eq(videoGenerations.userId, userId), isNull(videoGenerations.deletedAt)))

    if (query.storyboardId) rows = rows.filter((row) => row.storyboardId === query.storyboardId)
    if (query.dramaId) rows = rows.filter((row) => row.dramaId === query.dramaId)
    return rows
  }

  async loadOwnedVideoGeneration(id: number, userId: number) {
    const [row] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(and(eq(videoGenerations.id, id), eq(videoGenerations.userId, userId), isNull(videoGenerations.deletedAt)))
    return row || null
  }

  async deleteOwnedVideoGeneration(id: number, userId: number) {
    const record = await this.loadOwnedVideoGeneration(id, userId)
    if (!record) return false

    await this.databaseService.db
      .update(videoGenerations)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(videoGenerations.id, id))

    return true
  }

  async buildVideoRequest(body: Record<string, unknown>, userId: number) {
    let prompt = String(body.prompt || '').trim()
    let configId = typeof body.config_id === 'number' ? body.config_id : typeof body.config_id === 'string' ? Number(body.config_id) : undefined
    let dramaId = typeof body.drama_id === 'number' ? body.drama_id : typeof body.drama_id === 'string' ? Number(body.drama_id) : undefined
    let referenceMode = normalizeReferenceMode(body.reference_mode)
    let imageUrl = typeof body.image_url === 'string' ? body.image_url.trim() : undefined
    let firstFrameUrl = typeof body.first_frame_url === 'string' ? body.first_frame_url.trim() : undefined
    let lastFrameUrl = typeof body.last_frame_url === 'string' ? body.last_frame_url.trim() : undefined
    let referenceImageUrls = parseStringArray(body.reference_image_urls)
    let duration = typeof body.duration === 'number' ? body.duration : typeof body.duration === 'string' ? Number(body.duration) : undefined

    if (body.storyboard_id) {
      const storyboard = await requireOwnedStoryboard(this.databaseService, Number(body.storyboard_id), userId)
      const [episode] = await this.databaseService.db
        .select()
        .from(episodes)
        .where(eq(episodes.id, storyboard.episodeId))
      if (episode?.videoConfigId != null) {
        configId = episode.videoConfigId
      } else if (episode?.dramaId != null) {
        const [drama] = await this.databaseService.db
          .select()
          .from(dramas)
          .where(eq(dramas.id, episode.dramaId))
        if (drama) configId = resolveProjectConfigId(drama.metadata, 'video') ?? undefined
      }
      if (episode?.dramaId != null && dramaId == null) dramaId = episode.dramaId
      if (!prompt) prompt = resolveStoryboardVideoPrompt(storyboard)
      if (!imageUrl && storyboard.composedImage) imageUrl = storyboard.composedImage
      if (!firstFrameUrl && storyboard.firstFrameImage) firstFrameUrl = storyboard.firstFrameImage
      if (!lastFrameUrl && storyboard.lastFrameImage) lastFrameUrl = storyboard.lastFrameImage
      if (!referenceImageUrls?.length) referenceImageUrls = parseStringArray(storyboard.referenceImages)
      if (duration == null && typeof storyboard.duration === 'number' && storyboard.duration > 0) duration = storyboard.duration
    }

    if (!referenceMode) {
      if (firstFrameUrl && lastFrameUrl) {
        referenceMode = 'first_last'
      } else if (imageUrl || firstFrameUrl || lastFrameUrl) {
        imageUrl = imageUrl || firstFrameUrl || lastFrameUrl
        firstFrameUrl = undefined
        lastFrameUrl = undefined
        referenceMode = 'single'
      } else if (referenceImageUrls?.length) {
        referenceMode = 'multiple'
      } else {
        referenceMode = 'none'
      }
    }

    if (dramaId != null) {
      const [drama] = await this.databaseService.db
        .select()
        .from(dramas)
        .where(eq(dramas.id, dramaId))
      if (drama) prompt = appendDramaStyleHint(prompt, drama.style)
    }

    if (!prompt) {
      throw new BadRequestException('prompt is required')
    }

    return {
      userId,
      storyboardId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
      dramaId,
      prompt,
      model: typeof body.model === 'string' ? body.model : undefined,
      referenceMode,
      imageUrl,
      firstFrameUrl,
      lastFrameUrl,
      referenceImageUrls,
      duration,
      aspectRatio: typeof body.aspect_ratio === 'string' ? body.aspect_ratio : undefined,
      configId,
      taskPayload: {
        storyboard_id: body.storyboard_id ? Number(body.storyboard_id) : undefined,
        drama_id: dramaId,
        prompt,
        model: typeof body.model === 'string' ? body.model : undefined,
        reference_mode: referenceMode,
        image_url: imageUrl,
        first_frame_url: firstFrameUrl,
        last_frame_url: lastFrameUrl,
        reference_image_urls: referenceImageUrls,
        duration,
        aspect_ratio: typeof body.aspect_ratio === 'string' ? body.aspect_ratio : undefined,
        config_id: configId,
      },
    }
  }

  async enqueueVideoGeneration(params: GenerateVideoArgs, resolvedConfig?: AIConfig) {
    const ts = now()
    const configRow = await this.aiConfigResolver.resolveConfigRow('video', params.configId, params.userId)
    const config = resolvedConfig || await this.aiConfigResolver.resolveConfig('video', params.configId, params.userId)
    const allowedModels = parseConfigModelList(configRow?.model)
    const resolvedModel = resolveConfiguredModel(params.model, allowedModels, config.model)

    const [created] = await this.databaseService.db
      .insert(videoGenerations)
      .values({
        userId: params.userId,
        storyboardId: params.storyboardId,
        dramaId: params.dramaId,
        prompt: params.prompt,
        model: resolvedModel,
        provider: config.provider,
        referenceMode: params.referenceMode || 'none',
        imageUrl: params.imageUrl,
        firstFrameUrl: params.firstFrameUrl,
        lastFrameUrl: params.lastFrameUrl,
        referenceImageUrls: params.referenceImageUrls ? JSON.stringify(params.referenceImageUrls) : null,
        duration: params.duration || 5,
        aspectRatio: params.aspectRatio || '16:9',
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    if (params.storyboardId) {
      await this.databaseService.db
        .update(storyboards)
        .set({ status: 'video_queued', updatedAt: ts })
        .where(eq(storyboards.id, params.storyboardId))
    }

    const taskId = await this.videosTasksService.syncTaskForVideoGeneration(created.id, {
      aiConfigId: configRow.id,
      payload: params.taskPayload ?? null,
    })

    if (taskId != null) {
      await this.taskQueueService.enqueueTask(taskId)
    }
    return created.id
  }

  async generateVideo(params: GenerateVideoArgs) {
    return this.enqueueVideoGeneration(params)
  }

  async processVideoGeneration(id: number, configId?: number | null) {
    const config = await this.aiConfigResolver.resolveConfig('video', configId)
    await this.processVideoGenerationWithConfig(id, config)
  }

  async resumeVideoGeneration(id: number, configId?: number | null) {
    const [record] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(eq(videoGenerations.id, id))
    if (!record) return false
    if (record.status !== 'processing' && record.status !== 'pending') return false
    if (record.status === 'pending') return false
    if (!record.taskId) {
      await this.videosTasksService.syncTaskForVideoGeneration(id, { aiConfigId: configId ?? null })
      return false
    }

    const config = await this.aiConfigResolver.resolveConfig('video', configId)
    const adapter = getVideoAdapter(config.provider)
    await this.videosTasksService.syncTaskForVideoGeneration(id, { aiConfigId: configId ?? null })
    if (adapter.provider === 'vidu') return true
    await this.pollVideoTask(id, config, record.taskId, record.storyboardId)
    return true
  }

  private async restoreStoryboardVideoStatus(storyboardId?: number | null) {
    if (!storyboardId) return
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, storyboardId))
    if (!storyboard) return

    await this.databaseService.db
      .update(storyboards)
      .set({
        status: resolveStoryboardStatusAfterVideoFailure(storyboard),
        updatedAt: now(),
      })
      .where(eq(storyboards.id, storyboardId))
  }

  private async processVideoGenerationWithConfig(id: number, config: AIConfig) {
    const adapter = getVideoAdapter(config.provider)
    let record: typeof videoGenerations.$inferSelect | undefined

    try {
      ;[record] = await this.databaseService.db
        .select()
        .from(videoGenerations)
        .where(eq(videoGenerations.id, id))
      if (!record) return
      if (String(record.status || '').toLowerCase() === 'canceled') return

      await this.databaseService.db
        .update(videoGenerations)
        .set({ status: 'processing', updatedAt: now() })
        .where(eq(videoGenerations.id, id))
      if (record.storyboardId) {
        await this.databaseService.db
          .update(storyboards)
          .set({ status: 'video_processing', updatedAt: now() })
          .where(eq(storyboards.id, record.storyboardId))
      }
      await this.videosTasksService.syncTaskForVideoGeneration(id)

      const resolvedImageUrl = await this.normalizeVideoReferenceUrl(record.imageUrl)
      const resolvedFirstFrameUrl = await this.normalizeVideoReferenceUrl(record.firstFrameUrl)
      const resolvedLastFrameUrl = await this.normalizeVideoReferenceUrl(record.lastFrameUrl)
      const resolvedReferenceImageUrls = await this.normalizeVideoReferenceUrls(record.referenceImageUrls)

      const { url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        referenceMode: record.referenceMode,
        imageUrl: resolvedImageUrl,
        firstFrameUrl: resolvedFirstFrameUrl,
        lastFrameUrl: resolvedLastFrameUrl,
        referenceImageUrls: resolvedReferenceImageUrls ? JSON.stringify(resolvedReferenceImageUrls) : null,
        duration: record.duration,
        aspectRatio: record.aspectRatio,
      })

      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      })
      if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`)
      const result = await response.json() as any

      const { isAsync, taskId, videoUrl } = adapter.parseGenerateResponse(result)

      if (!isAsync && videoUrl) {
        await this.handleVideoComplete(id, videoUrl, record.duration, record.storyboardId)
        return
      }

      await this.databaseService.db
        .update(videoGenerations)
        .set({ taskId, status: 'processing', updatedAt: now() })
        .where(eq(videoGenerations.id, id))
      await this.videosTasksService.syncTaskForVideoGeneration(id)

      if (adapter.provider === 'vidu') {
        return
      }

      void this.pollVideoTask(id, config, taskId!, record.storyboardId)
    } catch (error) {
      if (
        record
        && isReferencePrivacyBlocked(error)
        && record.referenceMode !== 'none'
        && (record.imageUrl || record.firstFrameUrl || record.lastFrameUrl || record.referenceImageUrls)
      ) {
        await this.databaseService.db
          .update(videoGenerations)
          .set({
            referenceMode: 'none',
            imageUrl: null,
            firstFrameUrl: null,
            lastFrameUrl: null,
            referenceImageUrls: null,
            taskId: null,
            errorMsg: null,
            updatedAt: now(),
          })
          .where(eq(videoGenerations.id, id))
        await this.videosTasksService.syncTaskForVideoGeneration(id)
        await this.processVideoGenerationWithConfig(id, config)
        return
      }

      const message = error instanceof Error ? error.message : 'Video generation failed'
      const [latestRecord] = await this.databaseService.db
        .select()
        .from(videoGenerations)
        .where(eq(videoGenerations.id, id))
      await this.databaseService.db
        .update(videoGenerations)
        .set({ status: 'failed', errorMsg: message, completedAt: now(), updatedAt: now() })
        .where(eq(videoGenerations.id, id))
      await this.videosTasksService.syncTaskForVideoGeneration(id)
      await this.restoreStoryboardVideoStatus(latestRecord?.storyboardId ?? record?.storyboardId)
    }
  }

  private async normalizeVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
    return normalizeImageReferenceForAdapter(this.storageService, value, {
      maxWidth: 1920,
      maxHeight: 1920,
      quality: 90,
    })
  }

  private async normalizeVideoReferenceUrls(raw: string | null | undefined): Promise<string[]> {
    if (!raw) return []
    let refs: string[] = []
    try {
      refs = JSON.parse(raw)
    } catch {
      refs = []
    }
    const normalized = await Promise.all(
      Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map((item) => this.normalizeVideoReferenceUrl(item)),
    )
    return normalized.filter((item): item is string => !!item)
  }

  private async pollVideoTask(id: number, config: AIConfig, taskId: string, storyboardId?: number | null) {
    const adapter = getVideoAdapter(config.provider)
    let downloadRetries = 0
    const maxDownloadRetries = 3

    for (let i = 0; i < 300; i += 1) {
      if (downloadRetries === 0) {
        await new Promise((resolve) => setTimeout(resolve, 10_000))
      } else {
        await new Promise((resolve) => setTimeout(resolve, 3_000))
      }

      const [latest] = await this.databaseService.db
        .select()
        .from(videoGenerations)
        .where(eq(videoGenerations.id, id))
      if (!latest || String(latest.status || '').toLowerCase() === 'canceled') return

      try {
        const { url, method, headers } = adapter.buildPollRequest(config, taskId)
        const response = await fetch(url, { method, headers, signal: AbortSignal.timeout(120_000) })
        if (!response.ok) continue
        const result = await response.json() as any
        const poll = adapter.parsePollResponse(result)

        if (poll.status === 'completed' && poll.videoUrl) {
          try {
            await this.handleVideoComplete(id, poll.videoUrl, null, storyboardId)
            return
          } catch (downloadError) {
            downloadRetries += 1
            if (downloadRetries >= maxDownloadRetries) {
              const message = `Download failed after ${maxDownloadRetries} attempts: ${downloadError instanceof Error ? downloadError.message : String(downloadError)}`
              await this.databaseService.db
                .update(videoGenerations)
                .set({ status: 'failed', errorMsg: message, completedAt: now(), updatedAt: now() })
                .where(eq(videoGenerations.id, id))
              await this.videosTasksService.syncTaskForVideoGeneration(id)
              await this.restoreStoryboardVideoStatus(storyboardId ?? latest.storyboardId)
              return
            }
            continue
          }
        }

        if (poll.status === 'failed') {
          const message = poll.error || 'Video generation failed'
          await this.databaseService.db
            .update(videoGenerations)
            .set({ status: 'failed', errorMsg: message, completedAt: now(), updatedAt: now() })
            .where(eq(videoGenerations.id, id))
          await this.videosTasksService.syncTaskForVideoGeneration(id)
          await this.restoreStoryboardVideoStatus(storyboardId ?? latest.storyboardId)
          return
        }
        downloadRetries = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Video generation failed'
        if (i === 299) {
          await this.databaseService.db
            .update(videoGenerations)
            .set({ status: 'failed', errorMsg: `Timeout: ${message}`, completedAt: now(), updatedAt: now() })
            .where(eq(videoGenerations.id, id))
          await this.videosTasksService.syncTaskForVideoGeneration(id)
          await this.restoreStoryboardVideoStatus(storyboardId ?? latest.storyboardId)
          return
        }
      }
    }
  }

  private async handleVideoComplete(id: number, videoUrl: string, duration: number | null | undefined, storyboardId?: number | null) {
    const [record] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(eq(videoGenerations.id, id))
    if (!record || String(record.status || '').toLowerCase() === 'canceled') return

    const storedFile = await downloadFile(this.storageService, videoUrl, 'videos')
    await this.databaseService.db
      .update(videoGenerations)
      .set({
        videoUrl: storedFile.url,
        minioUrl: storedFile.url,
        status: 'completed',
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(videoGenerations.id, id))
    await this.videosTasksService.syncTaskForVideoGeneration(id)

    const targetStoryboardId = storyboardId ?? record.storyboardId
    if (targetStoryboardId) {
      const [storyboard] = await this.databaseService.db
        .select()
        .from(storyboards)
        .where(eq(storyboards.id, targetStoryboardId))
      await this.databaseService.db
        .update(storyboards)
        .set({
          videoUrl: storedFile.url,
          duration: duration || undefined,
          status: resolveStoryboardStatusAfterVideoSuccess(storyboard),
          updatedAt: now(),
        })
        .where(eq(storyboards.id, targetStoryboardId))
    }
  }

  async handleViduWebhook(body: Record<string, unknown>) {
    const taskId = typeof body.task_id === 'string' ? body.task_id : ''
    const state = typeof body.state === 'string' ? body.state : ''
    const videoUrl = typeof body.video_url === 'string' ? body.video_url : ''
    const error = typeof body.error === 'string' ? body.error : ''

    if (!taskId) {
      throw new Error('Missing task_id')
    }

    const [record] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(eq(videoGenerations.taskId, taskId))

    if (!record) {
      return { message: 'Task not found' }
    }

    if (state === 'success' && videoUrl) {
      try {
        await this.handleVideoComplete(record.id, videoUrl, record.duration, record.storyboardId)
        return { message: 'Video updated successfully' }
      } catch (downloadError) {
        const message = downloadError instanceof Error ? downloadError.message : 'Webhook download failed'
        await this.databaseService.db
          .update(videoGenerations)
          .set({ status: 'failed', errorMsg: `Webhook download failed: ${message}`, completedAt: now(), updatedAt: now() })
          .where(eq(videoGenerations.id, record.id))
        await this.videosTasksService.syncTaskForVideoGeneration(record.id)
        await this.restoreStoryboardVideoStatus(record.storyboardId)
        throw new Error(message)
      }
    }

    if (state === 'failed') {
      await this.databaseService.db
        .update(videoGenerations)
        .set({
          status: 'failed',
          errorMsg: error || 'Vidu generation failed',
          completedAt: now(),
          updatedAt: now(),
        })
        .where(eq(videoGenerations.id, record.id))
      await this.videosTasksService.syncTaskForVideoGeneration(record.id)
      await this.restoreStoryboardVideoStatus(record.storyboardId)
      return { message: 'Error recorded' }
    }

    return { message: 'Status noted' }
  }

  async createQuickVideo(body: Record<string, unknown>, userId: number, immediate: boolean) {
    const params = await this.buildVideoRequest(body, userId)
    const generationId = immediate
      ? await this.generateVideo(params)
      : await this.enqueueVideoGeneration(params)

    const rows = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(eq(videoGenerations.id, generationId))
    const record = rows[0] || null

    const [ownedTask] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, 'video_generations'),
          eq(tasks.domainId, generationId),
          eq(tasks.userId, userId),
          isNull(tasks.deletedAt),
        ),
      )

    return {
      video_generation_id: generationId,
      task_id: ownedTask?.id ?? null,
      record: record ? this.serializeVideoGeneration(record) : null,
    }
  }

  serializeVideoGeneration(record: typeof videoGenerations.$inferSelect) {
    return {
      id: record.id,
      storyboard_id: record.storyboardId,
      drama_id: record.dramaId,
      provider: record.provider,
      prompt: record.prompt,
      model: record.model,
      reference_mode: record.referenceMode,
      duration: record.duration,
      aspect_ratio: record.aspectRatio,
      video_url: record.videoUrl,
      status: record.status,
      task_id: record.taskId,
      error_msg: record.errorMsg,
      width: record.width,
      height: record.height,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      completed_at: record.completedAt,
      deleted_at: record.deletedAt,
    }
  }
}
