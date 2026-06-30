import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { canvases, canvasNodes, canvasEdges, canvasViewports } from '../../db/schema'

function now() {
  return new Date()
}

/**
 * 前端发送的 React Flow 格式节点
 */
interface SaveNodeInput {
  id: string
  type: string       // 前端用 type，映射到 DB 的 nodeDefId
  position: { x: number; y: number }
  width?: number
  height?: number
  data?: Record<string, unknown>
  hidden?: boolean
  selected?: boolean
}

/**
 * 前端发送的 React Flow 格式连线
 */
interface SaveEdgeInput {
  id: string
  source: string     // 前端用 source/target，映射到 DB 的 sourceNodeId/targetNodeId
  target: string
  edge_kind?: string
  source_port?: string
  target_port?: string
  relation_type?: string
  label?: string
}

const VALID_NODE_TYPES = [
  'storyboard', 'image', 'character', 'scene', 'note',
  'audio', 'video-asset',
  'text-to-image', 'image-to-video', 'text-to-speech', 'concat', 'export',
]

@Injectable()
export class CanvasSaveService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}

  async save(canvasId: string, payload: {
    nodes: SaveNodeInput[]
    edges: SaveEdgeInput[]
    viewport?: { x: number; y: number; zoom: number }
  }) {
    const { nodes, edges, viewport } = payload

    if (!Array.isArray(nodes)) throw new BadRequestException('nodes must be an array')
    if (!Array.isArray(edges)) throw new BadRequestException('edges must be an array')
    if (nodes.length > 250) throw new BadRequestException('too many nodes (max 250)')
    if (edges.length > 500) throw new BadRequestException('too many edges (max 500)')

    for (const node of nodes) {
      if (!node.id) throw new BadRequestException('node.id is required')
      if (!node.type) throw new BadRequestException('node.type is required')
      if (!VALID_NODE_TYPES.includes(node.type)) {
        throw new BadRequestException(`unknown node type: ${node.type}`)
      }
    }
    for (const edge of edges) {
      if (!edge.id) throw new BadRequestException('edge.id is required')
      if (!edge.source || !edge.target) throw new BadRequestException('edge source and target are required')
    }

    const nodesToSave = this.applyStoryboardPortContext(nodes, edges)

    await this.db.db.transaction(async (tx) => {
      // 1. 视口
      if (viewport) {
        await tx.update(canvasViewports)
          .set({ x: viewport.x ?? 0, y: viewport.y ?? 0, zoom: viewport.zoom ?? 1, updatedAt: now() })
          .where(eq(canvasViewports.canvasId, canvasId))
      }

      // 2. 删除非隐藏节点 + 旧连线
      await tx.delete(canvasNodes).where(eq(canvasNodes.canvasId, canvasId))
      await tx.delete(canvasEdges).where(eq(canvasEdges.canvasId, canvasId))

      // 3. 插入节点（React Flow format → DB format）
      if (nodesToSave.length > 0) {
        await tx.insert(canvasNodes).values(
          nodesToSave.map((n) => ({
            id: n.id,
            canvasId,
            nodeDefId: n.type,
            label: (n.data?.label as string) ?? (n.data?.title as string) ?? '',
            dataJson: JSON.stringify(n.data ?? {}),
            positionX: n.position?.x ?? 0,
            positionY: n.position?.y ?? 0,
            width: n.width ?? 260,
            height: n.height ?? 230,
            zIndex: 0,
            isHidden: n.hidden ?? false,
            createdAt: now(),
            updatedAt: now(),
          })),
        )
      }

      // 4. 插入连线（React Flow format → DB format）
      if (edges.length > 0) {
        await tx.insert(canvasEdges).values(
          edges.map((e) => ({
            id: e.id,
            canvasId,
            sourceNodeId: e.source,
            targetNodeId: e.target,
            edgeKind: e.edge_kind ?? 'narrative',
            relationType: e.relation_type ?? null,
            sourcePort: e.source_port ?? null,
            targetPort: e.target_port ?? null,
            label: e.label ?? null,
            createdAt: now(),
          })),
        )
      }

      // 5. 更新时间戳
      await tx.update(canvases).set({ updatedAt: now() }).where(eq(canvases.id, canvasId))
    })

    return {
      saved_at: now().toISOString(),
      version_id: '',
    }
  }

  private applyStoryboardPortContext(nodes: SaveNodeInput[], edges: SaveEdgeInput[]) {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]))
    const contextByStoryboard = new Map<string, Record<string, unknown>>()

    for (const edge of edges) {
      const source = nodeMap.get(edge.source)
      const target = nodeMap.get(edge.target)
      if (!source || !target || target.type !== 'storyboard') continue

      const targetPort = edge.target_port || ''
      if (source.type === 'character' && targetPort.includes('role')) {
        contextByStoryboard.set(target.id, {
          ...(contextByStoryboard.get(target.id) || {}),
          main_character_ref: {
            node_id: source.id,
            label: source.data?.label || source.data?.title || source.data?.name || source.id,
          },
        })
      }
      if (source.type === 'scene' && targetPort.includes('scene')) {
        contextByStoryboard.set(target.id, {
          ...(contextByStoryboard.get(target.id) || {}),
          scene_background_ref: {
            node_id: source.id,
            label: source.data?.label || source.data?.title || source.data?.name || source.id,
          },
        })
      }
    }

    if (!contextByStoryboard.size) return nodes
    return nodes.map((node) => {
      const contextPatch = contextByStoryboard.get(node.id)
      if (!contextPatch) return node
      return {
        ...node,
        data: {
          ...(node.data || {}),
          context: {
            ...((node.data?.context && typeof node.data.context === 'object') ? node.data.context as Record<string, unknown> : {}),
            ...contextPatch,
          },
        },
      }
    })
  }
}
