import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { and, eq, inArray } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { canvases, canvasNodes, canvasEdges, canvasViewports } from '../../db/schema'
import { canvasAdvisoryLockSql } from './canvas-lock.util'
import { VALID_CANVAS_NODE_TYPE_SET } from './canvas-node-types'

function now() {
  return new Date()
}

const SERVER_GENERATED_DATA_KEYS = [
  'results',
  'current_result_id',
  'images',
  'imageUrl',
  'previewImageUrl',
  'thumbnailUrl',
  'generationBatch',
  'avatar',
  'image',
  'historyImages',
  'frames',
  'video',
  'videoUrl',
  'resultVideoUrl',
  'url',
  'audio',
  'audioUrl',
  'previewUrl',
  'outputUrl',
  'isGenerating',
  'generationError',
  'generationCompletedAt',
  'status',
  '__lastRunResult',
] as const

function parseNodeData(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function preserveGeneratedData(
  incoming: Record<string, unknown> | undefined,
  storedJson: string | null | undefined,
) {
  const next = { ...(incoming ?? {}) }
  const stored = parseNodeData(storedJson)
  const storedResults = Array.isArray(stored.results) ? stored.results : []
  if (storedResults.length === 0) return next

  for (const key of SERVER_GENERATED_DATA_KEYS) {
    if (Object.prototype.hasOwnProperty.call(stored, key)) next[key] = stored[key]
  }
  return next
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
      if (!VALID_CANVAS_NODE_TYPE_SET.has(node.type)) {
        throw new BadRequestException(`unknown node type: ${node.type}`)
      }
    }
    for (const edge of edges) {
      if (!edge.id) throw new BadRequestException('edge.id is required')
      if (!edge.source || !edge.target) throw new BadRequestException('edge source and target are required')
    }

    const nodesToSave = this.applyStoryboardPortContext(nodes, edges)
    const payloadNodeIds = new Set(nodesToSave.map((node) => node.id))
    const edgesToSave = edges.filter((edge) => payloadNodeIds.has(edge.source) && payloadNodeIds.has(edge.target))

    await this.db.db.transaction(async (tx) => {
      // 0. canvas-level advisory lock：与 appendResult 用同一把锁，
      //    保证全量删插期间不会有 backfill 往即将被删除/覆盖的节点写 results。
      await tx.execute(canvasAdvisoryLockSql(canvasId))

      // 1. 视口
      if (viewport) {
        await tx.update(canvasViewports)
          .set({ x: viewport.x ?? 0, y: viewport.y ?? 0, zoom: viewport.zoom ?? 1, updatedAt: now() })
          .where(eq(canvasViewports.canvasId, canvasId))
      }

      // 2. 保存是前端可见图的全量覆盖；隐藏执行节点/边由后端生成链路持有，不能被草稿保存误删。
      const existingNodes = await tx
        .select({ id: canvasNodes.id, isHidden: canvasNodes.isHidden, dataJson: canvasNodes.dataJson })
        .from(canvasNodes)
        .where(eq(canvasNodes.canvasId, canvasId))
      const hiddenNodeIds = new Set(existingNodes.filter((node) => node.isHidden).map((node) => node.id))
      const existingNodeById = new Map(existingNodes.map((node) => [node.id, node]))
      const mergedNodes = nodesToSave.map((node) => ({
        ...node,
        data: preserveGeneratedData(node.data, existingNodeById.get(node.id)?.dataJson),
      }))

      await tx.delete(canvasNodes).where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.isHidden, false)))

      if (hiddenNodeIds.size > 0) {
        const existingEdges = await tx
          .select({
            id: canvasEdges.id,
            sourceNodeId: canvasEdges.sourceNodeId,
            targetNodeId: canvasEdges.targetNodeId,
          })
          .from(canvasEdges)
          .where(eq(canvasEdges.canvasId, canvasId))
        const replaceableEdgeIds = existingEdges
          .filter((edge) => !hiddenNodeIds.has(edge.sourceNodeId) && !hiddenNodeIds.has(edge.targetNodeId))
          .map((edge) => edge.id)
        if (replaceableEdgeIds.length > 0) {
          await tx.delete(canvasEdges).where(and(eq(canvasEdges.canvasId, canvasId), inArray(canvasEdges.id, replaceableEdgeIds)))
        }
      } else {
        await tx.delete(canvasEdges).where(eq(canvasEdges.canvasId, canvasId))
      }

      // 3. 插入节点（React Flow format → DB format）
      if (mergedNodes.length > 0) {
        await tx.insert(canvasNodes).values(
          mergedNodes.map((n) => ({
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
      if (edgesToSave.length > 0) {
        await tx.insert(canvasEdges).values(
          edgesToSave.map((e) => ({
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
      if (source.type === 'character' && (targetPort.includes('role') || targetPort.includes('character'))) {
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
