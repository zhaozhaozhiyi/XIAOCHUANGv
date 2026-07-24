import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../db/database.service'
import {
  canvases,
  canvasNodes,
  canvasEdges,
  canvasViewports,
  dramas,
  episodes,
  storyboards,
} from '../../db/schema'

function now() {
  return new Date()
}

/**
 * React Flow 格式的节点（前端期望的 shape）
 */
export interface CanvasFlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  width?: number
  height?: number
  data: Record<string, unknown>
  hidden?: boolean
  selected?: boolean
}

/**
 * React Flow 格式的连线（前端期望的 shape）
 */
export interface CanvasFlowEdge {
  id: string
  source: string
  target: string
  edge_kind: string
  source_port?: string
  target_port?: string
  relation_type?: string
  label?: string
}

function toFlowNode(row: typeof canvasNodes.$inferSelect): CanvasFlowNode {
  return {
    id: row.id,
    type: row.nodeDefId,
    position: { x: row.positionX, y: row.positionY },
    width: row.width,
    height: row.height,
    data: safeJsonParse(row.dataJson, {}),
    hidden: row.isHidden || undefined,
  }
}

function toFlowEdge(row: typeof canvasEdges.$inferSelect): CanvasFlowEdge {
  return {
    id: row.id,
    source: row.sourceNodeId,
    target: row.targetNodeId,
    edge_kind: row.edgeKind,
    source_port: row.sourcePort ?? undefined,
    target_port: row.targetPort ?? undefined,
    relation_type: row.relationType ?? undefined,
    label: row.label ?? undefined,
  }
}

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function uid(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

function normalizeSourceId(value: string | number | null | undefined) {
  if (value == null || value === '') return null
  const raw = String(value).trim()
  if (!raw) return null
  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException('invalid_canvas_source_id')
  }
  return String(parsed)
}

type CreateCanvasOptions = {
  source?: string | null
  profile?: string | null
  sourceDramaId?: string | number | null
  sourceEpisodeId?: string | number | null
  sourceStoryboardId?: string | number | null
  sourceDramaTitle?: string | null
  productionContext?: Record<string, unknown> | null
}

@Injectable()
export class CanvasService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
  ) {}

  // ═══════════════════════════════════════════════════════════
  // 列表
  // ═══════════════════════════════════════════════════════════

  async listCanvases(userId: number) {
    const rows = await this.db.db
      .select()
      .from(canvases)
      .where(and(eq(canvases.userId, userId), isNull(canvases.deletedAt)))
      .orderBy(desc(canvases.isPinned), asc(canvases.sortOrder), desc(canvases.updatedAt))

    return {
      data: rows.map(toSummary),
      total: rows.length,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 初始化全局灵感板（幂等）
  // ═══════════════════════════════════════════════════════════

  async initGlobalInspiration(userId: number) {
    const [existing] = await this.db.db
      .select()
      .from(canvases)
      .where(and(
        eq(canvases.userId, userId),
        eq(canvases.source, 'global-inspiration'),
        isNull(canvases.deletedAt),
      ))

    if (existing) {
      return toSummary(existing)
    }

    const id = uid('cnv')
    const nowStr = now().toISOString()
    await this.db.db.insert(canvases).values({
      id,
      userId,
      title: '🌟 全局灵感板',
      source: 'global-inspiration',
      isPinned: true,
      createdAt: now(),
      updatedAt: now(),
    })

    await this.db.db.insert(canvasViewports).values({
      id: uid('vp'),
      canvasId: id,
      updatedAt: now(),
    })

    // 示例便签
    await this.db.db.insert(canvasNodes).values({
      id: uid('node'),
      canvasId: id,
      nodeDefId: 'note',
      label: '欢迎使用画布',
      dataJson: JSON.stringify({
        text: '欢迎来到画布！\n\n这里是你的灵感聚合地：\n• 拖拽分镜卡到画面中央\n• 双击空白处快速创建\n• 选中节点后按 E 打开编辑器',
        color: '#FEF3C7',
      }),
      positionX: 200,
      positionY: 160,
      width: 320,
      height: 200,
      isHidden: false,
      createdAt: now(),
      updatedAt: now(),
    })

    return toSummary({
      id,
      userId,
      title: '🌟 全局灵感板',
      source: 'global-inspiration',
      isPinned: true,
      sortOrder: 0,
      colorPaletteJson: '[]',
      compositeSettingsJson: '{"resolution":"1080p","fps":24,"transition":"none"}',
      currentVersionId: null,
      thumbnail: null,
      profile: 'general',
      sourceDramaId: null,
      sourceEpisodeId: null,
      sourceStoryboardId: null,
      sourceDramaTitle: null,
      sourceDramaSnapshotAt: null,
      productionContextJson: '{}',
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    })
  }

  // ═══════════════════════════════════════════════════════════
  // 创建空白画布
  // ═══════════════════════════════════════════════════════════

  async createCanvas(userId: number, title?: string, options: CreateCanvasOptions = {}) {
    const id = uid('cnv')
    const nowStr = now().toISOString()
    const sourceDramaId = normalizeSourceId(options.sourceDramaId)
    const sourceEpisodeId = normalizeSourceId(options.sourceEpisodeId)
    const sourceStoryboardId = normalizeSourceId(options.sourceStoryboardId)
    let sourceDramaTitle = options.sourceDramaTitle?.trim() || null

    if (sourceDramaId) {
      const dramaId = Number(sourceDramaId)
      const [drama] = await this.db.db
        .select()
        .from(dramas)
        .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId), isNull(dramas.deletedAt)))
      if (!drama) throw new NotFoundException('canvas_source_drama_not_found')
      sourceDramaTitle = sourceDramaTitle || drama.title

      if (sourceEpisodeId) {
        const [episode] = await this.db.db
          .select()
          .from(episodes)
          .where(and(eq(episodes.id, Number(sourceEpisodeId)), eq(episodes.dramaId, dramaId), eq(episodes.userId, userId), isNull(episodes.deletedAt)))
        if (!episode) throw new NotFoundException('canvas_source_episode_not_found')
      }

      if (sourceStoryboardId) {
        const [storyboard] = await this.db.db
          .select({ id: storyboards.id, episodeId: storyboards.episodeId })
          .from(storyboards)
          .where(and(eq(storyboards.id, Number(sourceStoryboardId)), eq(storyboards.userId, userId), isNull(storyboards.deletedAt)))

        if (!storyboard) throw new NotFoundException('canvas_source_storyboard_not_found')

        const [episode] = await this.db.db
          .select({ id: episodes.id })
          .from(episodes)
          .where(and(eq(episodes.id, storyboard.episodeId), eq(episodes.dramaId, dramaId), eq(episodes.userId, userId), isNull(episodes.deletedAt)))

        if (!episode) throw new NotFoundException('canvas_source_storyboard_not_found')
      }
    }

    const source = sourceDramaId || options.source === 'from-drama' ? 'from-drama' : 'blank'
    const profile = options.profile?.trim() || (sourceDramaId ? 'drama' : 'general')
    const row = {
      id,
      userId,
      title: title?.trim() || '未命名画布',
      source,
      profile,
      isPinned: false,
      sortOrder: 0,
      colorPaletteJson: '[]',
      compositeSettingsJson: '{"resolution":"1080p","fps":24,"transition":"none"}',
      currentVersionId: null as string | null,
      thumbnail: null as string | null,
      sourceDramaId,
      sourceEpisodeId,
      sourceStoryboardId,
      sourceDramaTitle,
      sourceDramaSnapshotAt: sourceDramaId ? nowStr : null,
      productionContextJson: JSON.stringify(options.productionContext ?? {}),
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null as Date | null,
    }

    await this.db.db.insert(canvases).values(row)
    await this.db.db.insert(canvasViewports).values({
      id: uid('vp'),
      canvasId: id,
      updatedAt: now(),
    })

    return toSummary(row)
  }

  // ═══════════════════════════════════════════════════════════
  // 详情
  // ═══════════════════════════════════════════════════════════

  async getCanvas(canvasId: string, userId: number) {
    const canvas = await this.requireOwnedCanvas(canvasId, userId)

    const nodes = await this.db.db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.isHidden, false)))

    const edges = await this.db.db
      .select()
      .from(canvasEdges)
      .where(eq(canvasEdges.canvasId, canvasId))

    const [viewport] = await this.db.db
      .select()
      .from(canvasViewports)
      .where(eq(canvasViewports.canvasId, canvasId))

    return {
      ...toSummary(canvas),
      nodes: nodes.map(toFlowNode),
      edges: edges.map(toFlowEdge),
      viewport: viewport
        ? { x: viewport.x, y: viewport.y, zoom: viewport.zoom }
        : { x: 0, y: 0, zoom: 1 },
      current_version_id: canvas.currentVersionId ?? '',
    }
  }

  // ═══════════════════════════════════════════════════════════
  // 复制
  // ═══════════════════════════════════════════════════════════

  async duplicateCanvas(canvasId: string, userId: number) {
    const canvas = await this.requireOwnedCanvas(canvasId, userId)

    const originalNodes = await this.db.db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.canvasId, canvasId), eq(canvasNodes.isHidden, false)))

    const originalEdges = await this.db.db
      .select()
      .from(canvasEdges)
      .where(eq(canvasEdges.canvasId, canvasId))

    const [originalViewport] = await this.db.db
      .select()
      .from(canvasViewports)
      .where(eq(canvasViewports.canvasId, canvasId))

    const newId = uid('cnv')

    await this.db.db.insert(canvases).values({
      id: newId,
      userId,
      title: `${canvas.title} (副本)`,
      source: 'blank',
      isPinned: false,
      sortOrder: 0,
      colorPaletteJson: canvas.colorPaletteJson,
      compositeSettingsJson: canvas.compositeSettingsJson,
      currentVersionId: uid('ver'),
      profile: canvas.profile,
      sourceDramaId: canvas.sourceDramaId,
      sourceEpisodeId: canvas.sourceEpisodeId,
      sourceStoryboardId: canvas.sourceStoryboardId,
      sourceDramaTitle: canvas.sourceDramaTitle,
      sourceDramaSnapshotAt: canvas.sourceDramaSnapshotAt,
      productionContextJson: canvas.productionContextJson,
      createdAt: now(),
      updatedAt: now(),
    })

    await this.db.db.insert(canvasViewports).values({
      id: uid('vp'),
      canvasId: newId,
      x: originalViewport?.x ?? 0,
      y: originalViewport?.y ?? 0,
      zoom: originalViewport?.zoom ?? 1.0,
      infoLayersJson: originalViewport?.infoLayersJson ?? '{"emotion":false,"rhythm":false,"shotType":false,"ai":false}',
      updatedAt: now(),
    })

    // 复制节点（建立旧ID→新ID映射）
    const idMap = new Map<string, string>()
    for (const node of originalNodes) {
      const newNodeId = uid('node')
      idMap.set(node.id, newNodeId)
      await this.db.db.insert(canvasNodes).values({
        id: newNodeId,
        canvasId: newId,
        nodeDefId: node.nodeDefId,
        label: node.label,
        dataJson: node.dataJson,
        positionX: node.positionX,
        positionY: node.positionY,
        width: node.width,
        height: node.height,
        zIndex: node.zIndex,
        color: node.color,
        shotIndex: node.shotIndex,
        isHidden: false,
        createdAt: now(),
        updatedAt: now(),
      })
    }

    // 复制连线
    for (const edge of originalEdges) {
      const newSourceId = idMap.get(edge.sourceNodeId)
      const newTargetId = idMap.get(edge.targetNodeId)
      if (!newSourceId || !newTargetId) continue
      await this.db.db.insert(canvasEdges).values({
        id: uid('edge'),
        canvasId: newId,
        sourceNodeId: newSourceId,
        targetNodeId: newTargetId,
        edgeKind: edge.edgeKind,
        relationType: edge.relationType,
        thickness: edge.thickness,
        sourcePort: edge.sourcePort,
        targetPort: edge.targetPort,
        label: edge.label,
        createdAt: now(),
      })
    }

    return toSummary({ ...canvas, id: newId, title: `${canvas.title} (副本)` })
  }

  // ═══════════════════════════════════════════════════════════
  // 更新元数据
  // ═══════════════════════════════════════════════════════════

  async updateCanvas(canvasId: string, userId: number, updates: {
    title?: string
    isPinned?: boolean
    thumbnail?: string
    viewport?: { x?: number; y?: number; zoom?: number }
  }) {
    await this.requireOwnedCanvas(canvasId, userId)

    if (updates.title !== undefined) {
      const trimmed = updates.title.trim()
      if (!trimmed) throw new BadRequestException('title cannot be empty')
      if (trimmed.length > 100) throw new BadRequestException('title too long (max 100)')
      await this.db.db.update(canvases).set({ title: trimmed, updatedAt: now() }).where(eq(canvases.id, canvasId))
    }

    if (updates.isPinned !== undefined) {
      await this.db.db.update(canvases).set({ isPinned: updates.isPinned, updatedAt: now() }).where(eq(canvases.id, canvasId))
    }

    if (updates.thumbnail !== undefined) {
      await this.db.db.update(canvases).set({ thumbnail: updates.thumbnail, updatedAt: now() }).where(eq(canvases.id, canvasId))
    }

    if (updates.viewport) {
      const set: Record<string, unknown> = { updatedAt: now() }
      if (updates.viewport.x !== undefined) set.x = updates.viewport.x
      if (updates.viewport.y !== undefined) set.y = updates.viewport.y
      if (updates.viewport.zoom !== undefined) set.zoom = updates.viewport.zoom
      await this.db.db.update(canvasViewports).set(set).where(eq(canvasViewports.canvasId, canvasId))
    }

    return await this.getCanvas(canvasId, userId)
  }

  // ═══════════════════════════════════════════════════════════
  // 软删除
  // ═══════════════════════════════════════════════════════════

  async deleteCanvas(canvasId: string, userId: number) {
    const canvas = await this.requireOwnedCanvas(canvasId, userId)
    if (canvas.source === 'global-inspiration') {
      throw new BadRequestException('全局灵感板不可删除')
    }
    await this.db.db.update(canvases).set({ deletedAt: now(), updatedAt: now() }).where(eq(canvases.id, canvasId))
    return { deleted_at: now().toISOString() }
  }

  // ═══════════════════════════════════════════════════════════
  // 权限
  // ═══════════════════════════════════════════════════════════

  async requireOwnedCanvas(canvasId: string, userId: number) {
    const [canvas] = await this.db.db
      .select()
      .from(canvases)
      .where(and(eq(canvases.id, canvasId), eq(canvases.userId, userId), isNull(canvases.deletedAt)))

    if (!canvas) throw new NotFoundException('canvas_not_found')
    return canvas
  }
}

// ═══════════════════════════════════════════════════════════
// 序列化（前端 snake_case 契约）
// ═══════════════════════════════════════════════════════════

function toSummary(row: typeof canvases.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    thumbnail: row.thumbnail ?? null,
    source: row.source,
    profile: row.profile,
    source_drama_id: row.sourceDramaId ?? null,
    source_episode_id: row.sourceEpisodeId ?? null,
    source_storyboard_id: row.sourceStoryboardId ?? null,
    source_drama_title: row.sourceDramaTitle ?? null,
    source_drama_snapshot_at: row.sourceDramaSnapshotAt ?? null,
    production_context: safeJsonParse(row.productionContextJson, {}),
    is_pinned: row.isPinned,
    created_at: row.createdAt?.toISOString() ?? '',
    updated_at: row.updatedAt?.toISOString() ?? '',
  }
}
