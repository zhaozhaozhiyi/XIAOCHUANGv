import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { dramas, episodes } from '../../../db/schema'
import { DramaAiFirstService } from '../../dramas/drama-ai-first.service'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import { parseTaskPayload, sanitizePayload } from './task-domain-utils'

function parseEpisodeIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0)
}

@Injectable()
export class DramaPilotScriptsTaskHandler extends BaseTaskDomainHandler implements TaskDomainHandler {
  readonly domainTable = 'drama_pilot_scripts'

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(DramaAiFirstService) private readonly dramaAiFirstService: DramaAiFirstService,
  ) {
    super(databaseService)
  }

  private async assertOwnedDrama(dramaId: number, userId: number) {
    const [drama] = await this.databaseService.db
      .select({ id: dramas.id })
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId)))
      .limit(1)

    if (!drama) throw new NotFoundException('drama_not_found')
  }

  private episodeFilter(dramaId: number, userId: number, episodeIds: number[]) {
    return episodeIds.length
      ? and(eq(episodes.dramaId, dramaId), eq(episodes.userId, userId), inArray(episodes.id, episodeIds))
      : and(eq(episodes.dramaId, dramaId), eq(episodes.userId, userId))
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const userId = Number(task.userId)
    const dramaId = Number(task.dramaId || task.domainId)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid_task_user')
    if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('invalid_task_drama')

    await this.assertOwnedDrama(dramaId, userId)

    const currentPayload = parseTaskPayload(task)
    const nextPayload: Record<string, unknown> = { ...currentPayload, ...payload, drama_id: dramaId }
    const episodeIds = parseEpisodeIds(nextPayload.episode_ids)
    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      providerTaskId: null,
      payloadJson: sanitizePayload(nextPayload) ?? task.payloadJson,
      resultSummaryJson: JSON.stringify({
        phase: 'queued',
        drama_id: dramaId,
        episode_ids: episodeIds,
        total_episodes: episodeIds.length || null,
        completed_episodes: 0,
        failed_episodes: 0,
      }),
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })

    await this.databaseService.db
      .update(episodes)
      .set({
        status: 'script_generating',
        scriptAiRunId: null,
        scriptRemoteRunId: null,
        failureReason: null,
        updatedAt: this.now(),
      })
      .where(and(
        this.episodeFilter(dramaId, userId, episodeIds),
        or(isNull(episodes.scriptContent), eq(episodes.scriptContent, '')),
      ))

    return { task_id: task.id, status: 'queued' }
  }

  async cancel(task: TaskRecord, currentUserId: number) {
    const dramaId = Number(task.dramaId || task.domainId)
    if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('invalid_task_drama')
    await this.assertOwnedDrama(dramaId, currentUserId)

    const payload = parseTaskPayload(task)
    const episodeIds = parseEpisodeIds(payload.episode_ids)
    await this.databaseService.db
      .update(episodes)
      .set({ status: 'blueprint', failureReason: 'Canceled by user', updatedAt: this.now() })
      .where(and(this.episodeFilter(dramaId, currentUserId, episodeIds), eq(episodes.status, 'script_generating')))

    await this.cancelTaskRecord(task, { drama_id: dramaId, episode_ids: episodeIds })
    return { canceled: true }
  }

  async refreshPresentation(task: TaskRecord) {
    if (['completed', 'failed', 'canceled', 'dead_letter'].includes(task.status)) return

    const payload = parseTaskPayload(task)
    const userId = Number(task.userId)
    const dramaId = Number(task.dramaId || task.domainId)
    const episodeIds = parseEpisodeIds(payload.episode_ids)
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(dramaId) || dramaId <= 0) return

    const rows = await this.databaseService.db
      .select({ status: episodes.status })
      .from(episodes)
      .where(this.episodeFilter(dramaId, userId, episodeIds))

    const total = episodeIds.length || rows.length
    if (!total) return

    const completed = rows.filter((row) => row.status === 'script_ready').length
    const failed = rows.filter((row) => row.status === 'failed').length
    const progress = Math.min(96, 8 + Math.round(((completed + failed) / total) * 84))

    await this.syncTaskUpdate(task.id, {
      progress,
      resultSummaryJson: JSON.stringify({
        phase: failed ? 'episode_failed' : 'episode_script',
        drama_id: dramaId,
        total_episodes: total,
        completed_episodes: completed,
        failed_episodes: failed,
        episode_ids: episodeIds,
      }),
    })
  }

  async markCanceled(task: TaskRecord) {
    const userId = Number(task.userId)
    const dramaId = Number(task.dramaId || task.domainId)
    const episodeIds = parseEpisodeIds(parseTaskPayload(task).episode_ids)

    if (Number.isInteger(userId) && userId > 0 && Number.isInteger(dramaId) && dramaId > 0) {
      await this.databaseService.db
        .update(episodes)
        .set({ status: 'blueprint', failureReason: 'Canceled by user', updatedAt: this.now() })
        .where(and(this.episodeFilter(dramaId, userId, episodeIds), eq(episodes.status, 'script_generating')))
    }
    await this.cancelTaskRecord(task, { drama_id: dramaId, episode_ids: episodeIds })
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    await this.dramaAiFirstService.failPilotScriptsTask(task.id, error)
    return true
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task)
    const userId = Number(task.userId)
    const dramaId = Number(payload.drama_id || task.dramaId || task.domainId)
    const episodeIds = parseEpisodeIds(payload.episode_ids)
    const limit = Math.min(3, Math.max(1, Number(payload.limit || episodeIds.length || 1)))

    if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid_task_user')
    if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('invalid_task_drama')
    if (!episodeIds.length) throw new Error('invalid_task_episodes')

    await this.dramaAiFirstService.executePilotScriptsTask({
      taskId: task.id,
      userId,
      dramaId,
      episodeIds,
      limit,
    })
    return 'drama_pilot_scripts'
  }
}
