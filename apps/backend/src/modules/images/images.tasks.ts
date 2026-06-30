import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { AssetsService } from '../assets/assets.service'
import { imageGenerations, tasks } from '../../db/schema'
import { sanitizePayload, toPublicMediaUrl, trimText } from './images.utils'

@Injectable()
export class ImagesTasksService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AssetsService) private readonly assetsService: AssetsService,
  ) {}

  private now() {
    return new Date()
  }

  private inferImageTaskSourceType(record: typeof imageGenerations.$inferSelect) {
    if (record.storyboardId != null) return 'drama_episode_image'
    if (record.characterId != null) return 'drama_character_image'
    if (record.sceneId != null) return 'drama_scene_image'
    if (record.dramaId != null) return 'drama_episode_image'
    return 'quick_image'
  }

  private inferErrorKind(message: string | null | undefined) {
    const text = String(message || '').toLowerCase()
    if (!text) return 'internal'
    if (text.includes('cancel')) return 'canceled'
    if (text.includes('moderat')) return 'moderation'
    if (text.includes('429') || text.includes('quota') || text.includes('rate limit') || text.includes('too many requests')) {
      return 'quota'
    }
    if (
      text.includes('timeout')
      || text.includes('timed out')
      || text.includes('network')
      || text.includes('fetch failed')
      || text.includes('econn')
      || text.includes('enotfound')
      || text.includes('socket')
    ) {
      return 'network'
    }
    if (text.includes('invalid') || text.includes('required') || text.includes('not found')) {
      return 'validation'
    }
    return 'provider'
  }

  private mapImageGenerationStatus(status: string | null | undefined) {
    switch (String(status || '').trim().toLowerCase()) {
      case 'pending':
        return 'queued'
      case 'processing':
      case 'running':
        return 'running'
      case 'completed':
        return 'completed'
      case 'failed':
        return 'failed'
      case 'canceled':
      case 'cancelled':
        return 'canceled'
      default:
        return 'queued'
    }
  }

  private buildImageTaskResultSummary(record: typeof imageGenerations.$inferSelect) {
    const publicUrl = String(record.imageUrl || '').trim()
    const providerUrl = String(record.imageUrl || '').trim() || null
    if (!publicUrl && !providerUrl) return null

    return {
      image_url: publicUrl || providerUrl,
      provider_url: providerUrl,
      width: record.width ?? null,
      height: record.height ?? null,
    }
  }

  private async syncCompletedAsset(taskId: number | null, status: string) {
    if (!taskId || status !== 'completed') return
    try {
      await this.assetsService.ensureAssetFromTask(taskId)
    } catch (error) {
      console.error('[ImagesTasksService] Failed to auto-create asset from task', taskId, error)
    }
  }

  async syncTaskForImageGeneration(imageGenerationId: number, options: { aiConfigId?: number | null; payload?: Record<string, unknown> | null } = {}) {
    const [record] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, imageGenerationId))

    if (!record) return null

    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.domainTable, 'image_generations'), eq(tasks.domainId, record.id)))

    const taskStatus = this.mapImageGenerationStatus(record.status)
    const errorKind =
      taskStatus === 'failed'
        ? this.inferErrorKind(record.errorMsg)
        : taskStatus === 'canceled'
          ? 'canceled'
          : null
    const updatedAt = record.updatedAt || this.now()
    const createdAt = record.createdAt || updatedAt
    const isTerminal = taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'canceled'
    const summary = this.buildImageTaskResultSummary(record)

    const values = {
      userId: record.userId ?? existing?.userId ?? null,
      type: 'image' as const,
      status: taskStatus,
      title: trimText(record.prompt, 40) || `image_generation_${record.id}`,
      progress: taskStatus === 'completed' ? 100 : taskStatus === 'queued' ? 0 : null,
      sourceType: this.inferImageTaskSourceType(record),
      dramaId: record.dramaId ?? null,
      episodeId: null,
      storyboardId: record.storyboardId ?? null,
      aiConfigId: options.aiConfigId ?? existing?.aiConfigId ?? null,
      domainTable: 'image_generations',
      domainId: record.id,
      providerTaskId: record.taskId ?? null,
      payloadJson: options.payload ? sanitizePayload(options.payload) : existing?.payloadJson ?? null,
      resultSummaryJson: summary ? JSON.stringify(summary) : null,
      errorKind,
      errorMessage:
        taskStatus === 'failed' || taskStatus === 'canceled'
          ? trimText(record.errorMsg || (taskStatus === 'canceled' ? 'Task canceled' : 'Task failed'), 240)
          : null,
      errorDetailsJson: errorKind
        ? JSON.stringify({
          error_kind: errorKind,
          provider: record.provider || null,
          provider_task_id: record.taskId || null,
          raw_error: record.errorMsg || null,
        })
        : null,
      createdAt,
      updatedAt,
      startedAt: taskStatus === 'queued' ? existing?.startedAt ?? null : existing?.startedAt ?? updatedAt,
      completedAt: isTerminal ? record.completedAt || updatedAt : null,
    }

    if (existing) {
      await this.databaseService.db
        .update(tasks)
        .set(values)
        .where(eq(tasks.id, existing.id))
      await this.syncCompletedAsset(existing.id, taskStatus)
      return existing.id
    }

    const [created] = await this.databaseService.db
      .insert(tasks)
      .values(values)
      .returning({ id: tasks.id })

    await this.syncCompletedAsset(created?.id ?? null, taskStatus)
    return created?.id ?? null
  }
}
