import { Inject, Injectable } from '@nestjs/common'

import { DatabaseService } from '../../../db/database.service'
import { DialogueContinuityService } from '../../audio/dialogue-continuity.service'
import { BaseTaskDomainHandler } from './base-task-domain.handler'
import type { TaskDomainHandler, TaskRecord } from './task-domain-handler'
import { inferErrorKind, parseTaskPayload, sanitizePayload } from './task-domain-utils'

@Injectable()
export class EpisodeDialogueTakeTaskHandler
  extends BaseTaskDomainHandler
  implements TaskDomainHandler {
  readonly domainTable = 'episode_dialogue_takes'

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(DialogueContinuityService)
    private readonly dialogueContinuityService: DialogueContinuityService,
  ) {
    super(databaseService)
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    await this.dialogueContinuityService.retryDialogueTakeTask(task.id)
    await this.syncTaskUpdate(task.id, {
      status: 'queued',
      progress: 0,
      payloadJson: sanitizePayload(payload) ?? task.payloadJson,
      resultSummaryJson: null,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })
    return { task_id: task.id, dialogue_take_id: task.domainId, status: 'queued' }
  }

  async cancel(task: TaskRecord) {
    await this.dialogueContinuityService.cancelDialogueTakeTask(task.id)
    await this.cancelTaskRecord(task, { dialogue_take_id: task.domainId })
    return { canceled: true }
  }

  async refreshPresentation(task: TaskRecord) {
    await this.dialogueContinuityService.refreshDialogueTakeTask(task.id)
  }

  async markCanceled(task: TaskRecord) {
    await this.dialogueContinuityService.cancelDialogueTakeTask(task.id, 'Canceled by worker')
    await this.cancelTaskRecord(task, { dialogue_take_id: task.domainId, source: 'worker' })
    return true
  }

  async markFailed(task: TaskRecord, error: unknown) {
    await this.dialogueContinuityService.failDialogueTakeTask(task.id, error)
    const message = error instanceof Error ? error.message : 'dialogue_take_generation_failed'
    const errorKind = inferErrorKind(message)
    await this.syncTaskUpdate(task.id, {
      status: 'failed',
      errorKind,
      errorMessage: message,
      errorDetailsJson: JSON.stringify({
        error_kind: errorKind,
        dialogue_take_id: task.domainId,
        raw_error: message,
      }),
      completedAt: this.now(),
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })
    return true
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task)
    if (Number(payload.dialogue_take_id) !== task.domainId) {
      throw new Error(`Dialogue take task ${task.id} has invalid payload`)
    }
    await this.dialogueContinuityService.processDialogueTakeTask(task.id)
    await this.dialogueContinuityService.refreshDialogueTakeTask(task.id)
    return 'episode_dialogue_take'
  }
}
