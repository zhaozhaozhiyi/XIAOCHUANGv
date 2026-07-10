import { eq } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { tasks } from '../../../db/schema'
import type { TaskRecord } from './task-domain-handler'

export abstract class BaseTaskDomainHandler {
  protected constructor(protected readonly databaseService: DatabaseService) {}

  protected now() {
    return new Date()
  }

  protected async syncTaskUpdate(taskId: number, values: Partial<typeof tasks.$inferInsert>) {
    await this.databaseService.db
      .update(tasks)
      .set({
        ...values,
        updatedAt: this.now(),
      })
      .where(eq(tasks.id, taskId))
  }

  protected async cancelTaskRecord(task: TaskRecord, details: Record<string, unknown> = {}) {
    await this.syncTaskUpdate(task.id, {
      status: 'canceled',
      progress: task.progress ?? 0,
      errorKind: 'canceled',
      errorMessage: 'Canceled by user',
      errorDetailsJson: JSON.stringify({
        error_kind: 'canceled',
        ...details,
        raw_error: 'Canceled by user',
      }),
      completedAt: this.now(),
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })
  }

  protected async isTaskCanceled(taskId: number) {
    const [latest] = await this.databaseService.db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
    return latest?.status === 'canceled'
  }
}
