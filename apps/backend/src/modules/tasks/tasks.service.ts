import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, desc, eq, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { taskLogs, tasks } from '../../db/schema'
import { TaskQueueService } from '../queue/task-queue.service'
import { TaskDomainRegistry } from './task-domain.registry'

type CurrentUser = {
  id: number
}

const MAX_RETRY_ATTEMPTS = 7

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

@Injectable()
export class TasksService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TaskQueueService) private readonly taskQueueService: TaskQueueService,
    @Inject(TaskDomainRegistry) private readonly taskDomainRegistry: TaskDomainRegistry,
  ) {}

  private now() {
    return new Date()
  }

  async appendTaskLog(args: {
    taskId: number
    userId?: number
    level?: string
    message: string
    metadata?: Record<string, unknown>
  }) {
    await this.databaseService.db.insert(taskLogs).values({
      taskId: args.taskId,
      userId: args.userId ?? null,
      level: args.level ?? 'info',
      message: args.message,
      metadataJson: args.metadata ? JSON.stringify(args.metadata) : null,
      createdAt: this.now(),
    })
  }

  async listTaskLogs(taskId: number, limit = 50) {
    const [task] = await this.databaseService.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.id, taskId))

    if (!task) throw new NotFoundException('task_not_found')

    const rows = await this.databaseService.db
      .select()
      .from(taskLogs)
      .where(eq(taskLogs.taskId, taskId))
      .orderBy(desc(taskLogs.createdAt))
      .limit(limit)

    return rows.map((row) => ({
      ...row,
      metadata: row.metadataJson ? JSON.parse(row.metadataJson) : null,
      metadataJson: undefined,
    }))
  }

  async loadOwnedTask(taskId: number, userId: number) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId), isNull(tasks.deletedAt)))

    return task || null
  }

  private parseRetryPayload(task: typeof tasks.$inferSelect) {
    const raw = parseJsonValue(task.payloadJson)
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    return raw as Record<string, unknown>
  }

  async retryTask(taskId: number, currentUser: CurrentUser) {
    const task = await this.loadOwnedTask(taskId, currentUser.id)
    if (!task) throw new NotFoundException('task_not_found')

    const payload = this.parseRetryPayload(task)
    if (!payload) throw new ConflictException('当前任务缺少可重试参数')

    if (!['failed', 'canceled'].includes(task.status)) {
      throw new ConflictException('当前任务状态不能重试')
    }

    if ((task.attemptCount ?? 0) >= MAX_RETRY_ATTEMPTS) {
      throw new ConflictException(`已达到最大重试次数(${MAX_RETRY_ATTEMPTS})，无法继续重试`)
    }

    await this.appendTaskLog({
      taskId: task.id,
      userId: currentUser.id,
      level: 'info',
      message: `用户手动重试任务 (attempt ${(task.attemptCount ?? 0) + 1})`,
      metadata: { domain_table: task.domainTable, domain_id: task.domainId },
    })

    const response = await this.taskDomainRegistry.retry(task, payload)
    await this.taskQueueService.enqueueTask(task.id, { replaceExisting: true })
    return response
  }

  async cancelTask(taskId: number, currentUser: CurrentUser) {
    const task = await this.loadOwnedTask(taskId, currentUser.id)
    if (!task) throw new NotFoundException('task_not_found')

    if (!['queued', 'running'].includes(task.status)) {
      throw new ConflictException('当前任务状态不能取消')
    }

    const response = await this.taskDomainRegistry.cancel(task, currentUser.id)
    await this.taskQueueService.removeTask(task.id)
    return response
  }

  async refreshTaskPresentation(taskId: number) {
    return this.taskDomainRegistry.refreshPresentation(taskId)
  }
}
