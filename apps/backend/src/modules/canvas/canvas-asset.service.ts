import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../common/media-url'
import { DatabaseService } from '../../db/database.service'
import { assets, canvasNodes } from '../../db/schema'
import { CanvasService } from './canvas.service'
import { CanvasNodeResult, CanvasNodeResultService } from './canvas-node-result.service'

function kindToAssetKind(kind: string) {
  if (kind === 'image' || kind === 'video' || kind === 'audio') return kind
  return 'file'
}

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

@Injectable()
export class CanvasAssetService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CanvasService) private readonly canvasService: CanvasService,
    @Inject(CanvasNodeResultService) private readonly nodeResultService: CanvasNodeResultService,
  ) {}

  async createAssetFromNodeResult(
    canvasId: string,
    userId: number,
    input: { node_id: string; result_id?: string; title?: string },
  ) {
    await this.canvasService.requireOwnedCanvas(canvasId, userId)

    const [node] = await this.db.db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.id, input.node_id), eq(canvasNodes.canvasId, canvasId)))

    if (!node) throw new NotFoundException('node_not_found')

    const data = safeJsonParse<Record<string, unknown>>(node.dataJson, {})
    const results = Array.isArray(data.results) ? (data.results as CanvasNodeResult[]) : []
    const currentResultId = typeof data.current_result_id === 'string' ? data.current_result_id : null
    const result = input.result_id
      ? results.find((item) => item.id === input.result_id)
      : (results.find((item) => item.id === currentResultId) || results[0])

    if (!result?.url) throw new BadRequestException('result_not_found')
    if (result.asset_id) {
      const [existing] = await this.db.db
        .select()
        .from(assets)
        .where(and(eq(assets.id, result.asset_id), eq(assets.userId, userId), isNull(assets.deletedAt)))
      if (existing) return existing
    }

    const sourceType = input.result_id && input.result_id !== currentResultId
      ? 'canvas_history'
      : (result.source_type || 'canvas_generation')

    const [asset] = await this.db.db
      .insert(assets)
      .values({
        userId,
        kind: kindToAssetKind(result.kind),
        title: input.title?.trim() || result.title || node.label || '画布产物',
        provider: result.provider ?? null,
        mimeType: result.mime_type ?? null,
        sourceType,
        sourceRef: canvasId,
        sourcePath: `/canvas/${canvasId}`,
        url: toPublicMediaUrl(result.url),
        thumbnailUrl: toPublicMediaUrl(result.thumbnail_url || result.url),
        metadataJson: JSON.stringify({
          canvas_id: canvasId,
          node_id: node.id,
          node_type: node.nodeDefId,
          result_id: result.id,
          prompt: result.prompt ?? null,
          action_label: result.action_label ?? null,
          run_id: result.run_id ?? null,
          task_id: result.task_id ?? null,
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    await this.nodeResultService.markAssetId(canvasId, node.id, result.id, asset.id)
    return asset
  }

  async createAssetFromUpload(args: {
    canvasId: string
    userId: number
    kind: 'image' | 'video' | 'audio'
    title: string
    url: string
    thumbnailUrl?: string | null
    mimeType?: string | null
    nodeId?: string | null
    resultId?: string | null
  }) {
    const [asset] = await this.db.db
      .insert(assets)
      .values({
        userId: args.userId,
        kind: args.kind,
        title: args.title || '画布上传',
        mimeType: args.mimeType ?? null,
        sourceType: 'canvas_upload',
        sourceRef: args.canvasId,
        sourcePath: `/canvas/${args.canvasId}`,
        url: toPublicMediaUrl(args.url),
        thumbnailUrl: toPublicMediaUrl(args.thumbnailUrl || args.url),
        metadataJson: JSON.stringify({
          canvas_id: args.canvasId,
          node_id: args.nodeId ?? null,
          result_id: args.resultId ?? null,
        }),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning()

    if (args.nodeId && args.resultId) {
      await this.nodeResultService.markAssetId(args.canvasId, args.nodeId, args.resultId, asset.id)
    }
    return asset
  }
}
