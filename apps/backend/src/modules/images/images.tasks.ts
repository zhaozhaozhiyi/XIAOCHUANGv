import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull, sql } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { AssetsService } from '../assets/assets.service'
import { imageGenerations, scenes, storyboards, tasks } from '../../db/schema'
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

  private payloadNumber(payload: Record<string, unknown> | null | undefined, key: string) {
    const value = payload?.[key]
    if (value == null || value === '') return null
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  private async resolveEpisodeId(
    record: typeof imageGenerations.$inferSelect,
    existing: typeof tasks.$inferSelect | undefined,
    payload: Record<string, unknown> | null | undefined,
  ) {
    const payloadEpisodeId = this.payloadNumber(payload, 'episode_id')
    if (payloadEpisodeId != null) return payloadEpisodeId

    if (record.storyboardId != null) {
      const [storyboard] = await this.databaseService.db
        .select({ episodeId: storyboards.episodeId })
        .from(storyboards)
        .where(eq(storyboards.id, record.storyboardId))
      if (storyboard?.episodeId != null) return storyboard.episodeId
    }

    if (record.sceneId != null) {
      const [scene] = await this.databaseService.db
        .select({ episodeId: scenes.episodeId })
        .from(scenes)
        .where(eq(scenes.id, record.sceneId))
      if (scene?.episodeId != null) return scene.episodeId
    }

    return existing?.episodeId ?? null
  }

  private async syncCompletedAsset(taskId: number | null, status: string) {
    if (!taskId || status !== 'completed') return
    try {
      await this.assetsService.ensureAssetFromTask(taskId)
    } catch (error) {
      console.error('[ImagesTasksService] Failed to auto-create asset from task', taskId, error)
    }
  }

  private async buildImageTaskValues(
    record: typeof imageGenerations.$inferSelect,
    existing: typeof tasks.$inferSelect | undefined,
    options: { aiConfigId?: number | null; payload?: Record<string, unknown> | null },
  ) {
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
    const payload = options.payload ?? null
    const episodeId = await this.resolveEpisodeId(record, existing, payload)

    return {
      taskStatus,
      values: {
        userId: record.userId ?? existing?.userId ?? null,
        type: 'image' as const,
        status: taskStatus,
        title: trimText(record.prompt, 40) || `image_generation_${record.id}`,
        progress: taskStatus === 'completed' ? 100 : taskStatus === 'queued' ? 0 : null,
        sourceType: this.inferImageTaskSourceType(record),
        dramaId: record.dramaId ?? null,
        episodeId,
        storyboardId: record.storyboardId ?? null,
        aiConfigId: options.aiConfigId ?? existing?.aiConfigId ?? null,
        domainTable: 'image_generations',
        domainId: record.id,
        providerTaskId: record.taskId ?? null,
        payloadJson: payload ? sanitizePayload(payload) : existing?.payloadJson ?? null,
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
      },
    }
  }

  private async findActiveImageTask(imageGenerationId: number) {
    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(
        eq(tasks.domainTable, 'image_generations'),
        eq(tasks.domainId, imageGenerationId),
        isNull(tasks.deletedAt),
      ))

    return existing
  }

  private isMissingConflictIndexError(error: unknown) {
    const candidates = [error, (error as { cause?: unknown } | null)?.cause]
    return candidates.some((candidate) => {
      const item = candidate as { code?: unknown; message?: unknown } | null
      const message = String(item?.message || '').toLowerCase()
      return item?.code === '42P10'
        || message.includes('no unique or exclusion constraint matching the on conflict specification')
    })
  }

  private async insertTaskValues(values: typeof tasks.$inferInsert) {
    const [created] = await this.databaseService.db
      .insert(tasks)
      .values(values)
      .returning({ id: tasks.id })
    return created ?? null
  }

  async syncTaskForImageGeneration(imageGenerationId: number, options: { aiConfigId?: number | null; payload?: Record<string, unknown> | null } = {}) {
    const [record] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, imageGenerationId))

    if (!record) return null

    const existing = await this.findActiveImageTask(record.id)
    const { values, taskStatus } = await this.buildImageTaskValues(record, existing, options)

    if (existing) {
      await this.databaseService.db
        .update(tasks)
        .set(values)
        .where(eq(tasks.id, existing.id))
      await this.syncCompletedAsset(existing.id, taskStatus)
      return existing.id
    }

    let created: { id: number } | null = null
    try {
      const [inserted] = await this.databaseService.db
        .insert(tasks)
        .values(values)
        .onConflictDoNothing({
          target: [tasks.domainTable, tasks.domainId],
          where: sql`${tasks.deletedAt} IS NULL`,
        })
        .returning({ id: tasks.id })
      created = inserted ?? null
    } catch (error) {
      if (!this.isMissingConflictIndexError(error)) throw error
      created = await this.insertTaskValues(values)
    }

    if (created?.id) {
      await this.syncCompletedAsset(created.id, taskStatus)
      return created.id
    }

    const conflicted = await this.findActiveImageTask(record.id)
    if (!conflicted) return null

    const { values: conflictValues, taskStatus: conflictTaskStatus } = await this.buildImageTaskValues(record, conflicted, options)
    await this.databaseService.db
      .update(tasks)
      .set(conflictValues)
      .where(eq(tasks.id, conflicted.id))

    await this.syncCompletedAsset(conflicted.id, conflictTaskStatus)
    return conflicted.id
  }
}
