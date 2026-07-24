import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../../common/media-url'
import { DatabaseService } from '../../../db/database.service'
import { storyboards } from '../../../db/schema'
import { ComposeService } from '../../compose/compose.service'
import { assertLegacyEpisodeProductionAllowed } from '../../drama-workspace/continuity-production-gate'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import { sanitizePayload } from './task-domain-utils'

@Injectable()
export class StoryboardComposeTaskHandler extends BaseTaskDomainHandler implements TaskDomainHandler {
  readonly domainTable = 'storyboard_compose'

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(ComposeService) private readonly composeService: ComposeService,
  ) {
    super(databaseService)
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, task.domainId))

    if (!storyboard) throw new NotFoundException('storyboard_not_found')
    if (!storyboard.videoUrl) throw new ConflictException('当前分镜缺少可合成视频')
    await assertLegacyEpisodeProductionAllowed(
      this.databaseService,
      storyboard.episodeId,
      storyboard.userId ?? task.userId,
    )

    await this.databaseService.db
      .update(storyboards)
      .set({ status: 'compose_queued', composedVideoUrl: null, updatedAt: this.now() })
      .where(eq(storyboards.id, storyboard.id))

    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
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

    return { task_id: task.id, storyboard_id: storyboard.id, status: 'queued' }
  }

  async cancel(task: TaskRecord) {
    await this.databaseService.db
      .update(storyboards)
      .set({ status: 'compose_canceled', composedVideoUrl: null, updatedAt: this.now() })
      .where(eq(storyboards.id, task.domainId))

    await this.cancelTaskRecord(task)
    return { canceled: true }
  }

  async refreshPresentation(task: TaskRecord) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, task.domainId))
    if (!storyboard) return

    const status = storyboard.status === 'compose_failed'
      ? 'failed'
      : storyboard.status === 'compose_canceled'
        ? 'canceled'
        : storyboard.composedVideoUrl
          ? 'completed'
          : storyboard.status === 'compose_processing'
            ? 'running'
            : 'queued'

    await this.syncTaskUpdate(task.id, {
      status,
      progress: status === 'completed' ? 100 : status === 'queued' ? 0 : task.progress,
      resultSummaryJson: status === 'completed' ? JSON.stringify({ video_url: toPublicMediaUrl(storyboard.composedVideoUrl) }) : null,
      errorKind: status === 'canceled' ? 'canceled' : task.errorKind,
      errorMessage: status === 'canceled' ? 'Canceled by user' : task.errorMessage,
      completedAt: status === 'completed' || status === 'failed' || status === 'canceled' ? this.now() : null,
    })
  }

  async markCanceled(task: TaskRecord) {
    await this.databaseService.db
      .update(storyboards)
      .set({ status: 'compose_canceled', composedVideoUrl: null, updatedAt: this.now() })
      .where(eq(storyboards.id, task.domainId))
    await this.refreshPresentation(task)
    return true
  }

  async markFailed(task: TaskRecord) {
    await this.databaseService.db
      .update(storyboards)
      .set({ status: 'compose_failed', composedVideoUrl: null, updatedAt: this.now() })
      .where(eq(storyboards.id, task.domainId))
    await this.refreshPresentation(task)
    return true
  }

  async execute(task: TaskRecord) {
    await this.composeService.composeStoryboard(task.domainId)
    return task.status === 'queued' ? 'storyboard_compose_queued' : 'storyboard_compose'
  }
}
