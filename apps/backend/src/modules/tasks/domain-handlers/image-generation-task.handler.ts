import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../../common/media-url'
import { DatabaseService } from '../../../db/database.service'
import { imageGenerations } from '../../../db/schema'
import { ImagesService } from '../../images/images.service'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import {
  inferErrorKind,
  isStaleRunningTask,
  isTaskTooOldForResume,
  mapGenerationStatus,
  sanitizePayload,
  trimText,
} from './task-domain-utils'

@Injectable()
export class ImageGenerationTaskHandler extends BaseTaskDomainHandler implements TaskDomainHandler {
  readonly domainTable = 'image_generations'

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(ImagesService) private readonly imagesService: ImagesService,
  ) {
    super(databaseService)
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const [generation] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(and(eq(imageGenerations.id, task.domainId), eq(imageGenerations.userId, task.userId ?? 0)))

    if (!generation) throw new NotFoundException('image_generation_not_found')

    await this.databaseService.db
      .update(imageGenerations)
      .set({ status: 'pending', taskId: null, errorMsg: null, completedAt: null, updatedAt: this.now() })
      .where(eq(imageGenerations.id, generation.id))

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      providerTaskId: null,
      payloadJson: sanitizePayload(payload) ?? task.payloadJson,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })

    return { task_id: task.id, image_generation_id: generation.id }
  }

  async cancel(task: TaskRecord, currentUserId: number) {
    const [generation] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(and(eq(imageGenerations.id, task.domainId), eq(imageGenerations.userId, currentUserId)))

    if (!generation) throw new NotFoundException('image_generation_not_found')

    await this.databaseService.db
      .update(imageGenerations)
      .set({ status: 'canceled', errorMsg: 'Canceled by user', completedAt: this.now(), updatedAt: this.now() })
      .where(eq(imageGenerations.id, generation.id))

    await this.cancelTaskRecord(task, {
      provider: generation.provider || null,
      provider_task_id: generation.taskId || null,
    })
    return { canceled: true }
  }

  async refreshPresentation(task: TaskRecord) {
    const [generation] = await this.databaseService.db
      .select()
      .from(imageGenerations)
      .where(eq(imageGenerations.id, task.domainId))
    if (!generation) return

    const status = mapGenerationStatus(generation.status)
    const errorKind = status === 'failed' ? inferErrorKind(generation.errorMsg) : status === 'canceled' ? 'canceled' : null

    await this.syncTaskUpdate(task.id, {
      status,
      title: trimText(generation.prompt, 40) || task.title,
      progress: status === 'completed' ? 100 : status === 'queued' ? 0 : task.progress,
      providerTaskId: generation.taskId ?? null,
      resultSummaryJson: status === 'completed' ? JSON.stringify({ image_url: toPublicMediaUrl(generation.imageUrl) }) : null,
      errorKind,
      errorMessage: status === 'failed' || status === 'canceled'
        ? trimText(generation.errorMsg || (status === 'canceled' ? 'Task canceled' : 'Task failed'), 240)
        : null,
      errorDetailsJson: errorKind
        ? JSON.stringify({
          error_kind: errorKind,
          provider: generation.provider || null,
          provider_task_id: generation.taskId || null,
          raw_error: generation.errorMsg || null,
        })
        : null,
      completedAt: status === 'completed' || status === 'failed' || status === 'canceled' ? generation.completedAt || this.now() : null,
    })
  }

  async markCanceled(task: TaskRecord) {
    const timestamp = this.now()
    await this.databaseService.db
      .update(imageGenerations)
      .set({ status: 'canceled', errorMsg: 'Canceled by worker', completedAt: timestamp, updatedAt: timestamp })
      .where(eq(imageGenerations.id, task.domainId))
    await this.refreshPresentation(task)
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const timestamp = this.now()
    const message = error instanceof Error ? error.message : 'recover failed'
    await this.databaseService.db
      .update(imageGenerations)
      .set({ status: 'failed', errorMsg: message, completedAt: timestamp, updatedAt: timestamp })
      .where(eq(imageGenerations.id, task.domainId))
    await this.refreshPresentation(task)
    return true
  }

  async execute(task: TaskRecord) {
    if (task.status === 'running' && isTaskTooOldForResume(task)) {
      throw new Error('Image task too old to resume — provider download URL likely expired')
    }
    if (task.status === 'queued') {
      await this.databaseService.db
        .update(imageGenerations)
        .set({ status: 'processing', updatedAt: this.now() })
        .where(eq(imageGenerations.id, task.domainId))
      await this.refreshPresentation(task)
      await this.imagesService.processImageGeneration(task.domainId, task.aiConfigId)
      return 'image_queued'
    }

    const resumed = await this.imagesService.resumeImageGeneration(task.domainId, task.aiConfigId)
    if (!resumed && !task.providerTaskId && isStaleRunningTask(task)) {
      throw new Error('Image task was running without provider task id; manual retry required to avoid duplicate submission')
    }
    return 'image'
  }
}
