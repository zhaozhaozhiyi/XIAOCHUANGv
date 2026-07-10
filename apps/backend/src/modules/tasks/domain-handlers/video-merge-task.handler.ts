import { Inject, Injectable, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../../common/media-url'
import { DatabaseService } from '../../../db/database.service'
import { videoMerges } from '../../../db/schema'
import { MergeService } from '../../merge/merge.service'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import { inferErrorKind, mapGenerationStatus, parseJsonValue, sanitizePayload, trimText } from './task-domain-utils'

function getPayloadVideos(payloadJson: string | null | undefined) {
  const payload = parseJsonValue(payloadJson)
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  return (payload as Record<string, unknown>).videos
}

@Injectable()
export class VideoMergeTaskHandler extends BaseTaskDomainHandler implements TaskDomainHandler {
  readonly domainTable = 'video_merges'

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(MergeService) private readonly mergeService: MergeService,
  ) {
    super(databaseService)
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const [merge] = await this.databaseService.db
      .select()
      .from(videoMerges)
      .where(eq(videoMerges.id, task.domainId))

    if (!merge) throw new NotFoundException('video_merge_not_found')

    const scenes = parseJsonValue(merge.scenes)
    const videos = Array.isArray(scenes) ? scenes : getPayloadVideos(task.payloadJson)

    await this.databaseService.db
      .update(videoMerges)
      .set({ status: 'pending', mergedUrl: null, duration: null, errorMsg: null, completedAt: null })
      .where(eq(videoMerges.id, merge.id))

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      payloadJson: sanitizePayload({ ...payload, episode_id: merge.episodeId, drama_id: merge.dramaId, videos }) ?? task.payloadJson,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })

    return { task_id: task.id, merge_id: merge.id }
  }

  async cancel(task: TaskRecord) {
    await this.databaseService.db
      .update(videoMerges)
      .set({ status: 'canceled', errorMsg: 'Canceled by user', completedAt: this.now() })
      .where(eq(videoMerges.id, task.domainId))

    await this.cancelTaskRecord(task)
    return { canceled: true }
  }

  async refreshPresentation(task: TaskRecord) {
    const [merge] = await this.databaseService.db
      .select()
      .from(videoMerges)
      .where(eq(videoMerges.id, task.domainId))
    if (!merge) return

    const status = mapGenerationStatus(merge.status)
    const errorKind = status === 'failed' ? inferErrorKind(merge.errorMsg) : status === 'canceled' ? 'canceled' : null

    await this.syncTaskUpdate(task.id, {
      status,
      progress: status === 'completed' ? 100 : status === 'queued' ? 0 : task.progress,
      providerTaskId: merge.taskId ?? null,
      resultSummaryJson: status === 'completed' ? JSON.stringify({ video_url: toPublicMediaUrl(merge.mergedUrl) }) : null,
      errorKind,
      errorMessage: status === 'failed' || status === 'canceled'
        ? trimText(merge.errorMsg || (status === 'canceled' ? 'Task canceled' : 'Task failed'), 240)
        : null,
      errorDetailsJson: errorKind
        ? JSON.stringify({
          error_kind: errorKind,
          provider: merge.provider || null,
          provider_task_id: merge.taskId || null,
          raw_error: merge.errorMsg || null,
        })
        : null,
      completedAt: status === 'completed' || status === 'failed' || status === 'canceled' ? merge.completedAt || this.now() : null,
    })
  }

  async markCanceled(task: TaskRecord) {
    await this.databaseService.db
      .update(videoMerges)
      .set({ status: 'canceled', errorMsg: 'Canceled by worker', completedAt: this.now() })
      .where(eq(videoMerges.id, task.domainId))
    await this.refreshPresentation(task)
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const message = error instanceof Error ? error.message : 'recover failed'
    await this.databaseService.db
      .update(videoMerges)
      .set({ status: 'failed', errorMsg: message, completedAt: this.now() })
      .where(eq(videoMerges.id, task.domainId))
    await this.refreshPresentation(task)
    return true
  }

  async execute(task: TaskRecord) {
    await this.mergeService.processVideoMerge(task.domainId)
    return task.status === 'queued' ? 'video_merge_queued' : 'video_merge'
  }
}
