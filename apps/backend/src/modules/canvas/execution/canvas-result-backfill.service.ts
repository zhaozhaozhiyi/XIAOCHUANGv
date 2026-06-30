import { Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'

import { DatabaseService } from '../../../db/database.service'
import { canvasEdges, canvasNodes } from '../../../db/schema'
import { CanvasNodeResultService } from '../canvas-node-result.service'
import type { CanvasTaskResult } from './canvas-execution.types'

@Injectable()
export class CanvasResultBackfillService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CanvasNodeResultService) private readonly nodeResultService: CanvasNodeResultService,
  ) {}

  async backfill(
    canvasId: string,
    executeNodeId: string,
    nodeDefId: string,
    result: CanvasTaskResult,
  ): Promise<void> {
    const url = result.url || result.outputs[0]?.url
    if (!url) return

    const edges = await this.db.db
      .select()
      .from(canvasEdges)
      .where(and(eq(canvasEdges.canvasId, canvasId), eq(canvasEdges.edgeKind, 'dataflow')))

    const outboundTargets = edges.filter((e) => e.sourceNodeId === executeNodeId).map((e) => e.targetNodeId)
    const targetIds = outboundTargets.length ? outboundTargets : [executeNodeId]

    const targets = await this.db.db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvasId), inArray(canvasNodes.id, targetIds)))

    for (const target of targets) {
      await this.nodeResultService.appendResult(
        canvasId,
        target.id,
        this.nodeResultService.buildResultFromExecution(nodeDefId, url, {
          thumbnail_url: result.outputs.find((item) => item.type === 'image')?.url ?? null,
          source_type: nodeDefId === 'concat' || nodeDefId === 'export' ? 'canvas_export' : 'canvas_generation',
          metadata: {
            outputs: result.outputs,
            execute_node_id: executeNodeId,
            target_node_id: target.id,
          },
        }),
      )
    }
  }
}
