import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { canvasRuns, canvasTasks, canvases } from '../../../db/schema'
import { TaskQueueService } from '../../queue/task-queue.service'
import { ExecutionPlanService } from '../execution-plan/execution-plan.service'
import type { ExecutionPlan } from '../execution-plan/execution-plan.types'
import { CanvasExecutionService } from './canvas-execution.service'

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'skipped'])

function now() {
  return new Date()
}

@Injectable()
export class CanvasRunOrchestratorService {
  private readonly logger = new Logger(CanvasRunOrchestratorService.name)

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(ExecutionPlanService) private readonly executionPlanService: ExecutionPlanService,
    @Inject(TaskQueueService) private readonly taskQueueService: TaskQueueService,
    @Inject(CanvasExecutionService) private readonly canvasExecutionService: CanvasExecutionService,
  ) {}

  /** 异步启动 run：构建计划 → 入队第一阶段 */
  async startRun(runId: string, userId: number): Promise<void> {
    const plan = await this.executionPlanService.buildAndStart(runId)
    await this.enqueueStage(plan, 0, userId)
  }

  /** Worker 或同步执行完成后回调，推进下一阶段 / 终结 run */
  async onTaskSettled(canvasTaskId: string): Promise<void> {
    const [task] = await this.db.db.select().from(canvasTasks).where(eq(canvasTasks.id, canvasTaskId))
    if (!task) return

    const plan = await this.executionPlanService.rebuildPlan(task.runId)
    if (!plan) return

    const stageIndex = plan.stages.findIndex((stage) => stage.tasks.some((t) => t.taskId === canvasTaskId))
    if (stageIndex < 0) {
      await this.finalizeRun(task.runId)
      return
    }

    const stage = plan.stages[stageIndex]
    const stageTasks = await this.loadTasksForStage(task.runId, stage.tasks.map((t) => t.taskId))
    const stageDone = stageTasks.every((t) => TERMINAL.has(t.status))

    if (stageDone) {
      const [run] = await this.db.db.select().from(canvasRuns).where(eq(canvasRuns.id, task.runId))
      if (run?.status === 'cancelled') return

      const userId = await this.resolveRunUserId(task.runId)
      if (stageIndex + 1 < plan.stages.length) {
        await this.enqueueStage(plan, stageIndex + 1, userId)
      }
    }

    await this.finalizeRun(task.runId)
  }

  private async loadTasksForStage(runId: string, taskIds: string[]) {
    const rows = await this.db.db.select().from(canvasTasks).where(eq(canvasTasks.runId, runId))
    const idSet = new Set(taskIds)
    return rows.filter((r) => idSet.has(r.id))
  }

  private async resolveRunUserId(runId: string): Promise<number> {
    const [run] = await this.db.db.select().from(canvasRuns).where(eq(canvasRuns.id, runId))
    if (!run) return 0
    const [canvas] = await this.db.db.select().from(canvases).where(eq(canvases.id, run.canvasId))
    return canvas?.userId ?? 0
  }

  private async enqueueStage(plan: ExecutionPlan, stageIndex: number, userId: number): Promise<void> {
    const stage = plan.stages[stageIndex]
    if (!stage) return

    const inline = process.env.CANVAS_EXECUTION_INLINE === '1'

    for (const node of stage.tasks) {
      const [existing] = await this.db.db.select().from(canvasTasks).where(eq(canvasTasks.id, node.taskId))
      if (!existing || TERMINAL.has(existing.status) || existing.status === 'running' || existing.status === 'queued') {
        continue
      }

      await this.db.db
        .update(canvasTasks)
        .set({ status: 'queued' })
        .where(eq(canvasTasks.id, node.taskId))

      if (inline) {
        void this.canvasExecutionService
          .executeCanvasTaskById(node.taskId, userId, `inline-${process.pid}`)
          .then(() => this.onTaskSettled(node.taskId))
          .catch((err) => this.logger.error(`inline canvas task failed: ${node.taskId}`, err))
        continue
      }

      const jobId = await this.taskQueueService.enqueueCanvasTask({ canvasTaskId: node.taskId, userId })
      await this.db.db
        .update(canvasTasks)
        .set({ bullmqJobId: jobId ?? null })
        .where(eq(canvasTasks.id, node.taskId))
    }
  }

  private async finalizeRun(runId: string): Promise<void> {
    const tasks = await this.db.db.select().from(canvasTasks).where(eq(canvasTasks.runId, runId))
    if (!tasks.length) return

    const completed = tasks.filter((t) => t.status === 'completed').length
    const failed = tasks.filter((t) => t.status === 'failed').length
    const skipped = tasks.filter((t) => t.status === 'skipped').length
    const pending = tasks.filter((t) => !TERMINAL.has(t.status)).length

    const progress = tasks.length ? completed / tasks.length : 0

    await this.db.db
      .update(canvasRuns)
      .set({
        completedNodes: completed,
        failedNodes: failed,
        skippedNodes: skipped,
        progress,
      })
      .where(eq(canvasRuns.id, runId))

    if (pending > 0) return

    const [run] = await this.db.db.select().from(canvasRuns).where(eq(canvasRuns.id, runId))
    if (!run || run.status === 'cancelled') return

    let status: string
    if (failed === 0) status = 'completed'
    else if (completed === 0) status = 'failed'
    else status = 'partially-failed'

    await this.db.db
      .update(canvasRuns)
      .set({ status, completedAt: now() })
      .where(eq(canvasRuns.id, runId))
  }
}
