import { Inject, Injectable, Optional } from '@nestjs/common'
import { and, eq, inArray, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { taskLogs, tasks } from '../../db/schema'
import {
  AgentExecutionService,
  type AgentExecutionRecord,
} from '../agent-runtime/agent-execution.service'
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service'
import { TaskDomainRegistry } from './task-domain.registry'

const LOCK_TTL_MS = 10 * 60_000
const MAX_RETRY_ATTEMPTS = 7
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'canceled', 'cancelled', 'dead_letter'])
const ACTIVE_AGENT_EXECUTION_STATUSES = new Set([
  'created',
  'queued',
  'starting',
  'running',
  'checkpointed',
  'stopping',
])

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
    @Optional()
    @Inject(AgentRuntimeService)
    private readonly agentRuntimeService?: AgentRuntimeService,
    @Optional()
    @Inject(AgentExecutionService)
    private readonly agentExecutionService?: AgentExecutionService,
  ) {}

  private log(task: typeof tasks.$inferSelect, message: string, level = 'info', metadata?: Record<string, unknown>) {
    void this.databaseService.db.insert(taskLogs).values({
      taskId: task.id,
      userId: task.userId ?? null,
      organizationId: task.organizationId ?? null,
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
    const agentRuntime = !dryRun && this.agentRuntimeService
      ? await this.agentRuntimeService.reconcileActive(limit).catch((error) => ({
          enabled: this.agentRuntimeService?.isEnabled() ?? false,
          checked: 0,
          reconciled: 0,
          orphaned: 0,
          failures: [error instanceof Error ? error.message : 'agent_runtime_recovery_failed'],
        }))
      : null
    const pendingTasks = await this.listPendingTasks(limit)
    const latestAgentExecutions = !dryRun && this.agentExecutionService
      ? await this.agentExecutionService.findLatestForTaskIds(
          pendingTasks.map((task) => task.id),
        )
      : []
    const latestAgentExecutionByTaskId = new Map(
      latestAgentExecutions.map((execution) => [execution.taskId, execution]),
    )
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

        const agentExecution = latestAgentExecutionByTaskId.get(task.id)
        if (agentExecution && task.status === 'running') {
          const recovery = await this.reconcileAgentTask(
            task,
            agentExecution,
          )
          if (recovery === 'active_remote_run') continue
          if (recovery === 'terminal_reconciled') {
            recovered += 1
            continue
          }
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
      agentRuntime,
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
    await this.databaseService.db
      .update(tasks)
      .set({
        lockedBy: workerId,
        lockedAt: timestamp,
        lockExpiresAt: new Date(timestamp.getTime() + LOCK_TTL_MS),
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId))
  }

  private async releaseDeferredTaskLock(taskId: number, workerId: string) {
    const timestamp = this.now()
    await this.databaseService.db
      .update(tasks)
      .set({
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
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

  private async reconcileAgentTask(
    task: typeof tasks.$inferSelect,
    execution: AgentExecutionRecord,
  ) {
    if (
      ACTIVE_AGENT_EXECUTION_STATUSES.has(execution.status) &&
      Boolean(execution.remoteRunId)
    ) {
      return 'active_remote_run' as const
    }

    if (execution.status === 'orphaned') return 'resume_attempt' as const

    if (execution.status === 'canceled') {
      await this.markTaskCanceled(task)
      return 'terminal_reconciled' as const
    }

    if (execution.status === 'failed' || execution.status === 'completed') {
      const message =
        execution.status === 'completed'
          ? 'Agent 已结束，但未通过受控工具提交当前阶段所需产物'
          : execution.errorMessage || 'AI 生产任务执行失败'
      await this.markTaskFailed(task, new Error(message))
      return 'terminal_reconciled' as const
    }

    return 'resume_attempt' as const
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

    const result = await this.taskDomainRegistry.execute(task)
    if (typeof result === 'string' && result.endsWith('_agent_runtime')) {
      await this.releaseDeferredTaskLock(task.id, workerId)
    }
    return result
  }
}
