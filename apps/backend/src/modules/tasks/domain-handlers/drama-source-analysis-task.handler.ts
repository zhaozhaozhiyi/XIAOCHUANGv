import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { dramaSourceChunks, dramaSources, tasks } from '../../../db/schema'
import { DramaAiFirstService } from '../../dramas/drama-ai-first.service'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import { inferErrorKind, parseTaskPayload, sanitizePayload, trimText } from './task-domain-utils'

@Injectable()
export class DramaSourceAnalysisTaskHandler extends BaseTaskDomainHandler implements TaskDomainHandler {
  readonly domainTable = 'drama_sources'

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(DramaAiFirstService) private readonly dramaAiFirstService: DramaAiFirstService,
  ) {
    super(databaseService)
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const [source] = await this.databaseService.db
      .select()
      .from(dramaSources)
      .where(and(eq(dramaSources.id, task.domainId), eq(dramaSources.userId, task.userId ?? 0)))

    if (!source) throw new NotFoundException('source_not_found')

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      providerTaskId: null,
      payloadJson: sanitizePayload(payload) ?? task.payloadJson,
      resultSummaryJson: JSON.stringify({
        phase: 'queued',
        source_id: source.id,
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
      .update(dramaSourceChunks)
      .set({ status: 'pending', failureReason: null, updatedAt: this.now() })
      .where(and(eq(dramaSourceChunks.sourceId, source.id), eq(dramaSourceChunks.status, 'failed')))

    return { task_id: task.id, status: 'queued' }
  }

  async cancel(task: TaskRecord, currentUserId: number) {
    const [source] = await this.databaseService.db
      .select()
      .from(dramaSources)
      .where(and(eq(dramaSources.id, task.domainId), eq(dramaSources.userId, currentUserId)))

    if (!source) throw new NotFoundException('source_not_found')

    await this.databaseService.db
      .update(dramaSourceChunks)
      .set({ status: 'pending', failureReason: 'Canceled by user', updatedAt: this.now() })
      .where(and(eq(dramaSourceChunks.sourceId, source.id), eq(dramaSourceChunks.status, 'running')))

    await this.cancelTaskRecord(task, { source_id: source.id })
    return { canceled: true }
  }

  async refreshPresentation(task: TaskRecord) {
    const chunks = await this.databaseService.db
      .select({ status: dramaSourceChunks.status })
      .from(dramaSourceChunks)
      .where(eq(dramaSourceChunks.sourceId, task.domainId))

    if (!chunks.length || ['completed', 'failed', 'canceled', 'dead_letter'].includes(task.status)) return

    const readyChunks = chunks.filter((chunk) => chunk.status === 'ready').length
    const failedChunks = chunks.filter((chunk) => chunk.status === 'failed').length
    const progress = Math.min(82, 5 + Math.round((readyChunks / chunks.length) * 72))
    await this.syncTaskUpdate(task.id, {
      progress,
      resultSummaryJson: JSON.stringify({
        phase: failedChunks ? 'chunk_failed' : 'chunk_analysis',
        source_id: task.domainId,
        total_chunks: chunks.length,
        ready_chunks: readyChunks,
        failed_chunks: failedChunks,
      }),
      errorKind: failedChunks ? 'provider' : null,
      errorMessage: failedChunks ? `${failedChunks} 个分块分析失败` : null,
    })
  }

  async markCanceled(task: TaskRecord) {
    await this.cancelTaskRecord(task, { source_id: task.domainId })
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const message = error instanceof Error ? error.message : 'source analysis failed'
    await this.dramaAiFirstService.failSourceAnalysisTask(task.id, error)
    await this.syncTaskUpdate(task.id, {
      errorKind: inferErrorKind(message),
      errorMessage: trimText(message, 500),
      errorDetailsJson: JSON.stringify({
        error_kind: inferErrorKind(message),
        source_id: task.domainId,
        raw_error: message,
      }),
    })
    return true
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task)
    const sourceId = Number(payload.source_id || task.domainId)
    const dramaId = Number(payload.drama_id || task.dramaId)
    const userId = Number(task.userId)

    if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid_task_user')
    if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('invalid_task_drama')
    if (!Number.isInteger(sourceId) || sourceId <= 0) throw new Error('invalid_task_source')

    await this.dramaAiFirstService.executeSourceAnalysisTask({
      taskId: task.id,
      userId,
      dramaId,
      sourceId,
    })
    return 'drama_source_analysis'
  }
}
