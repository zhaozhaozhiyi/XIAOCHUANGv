import { Inject, Injectable } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { AssetsService } from '../assets/assets.service'
import { tasks, videoGenerations } from '../../db/schema'
import { sanitizePayload, toPublicMediaUrl, trimText } from '../images/images.utils'

@Injectable()
export class VideosTasksService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AssetsService) private readonly assetsService: AssetsService,
  ) {}

  private now() {
    return new Date()
  }

  private inferTaskSourceType(record: typeof videoGenerations.$inferSelect) {
    return record.storyboardId != null || record.dramaId != null ? 'drama_episode_shot' : 'quick_video'
  }

  private inferTaskType(record: typeof videoGenerations.$inferSelect) {
    return this.inferTaskSourceType(record) === 'quick_video' ? 'quick_video' : 'drama_video'
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

  private mapStatus(status: string | null | undefined) {
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

  private buildTaskResultSummary(record: typeof videoGenerations.$inferSelect) {
    const publicUrl = String(record.videoUrl || '').trim()
    const providerUrl = String(record.videoUrl || '').trim() || null
    if (!publicUrl && !providerUrl) return null

    return {
      video_url: publicUrl || providerUrl,
      provider_url: providerUrl,
      width: record.width ?? null,
      height: record.height ?? null,
      duration: record.duration ?? null,
    }
  }

  private async syncCompletedAsset(taskId: number | null, status: string) {
    if (!taskId || status !== 'completed') return
    try {
      await this.assetsService.ensureAssetFromTask(taskId)
    } catch (error) {
      console.error('[VideosTasksService] Failed to auto-create asset from task', taskId, error)
    }
  }

  async syncTaskForVideoGeneration(videoGenerationId: number, options: { aiConfigId?: number | null; payload?: Record<string, unknown> | null } = {}) {
    const [record] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(eq(videoGenerations.id, videoGenerationId))
    if (!record) return null

    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.domainTable, 'video_generations'), eq(tasks.domainId, record.id), isNull(tasks.deletedAt)))

    const taskStatus = this.mapStatus(record.status)
    const errorKind =
      taskStatus === 'failed'
        ? this.inferErrorKind(record.errorMsg)
        : taskStatus === 'canceled'
          ? 'canceled'
          : null
    const updatedAt = record.updatedAt || this.now()
    const createdAt = record.createdAt || updatedAt
    const isTerminal = taskStatus === 'completed' || taskStatus === 'failed' || taskStatus === 'canceled'
    const summary = this.buildTaskResultSummary(record)

    const values = {
      userId: record.userId ?? existing?.userId ?? null,
      type: this.inferTaskType(record),
      status: taskStatus,
      title: trimText(record.prompt, 40) || `video_generation_${record.id}`,
      progress: taskStatus === 'completed' ? 100 : taskStatus === 'queued' ? 0 : null,
      sourceType: this.inferTaskSourceType(record),
      dramaId: record.dramaId ?? null,
      episodeId: null,
      storyboardId: record.storyboardId ?? null,
      aiConfigId: options.aiConfigId ?? existing?.aiConfigId ?? null,
      domainTable: 'video_generations',
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
