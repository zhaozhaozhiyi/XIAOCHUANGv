import { Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { canvasNodes, canvasEdges, canvasRuns, canvasTasks } from '../../../db/schema'
import { ExecutionPlanEngine } from './execution-plan.engine'
import type { ExecutionPlan } from './execution-plan.types'

function now() { return new Date() }

const EXECUTE_TYPES = ['text-to-image', 'image-to-video', 'text-to-speech', 'concat', 'export']

@Injectable()
export class ExecutionPlanService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    private readonly engine: ExecutionPlanEngine,
  ) {}

  async buildAndStart(runId: string): Promise<ExecutionPlan> {
    const plan = await this.rebuildPlan(runId)
    if (!plan) throw new Error('run_not_found')

    await this.db.db.update(canvasRuns).set({ status: 'running', startedAt: now() }).where(eq(canvasRuns.id, runId))

    return plan
  }

  async rebuildPlan(runId: string): Promise<ExecutionPlan | null> {
    const [run] = await this.db.db.select().from(canvasRuns).where(eq(canvasRuns.id, runId))
    if (!run) return null

    const tasks = await this.db.db.select().from(canvasTasks).where(eq(canvasTasks.runId, runId))
    const allCanvasNodes = await this.db.db.select().from(canvasNodes).where(eq(canvasNodes.canvasId, run.canvasId))
    const dataflowEdges = await this.db.db.select().from(canvasEdges).where(eq(canvasEdges.canvasId, run.canvasId))
    const dfEdges = dataflowEdges.filter((e) => e.edgeKind === 'dataflow')

    const taskNodeIds = new Set(tasks.map((t) => t.nodeId))
    const executeForPlan = allCanvasNodes.filter(
      (n) => taskNodeIds.has(n.id) && EXECUTE_TYPES.includes(n.nodeDefId),
    )

    const plan = this.engine.buildPlan(
      executeForPlan.map((n) => ({ nodeId: n.id, nodeDefId: n.nodeDefId, data: JSON.parse(n.dataJson || '{}') })),
      allCanvasNodes.map((n) => ({ id: n.id, nodeDefId: n.nodeDefId, data: JSON.parse(n.dataJson || '{}') })),
      dfEdges.map((e) => ({ sourceNodeId: e.sourceNodeId, targetNodeId: e.targetNodeId, sourcePort: e.sourcePort, targetPort: e.targetPort })),
      tasks.map((t) => ({ id: t.id, nodeId: t.nodeId, nodeDefId: t.nodeDefId })),
    )

    plan.runId = runId
    plan.canvasId = run.canvasId
    plan.versionId = run.versionId

    return plan
  }

  getExecutorModule(nodeDefId: string): { module: string; method: string } | null {
    const m: Record<string, { module: string; method: string }> = {
      'text-to-image': { module: 'images', method: 'generate' },
      'image-to-video': { module: 'videos', method: 'generate' },
      'text-to-speech': { module: 'audio', method: 'synthesize' },
      concat: { module: 'compose', method: 'concat' },
      export: { module: 'assets', method: 'exportVideo' },
    }
    return m[nodeDefId] ?? null
  }
}
