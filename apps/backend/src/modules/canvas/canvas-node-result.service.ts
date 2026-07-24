import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../db/database.service'
import { canvasNodes } from '../../db/schema'
import { canvasAdvisoryLockSql } from './canvas-lock.util'
import {
  AUDIO_RESULT_NODE_TYPES,
  IMAGE_RESULT_NODE_TYPES,
  TEXT_RESULT_NODE_TYPES,
  VIDEO_RESULT_NODE_TYPES,
} from './canvas-node-types'
import { CANVAS_ASSET_SOURCE_TYPES, normalizeCanvasAssetSourceType } from './canvas-source-types'

export type CanvasNodeResultKind = 'image' | 'video' | 'audio' | 'text' | 'file'

export type CanvasNodeResult = {
  id: string
  kind: CanvasNodeResultKind
  url: string
  thumbnail_url?: string | null
  mime_type?: string | null
  title?: string | null
  prompt?: string | null
  provider?: string | null
  model?: string | null
  action_label?: string | null
  run_id?: string | null
  task_id?: string | null
  asset_id?: number | null
  source_type?: string | null
  created_at: string
  metadata?: Record<string, unknown>
}

type AppendResultInput = Omit<Partial<CanvasNodeResult>, 'id' | 'created_at'> & {
  kind: CanvasNodeResultKind
  url: string
}

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function uid(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 10)}`
}

function resultKindForExecuteNode(nodeDefId: string): CanvasNodeResultKind {
  if (nodeDefId === 'image-to-video' || nodeDefId === 'concat' || nodeDefId === 'export') return 'video'
  if (nodeDefId === 'text-to-speech') return 'audio'
  if (nodeDefId === 'text-to-image') return 'image'
  return 'file'
}

function toFlowNode(node: typeof canvasNodes.$inferSelect, data: Record<string, unknown>) {
  return {
    id: node.id,
    type: node.nodeDefId,
    position: { x: node.positionX, y: node.positionY },
    width: node.width,
    height: node.height,
    data,
    hidden: node.isHidden || undefined,
  }
}

@Injectable()
export class CanvasNodeResultService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async appendResult(canvasId: string, nodeId: string, input: AppendResultInput) {
    return this.db.db.transaction(async (tx) => {
      // 与 canvas-save 全量删插用同一把 canvas advisory lock，避免 save 删节点时把刚写入的 results 覆盖丢失。
      await tx.execute(canvasAdvisoryLockSql(canvasId))

      const [node] = await tx
        .select()
        .from(canvasNodes)
        .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.canvasId, canvasId)))
        .for('update')

      if (!node) throw new NotFoundException('node_not_found')

      const data = safeJsonParse<Record<string, unknown>>(node.dataJson, {})
      const currentResults = Array.isArray(data.results)
        ? (data.results as CanvasNodeResult[]).filter((item) => item && typeof item === 'object')
        : []
      const result: CanvasNodeResult = {
        id: uid('res'),
        kind: input.kind,
        url: input.url,
        thumbnail_url: input.thumbnail_url ?? null,
        mime_type: input.mime_type ?? null,
        title: input.title ?? null,
        prompt: input.prompt ?? (typeof data.prompt === 'string' ? data.prompt : null),
        provider: input.provider ?? null,
        model: input.model ?? null,
        action_label: input.action_label ?? null,
        run_id: input.run_id ?? null,
        task_id: input.task_id ?? null,
        asset_id: input.asset_id ?? null,
        source_type: input.source_type ?? null,
        created_at: new Date().toISOString(),
        metadata: input.metadata ?? {},
      }

      const nextData = this.applyCurrentResult(
        node.nodeDefId,
        {
          ...data,
          results: [result, ...currentResults.filter((item) => item.id !== result.id)].slice(0, 20),
          current_result_id: result.id,
        },
        result,
      )

      await tx
        .update(canvasNodes)
        .set({ dataJson: JSON.stringify(nextData), updatedAt: new Date() })
        .where(eq(canvasNodes.id, node.id))

      return {
        result,
        node: toFlowNode(node, nextData),
      }
    })
  }

  async listResults(canvasId: string, nodeId: string) {
    const [node] = await this.db.db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.canvasId, canvasId)))

    if (!node) throw new NotFoundException('node_not_found')
    const data = safeJsonParse<Record<string, unknown>>(node.dataJson, {})
    return {
      current_result_id: typeof data.current_result_id === 'string' ? data.current_result_id : null,
      results: Array.isArray(data.results) ? data.results : [],
    }
  }

  async selectResult(canvasId: string, nodeId: string, resultId: string) {
    return this.db.db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(canvasNodes)
        .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.canvasId, canvasId)))
        .for('update')

      if (!node) throw new NotFoundException('node_not_found')
      const data = safeJsonParse<Record<string, unknown>>(node.dataJson, {})
      const results = Array.isArray(data.results) ? (data.results as CanvasNodeResult[]) : []
      const result = results.find((item) => item.id === resultId)
      if (!result) throw new BadRequestException('result_not_found')

      const nextData = this.applyCurrentResult(
        node.nodeDefId,
        { ...data, current_result_id: result.id, results },
        result,
      )

      await tx
        .update(canvasNodes)
        .set({ dataJson: JSON.stringify(nextData), updatedAt: new Date() })
        .where(eq(canvasNodes.id, node.id))

      return {
        result,
        node: toFlowNode(node, nextData),
      }
    })
  }

  async markAssetId(canvasId: string, nodeId: string, resultId: string, assetId: number) {
    return this.db.db.transaction(async (tx) => {
      const [node] = await tx
        .select()
        .from(canvasNodes)
        .where(and(eq(canvasNodes.id, nodeId), eq(canvasNodes.canvasId, canvasId)))
        .for('update')

      if (!node) throw new NotFoundException('node_not_found')
      const data = safeJsonParse<Record<string, unknown>>(node.dataJson, {})
      const results = Array.isArray(data.results) ? (data.results as CanvasNodeResult[]) : []
      if (!results.some((item) => item.id === resultId)) throw new BadRequestException('result_not_found')
      const nextResults = results.map((item) => item.id === resultId ? { ...item, asset_id: assetId } : item)
      const currentResultId = typeof data.current_result_id === 'string'
        && nextResults.some((item) => item.id === data.current_result_id)
        ? data.current_result_id
        : nextResults[0]?.id ?? null
      const nextData = { ...data, results: nextResults, current_result_id: currentResultId }

      await tx
        .update(canvasNodes)
        .set({ dataJson: JSON.stringify(nextData), updatedAt: new Date() })
        .where(eq(canvasNodes.id, node.id))

      return toFlowNode(node, nextData)
    })
  }

  buildResultFromExecution(nodeDefId: string, url: string, extra?: Partial<CanvasNodeResult>): AppendResultInput {
    return {
      kind: resultKindForExecuteNode(nodeDefId),
      url,
      thumbnail_url: extra?.thumbnail_url ?? null,
      mime_type: extra?.mime_type ?? null,
      prompt: extra?.prompt ?? null,
      provider: extra?.provider ?? null,
      model: extra?.model ?? null,
      action_label: extra?.action_label ?? null,
      run_id: extra?.run_id ?? null,
      task_id: extra?.task_id ?? null,
      source_type: normalizeCanvasAssetSourceType(extra?.source_type, CANVAS_ASSET_SOURCE_TYPES.GENERATION),
      metadata: extra?.metadata ?? {},
    }
  }

  private applyCurrentResult(
    nodeDefId: string,
    data: Record<string, unknown>,
    result: CanvasNodeResult,
  ): Record<string, unknown> {
    const next = { ...data }
    const url = result.url

    if (result.kind === 'image') {
      const images = Array.isArray(next.images) ? [...(next.images as string[])] : []
      next.images = [url, ...images.filter((item) => item !== url)].slice(0, 20)
      if (IMAGE_RESULT_NODE_TYPES.has(nodeDefId)) {
        const generationBatch = Array.isArray(next.generationBatch)
          ? (next.generationBatch as unknown[]).filter((item): item is string => typeof item === 'string')
          : []
        next.imageUrl = url
        next.previewImageUrl = url
        next.thumbnailUrl = url
        next.generationBatch = [url, ...generationBatch.filter((item) => item !== url)].slice(0, 20)
      }
      if (nodeDefId === 'character' || nodeDefId === 'scene') {
        next.avatar = url
        next.image = url
      }
      if (nodeDefId === 'storyboard' || nodeDefId === 'image' || nodeDefId === 'storyboardNode' || nodeDefId === 'storyboardGenNode') {
        const history = Array.isArray(next.historyImages) ? [...(next.historyImages as unknown[])] : []
        next.historyImages = [
          { url, prompt: result.prompt ?? next.prompt ?? null, timestamp: result.created_at },
          ...history.filter((item) => {
            if (!item || typeof item !== 'object') return true
            return (item as { url?: unknown }).url !== url
          }),
        ].slice(0, 20)
      }
      if (nodeDefId === 'storyboardNode' || nodeDefId === 'storyboardGenNode') {
        const frames = Array.isArray(next.frames) ? [...(next.frames as unknown[])] : []
        next.frames = [
          { imageUrl: url, url, prompt: result.prompt ?? next.prompt ?? null, created_at: result.created_at },
          ...frames.filter((item) => {
            if (!item || typeof item !== 'object') return true
            const frame = item as { url?: unknown; imageUrl?: unknown }
            return frame.url !== url && frame.imageUrl !== url
          }),
        ].slice(0, 20)
      }
    }

    if (result.kind === 'video') {
      next.video = url
      next.videoUrl = url
      if (VIDEO_RESULT_NODE_TYPES.has(nodeDefId)) {
        next.resultVideoUrl = url
        next.url = url
        if (result.thumbnail_url) next.previewImageUrl = result.thumbnail_url
      }
    }

    if (result.kind === 'audio') {
      next.audio = url
      next.audioUrl = url
      if (AUDIO_RESULT_NODE_TYPES.has(nodeDefId)) {
        next.url = url
      }
    }

    if (result.kind === 'text' && TEXT_RESULT_NODE_TYPES.has(nodeDefId)) {
      const text = typeof result.metadata?.text === 'string' ? result.metadata.text : url
      next.text = text
      next.content = text
    }

    next.previewUrl = url
    next.outputUrl = url
    next.isGenerating = false
    next.generationError = null
    next.generationCompletedAt = result.created_at
    if (next.status === 'generating' || next.status === 'running') next.status = 'completed'
    next.__lastRunResult = {
      url,
      at: result.created_at,
      result_id: result.id,
      source_type: result.source_type ?? null,
    }
    return next
  }
}
