import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../db/database.service'
import { canvasNodes } from '../../db/schema'
import { CanvasService } from './canvas.service'

export type CanvasSkillOperation =
  | { type: 'create_node'; node_type: string; label: string; data?: Record<string, unknown>; position?: { x: number; y: number } }
  | { type: 'update_node'; node_id: string; patch: Record<string, unknown> }
  | { type: 'add_to_context'; node_id: string }

function uid(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 10)}`
}

@Injectable()
export class CanvasSkillService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CanvasService) private readonly canvasService: CanvasService,
  ) {}

  async createNodes(canvasId: string, userId: number, nodes: Array<{ node_type: string; label: string; data?: Record<string, unknown>; position?: { x: number; y: number } }>) {
    await this.canvasService.requireOwnedCanvas(canvasId, userId)
    if (!nodes.length) throw new BadRequestException('nodes_required')

    const rows = nodes.map((node, index) => ({
      id: uid('node'),
      canvasId,
      nodeDefId: node.node_type,
      label: node.label || node.node_type,
      dataJson: JSON.stringify(node.data || {}),
      positionX: node.position?.x ?? (160 + index * 300),
      positionY: node.position?.y ?? 160,
      isHidden: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    }))

    await this.db.db.insert(canvasNodes).values(rows)
    return rows.map((row) => ({
      id: row.id,
      type: row.nodeDefId,
      position: { x: row.positionX, y: row.positionY },
      data: JSON.parse(row.dataJson),
    }))
  }

  async applyPlan(canvasId: string, userId: number, operations: CanvasSkillOperation[]) {
    await this.canvasService.requireOwnedCanvas(canvasId, userId)
    const outputs: unknown[] = []

    for (const operation of operations) {
      if (operation.type === 'create_node') {
        const created = await this.createNodes(canvasId, userId, [operation])
        outputs.push(...created)
        continue
      }

      if (operation.type === 'update_node') {
        const [node] = await this.db.db
          .select()
          .from(canvasNodes)
          .where(and(eq(canvasNodes.id, operation.node_id), eq(canvasNodes.canvasId, canvasId)))
        if (!node) throw new NotFoundException('node_not_found')
        const current = safeJsonParse<Record<string, unknown>>(node.dataJson, {})
        const nextData = { ...current, ...operation.patch }
        const nextLabel = typeof operation.patch.label === 'string' ? operation.patch.label : node.label
        await this.db.db
          .update(canvasNodes)
          .set({ dataJson: JSON.stringify(nextData), label: nextLabel, updatedAt: new Date() })
          .where(eq(canvasNodes.id, node.id))
        outputs.push({
          id: node.id,
          type: node.nodeDefId,
          position: { x: node.positionX, y: node.positionY },
          data: nextData,
        })
        continue
      }

      if (operation.type === 'add_to_context') {
        outputs.push({ node_id: operation.node_id, added: true })
        continue
      }

      throw new BadRequestException('unsupported_skill_operation')
    }

    return outputs
  }
}

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}
