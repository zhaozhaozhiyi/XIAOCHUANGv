import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { characters, dramas, episodes, imageGenerations, scenes, storyboardCharacters, storyboards } from '../../db/schema'
import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'
import type { AIConfig } from '../audio/audio.config'
import { resolveProjectConfigId } from '../dramas/drama-metadata'
import { TaskQueueService } from '../queue/task-queue.service'
import { StorageService } from '../storage/storage.service'
import { requireOwnedCharacter, requireOwnedEpisode, requireOwnedScene, requireOwnedStoryboard } from './images.ownership'
import { getImageAdapter } from './images.providers.registry'
import { composeReferenceImagesDataUrl, downloadFile, normalizeImageReferenceForAdapter, saveBase64Image } from './images.storage'
import { ImagesTasksService } from './images.tasks'
import { appendDramaStyleHint, parseConfigModelList, resolveConfiguredModel, toPublicMediaUrl } from './images.utils'

type GenerateImageArgs = {
  userId: number
  storyboardId?: number
  dramaId?: number
  sceneId?: number
  characterId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  configId?: number
  taskPayload?: Record<string, unknown>
}

function now() {
  return new Date()
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

function appendUniqueImages(target: string[], values: Array<string | null | undefined>) {
  const seen = new Set(target)
  for (const value of values) {
    const image = String(value || '').trim()
    if (!image || seen.has(image)) continue
    target.push(image)
    seen.add(image)
  }
}

function parseStoredReferenceImages(value: string | null | undefined): string[] {
  return parseStringArray(value) || []
}

function resolveStoryboardImagePrompt(sb: typeof storyboards.$inferSelect) {
  const visualPrompt = [
    sb.imagePrompt,
    sb.description,
    sb.action,
    sb.result,
    sb.atmosphere,
    sb.title,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join('，')
  return visualPrompt
    ? `${visualPrompt}，画面中不要出现文字、字幕、对话气泡、水印`
    : visualPrompt
}

@Injectable()
export class ImagesService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AiConfigResolverService) private readonly aiConfigResolver: AiConfigResolverService,
    @Inject(ImagesTasksService) private readonly imagesTasksService: ImagesTasksService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(TaskQueueService) private readonly taskQueueService: TaskQueueService,
  ) {}

  private async resolveStoryboardReferenceImages(storyboard: typeof storyboards.$inferSelect): Promise<string[]> {
    const referenceImages: string[] = []

    if (storyboard.sceneId) {
      const [scene] = await this.databaseService.db
        .select()
        .from(scenes)
        .where(eq(scenes.id, storyboard.sceneId))
      appendUniqueImages(referenceImages, [scene?.imageUrl])
    }

    const characterLinks = await this.databaseService.db
      .select()
      .from(storyboardCharacters)
      .where(eq(storyboardCharacters.storyboardId, storyboard.id))
    for (const link of characterLinks) {
      const [character] = await this.databaseService.db
        .select()
        .from(characters)
        .where(eq(characters.id, link.characterId))
      appendUniqueImages(referenceImages, [
        character?.imageUrl,
        ...parseStoredReferenceImages(character?.referenceImages),
      ])
    }

    appendUniqueImages(referenceImages, parseStoredReferenceImages(storyboard.referenceImages))
    return referenceImages.slice(0, 6)
  }

  async listOwnedImageGenerations(userId: number, query: { dramaId?: number; storyboardId?: number }) {
    let rows = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.userId, userId))

    if (query.storyboardId) rows = rows.filter((row) => row.storyboardId === query.storyboardId)
    if (query.dramaId) rows = rows.filter((row) => row.dramaId === query.dramaId)
    return rows
  }

  async loadOwnedImageGeneration(id: number, userId: number) {
    const [row] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, id))
    return row && row.userId === userId ? row : null
  }

  async deleteOwnedImageGeneration(id: number, userId: number) {
    const record = await this.loadOwnedImageGeneration(id, userId)
    if (!record) return false

    await this.databaseService.db
      .delete(imageGenerations)
      .where(eq(imageGenerations.id, id))

    return true
  }

  async buildImageRequest(body: Record<string, unknown>, userId: number) {
    let prompt = String(body.prompt || '').trim()
    let configId = typeof body.config_id === 'number' ? body.config_id : typeof body.config_id === 'string' ? Number(body.config_id) : undefined
    let dramaId = typeof body.drama_id === 'number' ? body.drama_id : typeof body.drama_id === 'string' ? Number(body.drama_id) : undefined
    let referenceImages = parseStringArray(body.reference_images)

    if (body.episode_id) {
      const episode = await requireOwnedEpisode(this.databaseService, Number(body.episode_id), userId)
      if (dramaId == null) dramaId = episode.dramaId
      if (episode.imageConfigId != null && configId == null) {
        configId = episode.imageConfigId
      } else if (configId == null && episode.dramaId != null) {
        const [drama] = await this.databaseService.db
          .select()
          .from(dramas)
          .where(eq(dramas.id, episode.dramaId))
        if (drama) configId = resolveProjectConfigId(drama.metadata, 'image') ?? undefined
      }
    }

    if (body.storyboard_id) {
      const storyboard = await requireOwnedStoryboard(this.databaseService, Number(body.storyboard_id), userId)
      const [episode] = await this.databaseService.db
        .select()
        .from(episodes)
        .where(eq(episodes.id, storyboard.episodeId))
      if (episode?.imageConfigId != null) {
        configId = episode.imageConfigId
      } else if (episode?.dramaId != null) {
        const [drama] = await this.databaseService.db
          .select()
          .from(dramas)
          .where(eq(dramas.id, episode.dramaId))
        if (drama) configId = resolveProjectConfigId(drama.metadata, 'image') ?? undefined
      }
      if (episode?.dramaId != null && dramaId == null) dramaId = episode.dramaId
      if (!prompt) prompt = resolveStoryboardImagePrompt(storyboard)
      if (!referenceImages?.length) referenceImages = await this.resolveStoryboardReferenceImages(storyboard)
    }

    if (body.scene_id) {
      const scene = await requireOwnedScene(this.databaseService, Number(body.scene_id), userId)
      if (dramaId == null) dramaId = scene.dramaId
      if (!prompt) {
        prompt = scene.prompt || `${scene.location}, ${scene.time || ''}, 高质量场景, 电影感`
      }
    }

    if (body.character_id) {
      const character = await requireOwnedCharacter(this.databaseService, Number(body.character_id), userId)
      if (dramaId == null) dramaId = character.dramaId
      if (!prompt) {
        prompt = `${character.name}, ${character.appearance || character.description || '人物立绘'}, 高质量, 正面, 白色背景`
      }
    }

    if (dramaId != null) {
      const [drama] = await this.databaseService.db
        .select()
        .from(dramas)
        .where(eq(dramas.id, dramaId))
      if (drama) prompt = appendDramaStyleHint(prompt, drama.style)
    }

    if (!prompt) throw new BadRequestException('prompt is required')

    return {
      userId,
      storyboardId: body.storyboard_id ? Number(body.storyboard_id) : undefined,
      dramaId,
      sceneId: body.scene_id ? Number(body.scene_id) : undefined,
      characterId: body.character_id ? Number(body.character_id) : undefined,
      prompt,
      model: typeof body.model === 'string' ? body.model : undefined,
      size: typeof body.size === 'string' ? body.size : undefined,
      referenceImages,
      frameType: typeof body.frame_type === 'string' ? body.frame_type : undefined,
      configId,
      taskPayload: {
        storyboard_id: body.storyboard_id ? Number(body.storyboard_id) : undefined,
        drama_id: dramaId,
        scene_id: body.scene_id ? Number(body.scene_id) : undefined,
        character_id: body.character_id ? Number(body.character_id) : undefined,
        prompt,
        model: typeof body.model === 'string' ? body.model : undefined,
        size: typeof body.size === 'string' ? body.size : undefined,
        reference_images: referenceImages,
        frame_type: typeof body.frame_type === 'string' ? body.frame_type : undefined,
        config_id: configId,
      },
    }
  }

  async enqueueImageGeneration(params: GenerateImageArgs, resolvedConfig?: AIConfig) {
    const ts = now()
    const configRow = await this.aiConfigResolver.resolveConfigRow('image', params.configId, params.userId)
    const config = resolvedConfig || await this.aiConfigResolver.resolveConfig('image', params.configId, params.userId)
    const allowedModels = parseConfigModelList(configRow?.model)
    const resolvedModel = resolveConfiguredModel(params.model, allowedModels, config.model)
    const [created] = await this.databaseService.db
      .insert(imageGenerations)
      .values({
        userId: params.userId,
        storyboardId: params.storyboardId,
        dramaId: params.dramaId,
        sceneId: params.sceneId,
        characterId: params.characterId,
        prompt: params.prompt,
        model: resolvedModel,
        provider: config.provider,
        size: params.size || '1920x1080',
        frameType: params.frameType,
        referenceImages: params.referenceImages ? JSON.stringify(params.referenceImages) : null,
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    if (params.sceneId) {
      await this.databaseService.db
        .update(scenes)
        .set({ status: 'queued', updatedAt: ts })
        .where(eq(scenes.id, params.sceneId))
    }

    const taskId = await this.imagesTasksService.syncTaskForImageGeneration(created.id, {
      aiConfigId: configRow.id,
      payload: params.taskPayload ?? null,
    })

    if (taskId != null) {
      await this.taskQueueService.enqueueTask(taskId)
    }

    return created.id
  }

  async generateImage(params: GenerateImageArgs) {
    return this.enqueueImageGeneration(params)
  }

  async processImageGeneration(id: number, configId?: number | null) {
    const config = await this.aiConfigResolver.resolveConfig('image', configId)
    await this.processImageGenerationWithConfig(id, config)
  }

  async resumeImageGeneration(id: number, configId?: number | null) {
    const [record] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, id))
    if (!record) return false
    if (record.status !== 'processing' && record.status !== 'pending') return false
    if (record.status === 'pending') return false
    if (!record.taskId) {
      await this.imagesTasksService.syncTaskForImageGeneration(id, { aiConfigId: configId ?? null })
      return false
    }

    const config = await this.aiConfigResolver.resolveConfig('image', configId)
    await this.pollImageTask(id, config, record.taskId)
    return true
  }

  private async processImageGenerationWithConfig(id: number, config: AIConfig) {
    const adapter = getImageAdapter(config.provider)

    try {
      const [record] = await this.databaseService.db
        .select()
        .from(imageGenerations)
        .where(eq(imageGenerations.id, id))
      if (!record) return
      if (String(record.status || '').toLowerCase() === 'canceled') return

      await this.databaseService.db
        .update(imageGenerations)
        .set({ status: 'processing', updatedAt: now() })
        .where(eq(imageGenerations.id, id))
      if (record.sceneId) {
        await this.databaseService.db
          .update(scenes)
          .set({ status: 'processing', updatedAt: now() })
          .where(eq(scenes.id, record.sceneId))
      }
      await this.imagesTasksService.syncTaskForImageGeneration(id)

      let resolvedReferenceImages = await this.normalizeReferenceImages(record.referenceImages)
      if (config.provider === 'minimax' && resolvedReferenceImages.length > 1) {
        const compositeReference = await composeReferenceImagesDataUrl(this.storageService, resolvedReferenceImages, {
          cellSize: 640,
          quality: 84,
        })
        resolvedReferenceImages = compositeReference ? [compositeReference] : resolvedReferenceImages.slice(0, 1)
      }
      const { url, method, headers, body } = adapter.buildGenerateRequest(config, {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        size: record.size,
        frameType: record.frameType,
        referenceImages: resolvedReferenceImages ? JSON.stringify(resolvedReferenceImages) : null,
      })

      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      })
      if (!response.ok) throw new Error(`API error ${response.status}: ${await response.text()}`)
      const result = await response.json() as any

      const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

      if (!isAsync && imageUrl) {
        await this.handleImageComplete(id, imageUrl)
        return
      }

      if (!isAsync && !imageUrl) {
        const b64 = adapter.extractImageBase64(result)
        if (b64) {
          await this.handleImageCompleteBase64(id, b64.data, b64.mimeType)
          return
        }
        throw new Error('No image URL or base64 data in response')
      }

      await this.databaseService.db
        .update(imageGenerations)
        .set({ taskId, status: 'processing', updatedAt: now() })
        .where(eq(imageGenerations.id, id))
      await this.imagesTasksService.syncTaskForImageGeneration(id)
      void this.pollImageTask(id, config, taskId!)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Image generation failed'
      const [record] = await this.databaseService.db
        .select()
        .from(imageGenerations)
        .where(eq(imageGenerations.id, id))
      await this.databaseService.db
        .update(imageGenerations)
        .set({ status: 'failed', errorMsg: message, updatedAt: now() })
        .where(eq(imageGenerations.id, id))
      if (record?.sceneId) {
        await this.databaseService.db
          .update(scenes)
          .set({ status: 'failed', updatedAt: now() })
          .where(eq(scenes.id, record.sceneId))
      }
      await this.imagesTasksService.syncTaskForImageGeneration(id)
    }
  }

  private async normalizeReferenceImages(raw: string | null | undefined): Promise<string[]> {
    if (!raw) return []
    let refs: string[] = []
    try {
      refs = JSON.parse(raw)
    } catch {
      refs = []
    }
    const normalized = await Promise.all(
      Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map(async (value) => {
        return await normalizeImageReferenceForAdapter(this.storageService, value, {
          maxWidth: 1920,
          maxHeight: 1920,
          quality: 90,
        })
      }),
    )
    return normalized.filter((item): item is string => !!item).slice(0, 6)
  }

  private async pollImageTask(id: number, config: AIConfig, taskId: string) {
    const adapter = getImageAdapter(config.provider)
    const startedAt = Date.now()
    const maxDurationMs = 600_000
    let downloadRetries = 0
    const maxDownloadRetries = 3

    for (let i = 0; i < 120; i += 1) {
      if (Date.now() - startedAt >= maxDurationMs) {
        await this.databaseService.db
          .update(imageGenerations)
          .set({ status: 'failed', errorMsg: 'Timeout: Polling exceeded 10 minutes', updatedAt: now() })
          .where(eq(imageGenerations.id, id))
        await this.imagesTasksService.syncTaskForImageGeneration(id)
        return
      }

      if (downloadRetries === 0) {
        await new Promise((resolve) => setTimeout(resolve, 5000))
      } else {
        await new Promise((resolve) => setTimeout(resolve, 2000))
      }

      const [latest] = await this.databaseService.db
        .select()
        .from(imageGenerations)
        .where(eq(imageGenerations.id, id))
      if (!latest || String(latest.status || '').toLowerCase() === 'canceled') return

      try {
        const { url, method, headers } = adapter.buildPollRequest(config, taskId)
        const remainingMs = Math.max(1_000, maxDurationMs - (Date.now() - startedAt))
        const response = await fetch(url, { method, headers, signal: AbortSignal.timeout(remainingMs) })
        if (!response.ok) throw new Error(`Poll API error ${response.status}: ${await response.text()}`)
        const result = await response.json() as any

        const poll = adapter.parsePollResponse(result)
        if (poll.status === 'completed' && poll.imageUrl) {
          try {
            await this.handleImageComplete(id, poll.imageUrl)
            return
          } catch (dlError) {
            downloadRetries += 1
            if (downloadRetries >= maxDownloadRetries) {
              throw new Error(`Download failed after ${maxDownloadRetries} attempts: ${dlError instanceof Error ? dlError.message : String(dlError)}`)
            }
            continue
          }
        }
        if (poll.status === 'failed') throw new Error(poll.error || 'Image generation failed')
        downloadRetries = 0
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Image generation failed'
        if (i === 119) {
          await this.databaseService.db
            .update(imageGenerations)
            .set({ status: 'failed', errorMsg: `Timeout: ${message}`, updatedAt: now() })
            .where(eq(imageGenerations.id, id))
          await this.imagesTasksService.syncTaskForImageGeneration(id)
          return
        }
      }
    }
  }

  private async handleImageComplete(id: number, imageUrl: string) {
    const [before] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, id))
    if (!before || String(before.status || '').toLowerCase() === 'canceled') return

    const storedFile = await downloadFile(this.storageService, imageUrl, 'images')
    const [latest] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, id))
    if (!latest || String(latest.status || '').toLowerCase() === 'canceled') return

    await this.databaseService.db
      .update(imageGenerations)
      .set({
        imageUrl: storedFile.url,
        minioUrl: storedFile.url,
        status: 'completed',
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(imageGenerations.id, id))
    await this.imagesTasksService.syncTaskForImageGeneration(id)

    const [record] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, id))
    await this.applyImageCompletionSideEffects(record || null, storedFile.url)
  }

  private async handleImageCompleteBase64(id: number, data: string, mimeType: string) {
    const [before] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, id))
    if (!before || String(before.status || '').toLowerCase() === 'canceled') return

    const storedFile = await saveBase64Image(this.storageService, data, mimeType, 'images')
    const [latest] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, id))
    if (!latest || String(latest.status || '').toLowerCase() === 'canceled') return

    await this.databaseService.db
      .update(imageGenerations)
      .set({
        imageUrl: storedFile.url,
        minioUrl: storedFile.url,
        status: 'completed',
        completedAt: now(),
        updatedAt: now(),
      })
      .where(eq(imageGenerations.id, id))
    await this.imagesTasksService.syncTaskForImageGeneration(id)

    const [record] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, id))
    await this.applyImageCompletionSideEffects(record || null, storedFile.url)
  }

  private async applyImageCompletionSideEffects(
    record: typeof imageGenerations.$inferSelect | null,
    publicUrl: string,
  ) {
    if (!record) return

    if (record.storyboardId && record.frameType) {
      const updates = record.frameType === 'last_frame'
        ? { lastFrameImage: publicUrl, updatedAt: now() }
        : { firstFrameImage: publicUrl, updatedAt: now() }
      await this.databaseService.db
        .update(storyboards)
        .set(updates)
        .where(eq(storyboards.id, record.storyboardId))
    }
    if (record.sceneId) {
      await this.databaseService.db
        .update(scenes)
        .set({ imageUrl: publicUrl, status: 'completed', updatedAt: now() })
        .where(eq(scenes.id, record.sceneId))
    }
    if (record.characterId) {
      await this.databaseService.db
        .update(characters)
        .set({ imageUrl: publicUrl, updatedAt: now() })
        .where(eq(characters.id, record.characterId))
    }
    if (record.dramaId && record.frameType === 'drama_cover') {
      await this.databaseService.db
        .update(dramas)
        .set({ thumbnail: publicUrl, updatedAt: now() })
        .where(eq(dramas.id, record.dramaId))
    }
  }

  serializeImageGeneration(record: typeof imageGenerations.$inferSelect) {
    return {
      id: record.id,
      storyboard_id: record.storyboardId,
      drama_id: record.dramaId,
      scene_id: record.sceneId,
      character_id: record.characterId,
      prop_id: record.propId,
      image_type: record.imageType,
      frame_type: record.frameType,
      provider: record.provider,
      prompt: record.prompt,
      model: record.model,
      size: record.size,
      image_url: record.imageUrl,
      status: record.status,
      task_id: record.taskId,
      error_msg: record.errorMsg,
      width: record.width,
      height: record.height,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      completed_at: record.completedAt,
    }
  }
}
