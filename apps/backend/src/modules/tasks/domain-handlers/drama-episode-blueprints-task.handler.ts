import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { dramas } from '../../../db/schema'
import { DramaAiFirstService } from '../../dramas/drama-ai-first.service'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import { parseTaskPayload, sanitizePayload } from './task-domain-utils'

function toBoolean(value: unknown) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

@Injectable()
export class DramaEpisodeBlueprintsTaskHandler extends BaseTaskDomainHandler implements TaskDomainHandler {
  readonly domainTable = 'drama_episode_blueprints'

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

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const userId = Number(task.userId)
    const dramaId = Number(payload.drama_id || task.dramaId || task.domainId)
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid_task_user')
    if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('invalid_task_drama')

    await this.assertOwnedDrama(dramaId, userId)

    const nextPayload: Record<string, unknown> = { ...parseTaskPayload(task), ...payload, drama_id: dramaId }
    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      providerTaskId: null,
      payloadJson: sanitizePayload(nextPayload) ?? task.payloadJson,
      resultSummaryJson: JSON.stringify({
        phase: 'queued',
        drama_id: dramaId,
        selected_brief_id: nextPayload.selected_brief_id ?? null,
        target_episode_count: nextPayload.target_episode_count ?? null,
        generated_episodes: 0,
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

    return { task_id: task.id, status: 'queued' }
  }

  async cancel(task: TaskRecord, currentUserId: number) {
    const dramaId = Number(task.dramaId || task.domainId)
    if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('invalid_task_drama')
    await this.assertOwnedDrama(dramaId, currentUserId)
    await this.dramaAiFirstService.failEpisodeBlueprintsTask(task.id, new Error('canceled'))
    return { canceled: true }
  }

  async refreshPresentation(task: TaskRecord) {
    if (['completed', 'failed', 'canceled', 'dead_letter'].includes(task.status)) return
    const payload = parseTaskPayload(task)
    await this.syncTaskUpdate(task.id, {
      resultSummaryJson: JSON.stringify({
        phase: task.status === 'queued' ? 'queued' : 'blueprint_generate',
        drama_id: payload.drama_id || task.dramaId || task.domainId,
        selected_brief_id: payload.selected_brief_id ?? null,
        target_episode_count: payload.target_episode_count ?? null,
        generated_episodes: 0,
      }),
    })
  }

  async markCanceled(task: TaskRecord) {
    await this.dramaAiFirstService.failEpisodeBlueprintsTask(task.id, new Error('canceled'))
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    await this.dramaAiFirstService.failEpisodeBlueprintsTask(task.id, error)
    return true
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task)
    const userId = Number(task.userId)
    const dramaId = Number(payload.drama_id || task.dramaId || task.domainId)

    if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid_task_user')
    if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('invalid_task_drama')

    await this.dramaAiFirstService.executeEpisodeBlueprintsTask({
      taskId: task.id,
      userId,
      dramaId,
      replaceWithoutScript: toBoolean(payload.replace_without_script),
    })
    return 'drama_episode_blueprints'
  }
}
