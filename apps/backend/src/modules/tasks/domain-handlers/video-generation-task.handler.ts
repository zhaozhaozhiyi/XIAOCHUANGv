import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../../common/media-url'
import { DatabaseService } from '../../../db/database.service'
import { videoGenerations } from '../../../db/schema'
import { assertContinuityVideoRetryAllowed } from '../../drama-workspace/continuity-production-gate'
import { VideosService } from '../../videos/videos.service'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import {
  inferErrorKind,
  isStaleRunningTask,
  isTaskTooOldForResume,
  mapGenerationStatus,
  parseJsonValue,
  sanitizePayload,
  trimText,
} from './task-domain-utils'

@Injectable()
export class VideoGenerationTaskHandler extends BaseTaskDomainHandler implements TaskDomainHandler {
  readonly domainTable = 'video_generations'

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(VideosService) private readonly videosService: VideosService,
  ) {
    super(databaseService)
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const [generation] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(and(eq(videoGenerations.id, task.domainId), eq(videoGenerations.userId, task.userId ?? 0), isNull(videoGenerations.deletedAt)))

    if (!generation) throw new NotFoundException('video_generation_not_found')
    const previousPayload = parseJsonValue(task.payloadJson)
    const continuityRetry = await assertContinuityVideoRetryAllowed(this.databaseService, {
      episodeId: task.episodeId,
      userId: task.userId ?? generation.userId,
      videoGenerationId: generation.id,
      storyboardId: generation.storyboardId,
      payload: {
        ...(previousPayload && typeof previousPayload === 'object' && !Array.isArray(previousPayload)
          ? previousPayload as Record<string, unknown>
          : {}),
        ...payload,
      },
    })

    if (continuityRetry != null) {
      await this.videosService.retryContinuityVideoGeneration({
        videoGenerationId: generation.id,
        runId: continuityRetry.runId,
        userId: continuityRetry.userId,
        episodeId: continuityRetry.episodeId,
      })
    }

    await this.databaseService.db
      .update(videoGenerations)
      .set({ status: 'pending', taskId: null, errorMsg: null, completedAt: null, updatedAt: this.now() })
      .where(eq(videoGenerations.id, generation.id))

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

    return { task_id: task.id, video_generation_id: generation.id }
  }

  async cancel(task: TaskRecord, currentUserId: number) {
    const [generation] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(and(eq(videoGenerations.id, task.domainId), eq(videoGenerations.userId, currentUserId), isNull(videoGenerations.deletedAt)))

    if (!generation) throw new NotFoundException('video_generation_not_found')

    await this.videosService.cancelVideoGeneration(
      generation.id,
      'Canceled by user',
    )

    await this.cancelTaskRecord(task, {
      provider: generation.provider || null,
      provider_task_id: generation.taskId || null,
    })
    return { canceled: true }
  }

  async refreshPresentation(task: TaskRecord) {
    const [generation] = await this.databaseService.db
      .select()
      .from(videoGenerations)
      .where(eq(videoGenerations.id, task.domainId))
    if (!generation) return

    const status = mapGenerationStatus(generation.status)
    const errorKind = status === 'failed' ? inferErrorKind(generation.errorMsg) : status === 'canceled' ? 'canceled' : null

    await this.syncTaskUpdate(task.id, {
      status,
      title: trimText(generation.prompt, 40) || task.title,
      progress: status === 'completed' ? 100 : status === 'queued' ? 0 : task.progress,
      providerTaskId: generation.taskId ?? null,
      resultSummaryJson: status === 'completed'
        ? JSON.stringify({
          video_url: toPublicMediaUrl(generation.videoUrl),
          image_url: toPublicMediaUrl(generation.firstFrameUrl || generation.imageUrl),
        })
        : null,
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
    await this.videosService.cancelVideoGeneration(
      task.domainId,
      'Canceled by worker',
    )
    await this.refreshPresentation(task)
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const message = error instanceof Error ? error.message : 'recover failed'
    await this.videosService.failVideoGeneration(task.domainId, message)
    await this.refreshPresentation(task)
    return true
  }

  async execute(task: TaskRecord) {
    if (task.status === 'running' && isTaskTooOldForResume(task)) {
      throw new Error('Video task too old to resume — provider download URL likely expired')
    }
    if (task.status === 'queued') {
      await this.databaseService.db
        .update(videoGenerations)
        .set({ status: 'processing', updatedAt: this.now() })
        .where(eq(videoGenerations.id, task.domainId))
      await this.refreshPresentation(task)
      await this.videosService.processVideoGeneration(task.domainId, task.aiConfigId)
      return 'video_queued'
    }

    const resumed = await this.videosService.resumeVideoGeneration(task.domainId, task.aiConfigId)
    if (!resumed && !task.providerTaskId && isStaleRunningTask(task)) {
      throw new Error('Video task was running without provider task id; manual retry required to avoid duplicate submission')
    }
    return 'video'
  }
}
