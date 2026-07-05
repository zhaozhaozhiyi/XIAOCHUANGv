import type { tasks } from '../../../db/schema'
import type { TaskActionResponse } from '../tasks.types'

export type TaskRecord = typeof tasks.$inferSelect

export interface TaskDomainHandler {
  readonly domainTable: string
  retry(task: TaskRecord, payload: Record<string, unknown>): Promise<TaskActionResponse>
  cancel(task: TaskRecord, currentUserId: number): Promise<TaskActionResponse>
  refreshPresentation(task: TaskRecord): Promise<void>
  markCanceled(task: TaskRecord): Promise<boolean>
  markFailed(task: TaskRecord, error: unknown): Promise<boolean>
  execute(task: TaskRecord): Promise<string>
}
