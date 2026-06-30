import { Inject, Injectable, Logger } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { canvasRuns, canvasTasks, canvases } from '../../../db/schema'
import { CanvasInputResolverService } from './canvas-input-resolver.service'
import type { CanvasGenerateContext } from './canvas-execution.types'
import { CanvasModuleRouterService } from './canvas-module-router.service'
import { CanvasResultBackfillService } from './canvas-result-backfill.service'

function now() {
  return new Date()
}

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

@Injectable()
export class CanvasExecutionService {
  private readonly logger = new Logger(CanvasExecutionService.name)

  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CanvasInputResolverService) private readonly inputResolver: CanvasInputResolverService,
    @Inject(CanvasModuleRouterService) private readonly moduleRouter: CanvasModuleRouterService,
    @Inject(CanvasResultBackfillService) private readonly backfillService: CanvasResultBackfillService,
  ) {}

  async executeCanvasTaskById(canvasTaskId: string, userId: number, workerId: string): Promise<'completed' | 'failed'> {
    const [task] = await this.db.db.select().from(canvasTasks).where(eq(canvasTasks.id, canvasTaskId))
    if (!task) return 'failed'

    if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
      return task.status === 'completed' ? 'completed' : 'failed'
    }

    const [run] = await this.db.db.select().from(canvasRuns).where(eq(canvasRuns.id, task.runId))
    if (!run || run.status === 'cancelled') {
      await this.markFailed(task.id, 'run_cancelled')
      return 'failed'
    }

    const claimed = await this.claimTask(task.id, workerId)
    if (!claimed) return 'failed'

    const params = safeJsonParse<Record<string, unknown>>(task.paramsJson, {})
    const context: CanvasGenerateContext = {
      source: 'canvas',
      userId: String(userId),
      canvasId: task.canvasId,
      versionId: run.versionId,
      nodeId: task.nodeId,
    }

    try {
      await this.db.db
        .update(canvasTasks)
        .set({ progress: 10 })
        .where(eq(canvasTasks.id, task.id))

      const inputs = await this.inputResolver.resolve(task.canvasId, task.runId, task.nodeId, params)
      const result = await this.moduleRouter.execute(task.nodeDefId, params, inputs, context)

      await this.db.db
        .update(canvasTasks)
        .set({
          status: 'completed',
          progress: 100,
          resultJson: JSON.stringify(result),
          completedAt: now(),
        })
        .where(eq(canvasTasks.id, task.id))

      await this.backfillService.backfill(task.canvasId, task.nodeId, task.nodeDefId, result)

      this.logger.log(JSON.stringify({ event: 'canvas.task.completed', canvasTaskId: task.id, workerId }))
      return 'completed'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'canvas_task_failed'
      await this.markFailed(task.id, message)
      this.logger.error(JSON.stringify({ event: 'canvas.task.failed', canvasTaskId: task.id, error: message, workerId }))
      return 'failed'
    }
  }

  private async claimTask(canvasTaskId: string, workerId: string): Promise<boolean> {
    const [task] = await this.db.db.select().from(canvasTasks).where(eq(canvasTasks.id, canvasTaskId))
    if (!task) return false
    if (task.status !== 'pending' && task.status !== 'queued') return false

    await this.db.db
      .update(canvasTasks)
      .set({ status: 'running', startedAt: now() })
      .where(and(eq(canvasTasks.id, canvasTaskId), eq(canvasTasks.status, task.status)))

    const [updated] = await this.db.db.select().from(canvasTasks).where(eq(canvasTasks.id, canvasTaskId))
    return updated?.status === 'running'
  }

  private async markFailed(canvasTaskId: string, message: string) {
    await this.db.db
      .update(canvasTasks)
      .set({
        status: 'failed',
        errorMessage: message.slice(0, 500),
        progress: 0,
        completedAt: now(),
      })
      .where(eq(canvasTasks.id, canvasTaskId))
  }
}
