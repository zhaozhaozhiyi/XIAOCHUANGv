import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../common/media-url'
import { DatabaseService } from '../../db/database.service'
import {
  assets,
  imageGenerations,
  storyboards,
  tasks,
  videoGenerations,
  videoMerges,
} from '../../db/schema'

type ListAssetsArgs = {
  userId: number
  q?: string
  kind?: string
  sourceType?: string
  dramaId?: number
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function buildAssetTitle(task: typeof tasks.$inferSelect, fallback: string) {
  const title = String(task.title || '').trim()
  return title || fallback
}

function resolveSourcePath(args: {
  task: typeof tasks.$inferSelect
  dramaId?: number | null
  fallback?: string
}) {
  const dramaId = args.task.dramaId ?? args.dramaId ?? null
  if (Number.isInteger(dramaId) && Number(dramaId) > 0) {
    return `/drama/${dramaId}`
  }
  return args.fallback ?? '/create/video'
}

@Injectable()
export class AssetsService {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  private now() {
    return new Date()
  }

  async loadOwnedAsset(assetId: number, userId: number) {
    const [asset] = await this.databaseService.db
      .select()
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.userId, userId), isNull(assets.deletedAt)))

    return asset || null
  }

  async listOwnedAssets(args: ListAssetsArgs) {
    let rows = await this.databaseService.db
      .select()
      .from(assets)
      .where(and(eq(assets.userId, args.userId), isNull(assets.deletedAt)))

    if (args.kind) rows = rows.filter((row) => row.kind === args.kind)
    if (args.sourceType) rows = rows.filter((row) => row.sourceType === args.sourceType)
    if (Number.isInteger(args.dramaId) && (args.dramaId || 0) > 0) {
      rows = rows.filter((row) => row.dramaId === args.dramaId)
    }
    if (args.q) {
      const keyword = args.q.toLowerCase()
      rows = rows.filter((row) => {
        const haystacks = [row.title, row.provider, row.sourceType]
        return haystacks.some((value) => String(value || '').toLowerCase().includes(keyword))
      })
    }

    rows.sort((left, right) => (left.updatedAt < right.updatedAt ? 1 : -1))
    return rows
  }

  async createAssetFromTask(userId: number, taskId: number) {
    const [existingAsset] = await this.databaseService.db
      .select()
      .from(assets)
      .where(and(eq(assets.taskId, taskId), eq(assets.userId, userId), isNull(assets.deletedAt)))

    if (existingAsset) return existingAsset

    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))

    if (!task) {
      throw new NotFoundException('任务不存在')
    }

    if (task.status !== 'completed') {
      throw new ConflictException('仅已完成任务可入库')
    }

    if (task.domainTable === 'video_generations') {
      return this.createVideoAssetFromGeneration(task, userId)
    }

    if (task.domainTable === 'image_generations') {
      return this.createImageAssetFromGeneration(task, userId)
    }

    if (task.domainTable === 'storyboard_tts') {
      return this.createAudioAssetFromStoryboard(task, userId)
    }

    if (task.domainTable === 'storyboard_compose') {
      return this.createComposedVideoAssetFromStoryboard(task, userId)
    }

    if (task.domainTable === 'video_merges') {
      return this.createMergedVideoAsset(task, userId)
    }

    throw new BadRequestException('当前任务暂不支持入库')
  }

  async ensureAssetFromTask(taskId: number) {
    const [existingAsset] = await this.databaseService.db
      .select()
      .from(assets)
      .where(and(eq(assets.taskId, taskId), isNull(assets.deletedAt)))

    if (existingAsset) return existingAsset

    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)))

    if (!task || task.userId == null || task.status !== 'completed') {
      return null
    }

    return this.createAssetFromTask(task.userId, task.id)
  }

  async deleteOwnedAsset(assetId: number, userId: number) {
    const asset = await this.loadOwnedAsset(assetId, userId)
    if (!asset) {
      throw new NotFoundException('素材不存在')
    }

    await this.databaseService.db
      .update(assets)
      .set({ deletedAt: this.now(), updatedAt: this.now() })
      .where(eq(assets.id, assetId))
  }

  async createQuickAudioAsset(args: {
    userId: number
    provider: string | null
    title: string
    mimeType: string | null
    url: string | null
    metadataJson: string | null
  }) {
    const [asset] = await this.databaseService.db
      .insert(assets)
      .values({
        userId: args.userId,
        kind: 'audio',
        title: args.title,
        provider: args.provider,
        mimeType: args.mimeType,
        sourceType: 'quick_video',
        sourcePath: '/create/video',
        url: toPublicMediaUrl(args.url),
        metadataJson: args.metadataJson,
        createdAt: this.now(),
        updatedAt: this.now(),
      })
      .returning()

    return asset
  }

  private async createVideoAssetFromGeneration(task: typeof tasks.$inferSelect, userId: number) {
    const [generation] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(
        and(
          eq(videoGenerations.id, task.domainId),
          eq(videoGenerations.userId, userId),
          isNull(videoGenerations.deletedAt),
        ),
      )

    if (!generation) {
      throw new NotFoundException('视频结果不存在')
    }

    const publicUrl = toPublicMediaUrl(generation.videoUrl)
    if (!publicUrl) {
      throw new ConflictException('当前任务还没有可入库的视频结果')
    }

    const [asset] = await this.databaseService.db
      .insert(assets)
      .values({
        userId,
        kind: 'video',
        title: buildAssetTitle(task, generation.prompt?.slice(0, 40) || `视频素材 #${generation.id}`),
        provider: generation.provider ?? null,
        mimeType: 'video/mp4',
        sourceType: task.sourceType,
        sourceId: generation.id,
        sourcePath: resolveSourcePath({ task, dramaId: generation.dramaId, fallback: '/create/video' }),
        dramaId: task.dramaId ?? generation.dramaId ?? null,
        episodeId: task.episodeId ?? null,
        storyboardId: task.storyboardId ?? generation.storyboardId ?? null,
        taskId: task.id,
        videoGenerationId: generation.id,
        url: publicUrl,
        thumbnailUrl: toPublicMediaUrl(generation.firstFrameUrl || generation.imageUrl),
        metadataJson: JSON.stringify({
          prompt: generation.prompt ?? null,
          duration: generation.duration ?? null,
          aspect_ratio: generation.aspectRatio ?? null,
          source_task_id: task.id,
        }),
        createdAt: this.now(),
        updatedAt: this.now(),
      })
      .returning()

    return asset
  }

  private async createImageAssetFromGeneration(task: typeof tasks.$inferSelect, userId: number) {
    const [generation] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(and(eq(imageGenerations.id, task.domainId), eq(imageGenerations.userId, userId)))

    if (!generation) {
      throw new NotFoundException('图片结果不存在')
    }

    const publicUrl = toPublicMediaUrl(generation.imageUrl)
    if (!publicUrl) {
      throw new ConflictException('当前任务还没有可入库的图片结果')
    }

    const [asset] = await this.databaseService.db
      .insert(assets)
      .values({
        userId,
        kind: 'image',
        title: buildAssetTitle(task, generation.prompt?.slice(0, 40) || `图片素材 #${generation.id}`),
        provider: generation.provider ?? null,
        mimeType: 'image/png',
        sourceType: task.sourceType,
        sourceId: generation.id,
        sourcePath: resolveSourcePath({ task, dramaId: generation.dramaId, fallback: '/create/video' }),
        dramaId: task.dramaId ?? generation.dramaId ?? null,
        episodeId: task.episodeId ?? null,
        storyboardId: task.storyboardId ?? generation.storyboardId ?? null,
        taskId: task.id,
        imageGenerationId: generation.id,
        url: publicUrl,
        metadataJson: JSON.stringify({
          prompt: generation.prompt ?? null,
          width: generation.width ?? null,
          height: generation.height ?? null,
          source_task_id: task.id,
        }),
        createdAt: this.now(),
        updatedAt: this.now(),
      })
      .returning()

    return asset
  }

  private async createAudioAssetFromStoryboard(task: typeof tasks.$inferSelect, userId: number) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, task.domainId))

    if (!storyboard) {
      throw new NotFoundException('配音结果不存在')
    }

    const publicUrl = toPublicMediaUrl(storyboard.ttsAudioUrl)
    if (!publicUrl) {
      throw new ConflictException('当前任务还没有可入库的配音结果')
    }

    const [asset] = await this.databaseService.db
      .insert(assets)
      .values({
        userId,
        kind: 'audio',
        title: buildAssetTitle(task, storyboard.dialogue?.slice(0, 40) || `配音素材 #${storyboard.id}`),
        mimeType: String(storyboard.ttsAudioUrl || '').endsWith('.wav') ? 'audio/wav' : 'audio/mpeg',
        sourceType: task.sourceType,
        sourceId: storyboard.id,
        sourcePath: resolveSourcePath({ task, fallback: '/drama' }),
        dramaId: task.dramaId ?? null,
        episodeId: task.episodeId ?? storyboard.episodeId ?? null,
        storyboardId: task.storyboardId ?? storyboard.id,
        taskId: task.id,
        url: publicUrl,
        metadataJson: JSON.stringify({
          dialogue: storyboard.dialogue ?? null,
          source_task_id: task.id,
        }),
        createdAt: this.now(),
        updatedAt: this.now(),
      })
      .returning()

    return asset
  }

  private async createComposedVideoAssetFromStoryboard(task: typeof tasks.$inferSelect, userId: number) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, task.domainId))

    if (!storyboard) {
      throw new NotFoundException('合成视频结果不存在')
    }

    const publicUrl = toPublicMediaUrl(storyboard.composedVideoUrl)
    if (!publicUrl) {
      throw new ConflictException('当前任务还没有可入库的合成视频结果')
    }

    const [asset] = await this.databaseService.db
      .insert(assets)
      .values({
        userId,
        kind: 'video',
        title: buildAssetTitle(task, storyboard.title?.slice(0, 40) || `合成视频 #${storyboard.id}`),
        provider: 'ffmpeg',
        mimeType: 'video/mp4',
        sourceType: task.sourceType,
        sourceId: storyboard.id,
        sourcePath: resolveSourcePath({ task, fallback: '/drama' }),
        dramaId: task.dramaId ?? null,
        episodeId: task.episodeId ?? storyboard.episodeId ?? null,
        storyboardId: task.storyboardId ?? storyboard.id,
        taskId: task.id,
        url: publicUrl,
        thumbnailUrl: toPublicMediaUrl(storyboard.firstFrameImage || storyboard.composedImage || storyboard.lastFrameImage),
        metadataJson: JSON.stringify({
          description: storyboard.description ?? null,
          source_task_id: task.id,
        }),
        createdAt: this.now(),
        updatedAt: this.now(),
      })
      .returning()

    return asset
  }

  private async createMergedVideoAsset(task: typeof tasks.$inferSelect, userId: number) {
    const [merge] = await this.databaseService.db
      .select()
      .from(videoMerges)
      .where(eq(videoMerges.id, task.domainId))

    if (!merge) {
      throw new NotFoundException('整集合并结果不存在')
    }

    const publicUrl = toPublicMediaUrl(merge.mergedUrl)
    if (!publicUrl) {
      throw new ConflictException('当前任务还没有可入库的整集合并结果')
    }

    const [asset] = await this.databaseService.db
      .insert(assets)
      .values({
        userId,
        kind: 'video',
        title: buildAssetTitle(task, merge.title || `整集成片 #${merge.id}`),
        provider: merge.provider ?? 'ffmpeg',
        mimeType: 'video/mp4',
        sourceType: task.sourceType,
        sourceId: merge.id,
        sourcePath: resolveSourcePath({ task, dramaId: merge.dramaId, fallback: '/drama' }),
        dramaId: task.dramaId ?? merge.dramaId ?? null,
        episodeId: task.episodeId ?? merge.episodeId ?? null,
        taskId: task.id,
        url: publicUrl,
        metadataJson: JSON.stringify({
          duration: merge.duration ?? null,
          scenes: parseJsonValue(merge.scenes),
          source_task_id: task.id,
        }),
        createdAt: this.now(),
        updatedAt: this.now(),
      })
      .returning()

    return asset
  }
}
