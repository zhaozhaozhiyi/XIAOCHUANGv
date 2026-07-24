import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../common/media-url'
import { DatabaseService } from '../../db/database.service'
import { assets, canvases, canvasNodes } from '../../db/schema'
import { CanvasService } from './canvas.service'
import { CanvasNodeResult, CanvasNodeResultService } from './canvas-node-result.service'
import { CANVAS_ASSET_SOURCE_TYPES, normalizeCanvasAssetSourceType } from './canvas-source-types'

function kindToAssetKind(kind: string) {
  if (kind === 'image' || kind === 'video' || kind === 'audio') return kind
  return 'file'
}

function safeJsonParse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

function metadataMatchesCanvasResult(
  metadataJson: string | null | undefined,
  nodeId: string,
  resultId: string,
) {
  const metadata = safeJsonParse<Record<string, unknown>>(metadataJson, {})
  return metadata.node_id === nodeId && metadata.result_id === resultId
}

function toOptionalInt(value: string | number | null | undefined) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function canvasSourcePath(canvas: typeof canvases.$inferSelect) {
  const dramaId = toOptionalInt(canvas.sourceDramaId)
  if (dramaId) return `/drama/${dramaId}/canvas/${canvas.id}`
  return `/canvas/${canvas.id}`
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
    const canvas = await this.canvasService.requireOwnedCanvas(canvasId, userId)

    const [node] = await this.db.db
      .select()
      .from(canvasNodes)
      .where(and(eq(canvasNodes.id, input.node_id), eq(canvasNodes.canvasId, canvasId)))

    if (!node) throw new NotFoundException('canvas_node_not_found')

    const data = safeJsonParse<Record<string, unknown>>(node.dataJson, {})
    const results = Array.isArray(data.results) ? (data.results as CanvasNodeResult[]) : []
    const currentResultId = typeof data.current_result_id === 'string' ? data.current_result_id : null
    const result = input.result_id
      ? results.find((item) => item.id === input.result_id)
      : (results.find((item) => item.id === currentResultId) || results[0])

    if (!result) throw new BadRequestException('canvas_result_not_found')
    if (!result.url) throw new BadRequestException('canvas_result_has_no_url')
    if (result.asset_id) {
      const [existing] = await this.db.db
        .select()
        .from(assets)
        .where(and(eq(assets.id, result.asset_id), eq(assets.userId, userId), isNull(assets.deletedAt)))
      if (existing) {
        const nextNode = await this.nodeResultService.markAssetId(canvasId, node.id, result.id, existing.id)
        return { asset: existing, node: nextNode, result: { ...result, asset_id: existing.id } }
      }
    }

    const sourceType = input.result_id && input.result_id !== currentResultId
      ? CANVAS_ASSET_SOURCE_TYPES.HISTORY
      : normalizeCanvasAssetSourceType(result.source_type, CANVAS_ASSET_SOURCE_TYPES.GENERATION)

    const existingAsset = await this.findExistingCanvasAsset(userId, canvasId, node.id, result.id)
    if (existingAsset) {
      const nextNode = await this.nodeResultService.markAssetId(canvasId, node.id, result.id, existingAsset.id)
      return { asset: existingAsset, node: nextNode, result: { ...result, asset_id: existingAsset.id } }
    }

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
        sourcePath: canvasSourcePath(canvas),
        dramaId: toOptionalInt(canvas.sourceDramaId),
        episodeId: toOptionalInt(canvas.sourceEpisodeId),
        url: toPublicMediaUrl(result.url),
        thumbnailUrl: toPublicMediaUrl(result.thumbnail_url || result.url),
        metadataJson: JSON.stringify({
          canvas_id: canvasId,
          canvas_title: canvas.title,
          source_drama_id: canvas.sourceDramaId ?? null,
          source_episode_id: canvas.sourceEpisodeId ?? null,
          node_id: node.id,
          node_def_id: node.nodeDefId,
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

    const nextNode = await this.nodeResultService.markAssetId(canvasId, node.id, result.id, asset.id)
    return { asset, node: nextNode, result: { ...result, asset_id: asset.id } }
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
    canvasTitle?: string | null
    nodeDefId?: string | null
    dramaId?: number | null
    episodeId?: number | null
    sourcePath?: string | null
  }) {
    const [asset] = await this.db.db
      .insert(assets)
      .values({
        userId: args.userId,
        kind: args.kind,
        title: args.title || '画布上传',
        mimeType: args.mimeType ?? null,
        sourceType: CANVAS_ASSET_SOURCE_TYPES.UPLOAD,
        sourceRef: args.canvasId,
        sourcePath: args.sourcePath || `/canvas/${args.canvasId}`,
        dramaId: args.dramaId ?? null,
        episodeId: args.episodeId ?? null,
        url: toPublicMediaUrl(args.url),
        thumbnailUrl: toPublicMediaUrl(args.thumbnailUrl || args.url),
        metadataJson: JSON.stringify({
          canvas_id: args.canvasId,
          canvas_title: args.canvasTitle ?? null,
          source_drama_id: args.dramaId ?? null,
          source_episode_id: args.episodeId ?? null,
          node_id: args.nodeId ?? null,
          node_def_id: args.nodeDefId ?? null,
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

  private async findExistingCanvasAsset(userId: number, canvasId: string, nodeId: string, resultId: string) {
    const rows = await this.db.db
      .select()
      .from(assets)
      .where(and(eq(assets.userId, userId), eq(assets.sourceRef, canvasId), isNull(assets.deletedAt)))

    return rows.find((asset) => metadataMatchesCanvasResult(asset.metadataJson, nodeId, resultId)) || null
  }
}
