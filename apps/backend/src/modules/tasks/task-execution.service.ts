import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { taskLogs, tasks } from '../../db/schema'
import { TaskDomainRegistry } from './task-domain.registry'

// 视频生成 provider 超时最长 10 分钟（见 videos.service.ts AbortSignal.timeout(600_000)），
// 锁 TTL 必须大于所有 provider 超时，否则锁过期后 recover worker 会抢走任务重跑、重复扣费。
const LOCK_TTL_MS = 15 * 60_000
const MAX_RETRY_ATTEMPTS = 7
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'canceled', 'cancelled', 'dead_letter'])

function isCanceledError(error: unknown) {
  return error instanceof Error && error.message.toLowerCase().includes('canceled')
}

function isTerminalTaskStatus(status: string) {
  return TERMINAL_TASK_STATUSES.has(status)
}

@Injectable()
export class TaskExecutionService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TaskDomainRegistry) private readonly taskDomainRegistry: TaskDomainRegistry,
  ) {}

  private log(task: typeof tasks.$inferSelect, message: string, level = 'info', metadata?: Record<string, unknown>) {
    void this.databaseService.db.insert(taskLogs).values({
      taskId: task.id,
      userId: task.userId ?? null,
      level,
      message,
      metadataJson: metadata ? JSON.stringify(metadata) : null,
      createdAt: this.now(),
    }).catch(() => undefined)
  }

  private now() {
    return new Date()
  }

  async listPendingTasks(limit: number) {
    return this.databaseService.db
      .select()
      .from(tasks)
      .where(and(inArray(tasks.status, ['queued', 'running']), isNull(tasks.deletedAt)))
      .orderBy(tasks.updatedAt)
      .limit(limit)
  }

  async recoverPendingTasks(limit: number, dryRun: boolean, workerId: string) {
    const pendingTasks = await this.listPendingTasks(limit)
    let recovered = 0
    const failures: Array<{ id: number; error: string }> = []
    const pending: Array<{ id: number; status: string; domainTable: string; domainId: number }> = []

    for (const task of pendingTasks) {
      try {
        if (dryRun) {
          pending.push({
            id: task.id,
            status: task.status,
            domainTable: task.domainTable,
            domainId: task.domainId,
          })
          recovered += 1
          continue
        }

        const kind = await this.executeTask(task, workerId)
        if (kind !== 'unknown') recovered += 1
      } catch (error) {
        if (isCanceledError(error)) {
          await this.markTaskCanceled(task)
        } else {
          await this.markTaskFailed(task, error)
        }
        failures.push({
          id: task.id,
          error: error instanceof Error ? error.message : 'recover failed',
        })
      }
    }

    return {
      checked: pendingTasks.length,
      recovered,
      dryRun,
      pending,
      failures,
    }
  }

  async executeTaskById(taskId: number, workerId: string) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))

    if (!task || task.deletedAt) {
      return 'missing'
    }

    try {
      return await this.executeTask(task, workerId)
    } catch (error) {
      if (isCanceledError(error)) {
        await this.markTaskCanceled(task)
      } else {
        await this.markTaskFailed(task, error)
      }
      throw error
    }
  }

  private async refreshTaskLock(taskId: number, workerId: string) {
    const timestamp = this.now()
    // 仅刷新自己持有的锁，避免并发下覆盖其他 worker 已抢占的锁
    await this.databaseService.db
      .update(tasks)
      .set({
        lockedBy: workerId,
        lockedAt: timestamp,
        lockExpiresAt: new Date(timestamp.getTime() + LOCK_TTL_MS),
        updatedAt: timestamp,
      })
      .where(and(eq(tasks.id, taskId), eq(tasks.lockedBy, workerId)))
  }

  private async claimQueuedTask(task: typeof tasks.$inferSelect, workerId: string) {
    const timestamp = this.now()
    this.log(task, `任务开始执行 (worker: ${workerId})`, 'info', {
      worker_id: workerId,
      attempt: (task.attemptCount ?? 0) + 1,
    })
    const [claimed] = await this.databaseService.db
      .update(tasks)
      .set({
        status: 'running',
        attemptCount: (task.attemptCount ?? 0) + 1,
        lockedBy: workerId,
        lockedAt: timestamp,
        lockExpiresAt: new Date(timestamp.getTime() + LOCK_TTL_MS),
        startedAt: task.startedAt ?? timestamp,
        updatedAt: timestamp,
      })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, 'queued'), isNull(tasks.deletedAt)))
      .returning({ id: tasks.id })

    return !!claimed
  }

  private canRecoverRunningTask(task: typeof tasks.$inferSelect, workerId: string) {
    if (!task.lockedBy) return true
    if (task.lockedBy === workerId) return true
    const expiresAt = task.lockExpiresAt instanceof Date ? task.lockExpiresAt.getTime() : Date.parse(String(task.lockExpiresAt || ''))
    return Number.isFinite(expiresAt) && expiresAt <= Date.now()
  }

  private async markTaskCanceled(task: typeof tasks.$inferSelect) {
    this.log(task, '任务被取消', 'warn', { domain_table: task.domainTable, domain_id: task.domainId })
    await this.taskDomainRegistry.markCanceled(task)
  }

  private async markTaskDeadLetter(task: typeof tasks.$inferSelect) {
    const timestamp = this.now()
    this.log(task, `任务已达最大重试次数(${MAX_RETRY_ATTEMPTS})，转为死信`, 'warn', {
      attempt_count: task.attemptCount ?? 0,
      max_attempts: MAX_RETRY_ATTEMPTS,
    })
    await this.databaseService.db
      .update(tasks)
      .set({
        status: 'dead_letter',
        errorKind: 'exhausted',
        errorMessage: `已达到最大重试次数(${MAX_RETRY_ATTEMPTS})，任务已转为死信`,
        errorDetailsJson: JSON.stringify({
          error_kind: 'exhausted',
          attempt_count: task.attemptCount ?? 0,
          max_attempts: MAX_RETRY_ATTEMPTS,
          raw_error: 'Retry limit exceeded',
        }),
        completedAt: timestamp,
        updatedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
      })
      .where(eq(tasks.id, task.id))
  }

  private async markTaskFailed(task: typeof tasks.$inferSelect, error: unknown) {
    const message = error instanceof Error ? error.message : 'recover failed'
    this.log(task, `任务失败: ${message}`, 'error', { domain_table: task.domainTable, domain_id: task.domainId, error: message })
    await this.taskDomainRegistry.markFailed(task, error)
  }

  private async executeTask(task: typeof tasks.$inferSelect, workerId: string) {
    if (isTerminalTaskStatus(task.status)) return `terminal:${task.status}`

    if (task.status === 'queued') {
      if ((task.attemptCount ?? 0) >= MAX_RETRY_ATTEMPTS) {
        await this.markTaskDeadLetter(task)
        return 'dead_letter'
      }
      if (!(await this.claimQueuedTask(task, workerId))) return 'claimed_elsewhere'
    }
    if (task.status === 'running' && !this.canRecoverRunningTask(task, workerId)) return 'locked_elsewhere'
    if (task.status === 'running') await this.refreshTaskLock(task.id, workerId)

    // 长任务（如视频生成轮询最长 50 分钟）执行期间周期性续租，避免锁 TTL 过期后被
    // recover worker 抢占重跑、重复扣费。refreshTaskLock 带 WHERE lockedBy=workerId，
    // 仅刷新自己持有的锁；新 claim 的 queued 任务 lockedBy 已置为 workerId，同样命中。
    const heartbeat = setInterval(() => {
      void this.refreshTaskLock(task.id, workerId).catch(() => undefined)
    }, Math.floor(LOCK_TTL_MS / 3))
    try {
      return await this.taskDomainRegistry.execute(task)
    } finally {
      clearInterval(heartbeat)
    }
  }
}
