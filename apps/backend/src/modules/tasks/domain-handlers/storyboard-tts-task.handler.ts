import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../../common/media-url'
import { DatabaseService } from '../../../db/database.service'
import { storyboards, tasks } from '../../../db/schema'
import { AudioService } from '../../audio/audio.service'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import { parseTaskPayload, sanitizePayload } from './task-domain-utils'

@Injectable()
export class StoryboardTtsTaskHandler extends BaseTaskDomainHandler implements TaskDomainHandler {
  readonly domainTable = 'storyboard_tts'

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(AudioService) private readonly audioService: AudioService,
  ) {
    super(databaseService)
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, task.domainId))

    if (!storyboard) throw new NotFoundException('storyboard_not_found')

    const text = String(payload.text || '').trim()
    if (!text) throw new ConflictException('当前配音任务缺少可重试文本')

    await this.databaseService.db
      .update(storyboards)
      .set({ ttsAudioUrl: null, updatedAt: this.now() })
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
      .set({ updatedAt: this.now() })
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

    const status = storyboard.ttsAudioUrl ? 'completed' : task.status
    await this.syncTaskUpdate(task.id, {
      status,
      progress: status === 'completed' ? 100 : task.progress,
      resultSummaryJson: status === 'completed' ? JSON.stringify({ audio_url: toPublicMediaUrl(storyboard.ttsAudioUrl) }) : null,
      completedAt: status === 'completed' ? this.now() : task.completedAt,
    })
  }

  async markCanceled(task: TaskRecord) {
    const timestamp = this.now()
    await this.databaseService.db
      .update(tasks)
      .set({
        status: 'canceled',
        errorKind: 'canceled',
        errorMessage: 'Canceled by worker',
        errorDetailsJson: JSON.stringify({ error_kind: 'canceled', raw_error: 'Canceled by worker' }),
        completedAt: timestamp,
        updatedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })
      .where(eq(tasks.id, task.id))
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const timestamp = this.now()
    const message = error instanceof Error ? error.message : 'recover failed'
    await this.databaseService.db
      .update(tasks)
      .set({
        status: 'failed',
        errorKind: 'provider',
        errorMessage: message,
        errorDetailsJson: JSON.stringify({ error_kind: 'provider', raw_error: message }),
        completedAt: timestamp,
        updatedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })
      .where(eq(tasks.id, task.id))
    return true
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task)
    const text = String(payload.text || '').trim()
    if (!text) throw new Error(`TTS task ${task.id} missing text payload`)

    await this.audioService.processStoryboardTtsTask(task.id)
    if (await this.isTaskCanceled(task.id)) return 'storyboard_tts_canceled'
    return 'storyboard_tts'
  }
}
