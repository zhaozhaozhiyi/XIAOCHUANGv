import path from 'node:path'

import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../db/database.service'
import { canvasNodes } from '../../db/schema'
import { StorageService } from '../storage/storage.service'
import { CanvasAssetService } from './canvas-asset.service'
import { CanvasNodeResult, CanvasNodeResultKind, CanvasNodeResultService } from './canvas-node-result.service'
import { CANVAS_ASSET_SOURCE_TYPES } from './canvas-source-types'
import { CanvasService } from './canvas.service'

const MULTIPART_OVERHEAD_BYTES = 512 * 1024
const MAX_CANVAS_UPLOAD_BYTES = 200 * 1024 * 1024
const MB = 1024 * 1024

export const CANVAS_UPLOAD_POLICIES = {
  image: {
    resultKind: 'image' as const,
    nodeType: 'image',
    assetKind: 'image' as const,
    maxBytes: 30 * MB,
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'],
  },
  video: {
    resultKind: 'video' as const,
    nodeType: 'video-asset',
    assetKind: 'video' as const,
    maxBytes: 200 * MB,
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    extensions: ['.mp4', '.webm', '.mov'],
  },
  audio: {
    resultKind: 'audio' as const,
    nodeType: 'audio',
    assetKind: 'audio' as const,
    maxBytes: 100 * MB,
    mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'],
    extensions: ['.mp3', '.wav', '.m4a', '.aac', '.webm'],
  },
} as const

type ParsedMultipartPart =
  | { kind: 'field'; fieldName: string; value: string }
  | { kind: 'file'; fieldName: string; fileName: string; mimeType: string; buffer: Buffer }

function sanitizeFilename(rawName: string) {
  const normalized = path.basename(String(rawName || '').trim())
  const safeName = normalized.replace(/[^a-zA-Z0-9._() -]/g, '_')
  return safeName || 'upload.bin'
}

function extractBoundary(contentType: string) {
  const match = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i)
  return (match?.[1] || match?.[2] || '').trim()
}

function extractDispositionValue(source: string, key: string) {
  const match = source.match(new RegExp(`${key}="([^"]*)"`, 'i'))
  return match?.[1] || ''
}

function uid(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 10)}`
}

export function resolveCanvasUploadPolicy(mimeType: string, fileName: string): typeof CANVAS_UPLOAD_POLICIES[keyof typeof CANVAS_UPLOAD_POLICIES] {
  const normalizedMime = String(mimeType || '').split(';')[0].trim().toLowerCase()
  const extension = path.extname(fileName || '').toLowerCase()
  const policy = Object.values(CANVAS_UPLOAD_POLICIES).find((item) => (
    item.mimeTypes.includes(normalizedMime as never) || item.extensions.includes(extension as never)
  ))
  if (!policy) throw new BadRequestException('canvas_upload_type_unsupported')
  return policy
}

export function assertCanvasUploadSize(
  policy: typeof CANVAS_UPLOAD_POLICIES[keyof typeof CANVAS_UPLOAD_POLICIES],
  size: number,
) {
  if (size > policy.maxBytes) throw new PayloadTooLargeException('canvas_upload_too_large')
}

function toNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function toOptionalInt(value: string | number | null | undefined) {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function canvasSourcePath(canvas: { id: string; sourceDramaId?: string | null }) {
  const dramaId = toOptionalInt(canvas.sourceDramaId)
  if (dramaId) return `/drama/${dramaId}/canvas/${canvas.id}`
  return `/canvas/${canvas.id}`
}

@Injectable()
export class CanvasUploadService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(CanvasService) private readonly canvasService: CanvasService,
    @Inject(CanvasAssetService) private readonly canvasAssetService: CanvasAssetService,
    @Inject(CanvasNodeResultService) private readonly nodeResultService: CanvasNodeResultService,
  ) {}

  async uploadToCanvas(canvasId: string, userId: number, request: FastifyRequest) {
    const canvas = await this.canvasService.requireOwnedCanvas(canvasId, userId)
    const { file, fields } = this.parseMultipartRequest(request)
    const media = resolveCanvasUploadPolicy(file.mimeType, file.fileName)
    assertCanvasUploadSize(media, file.buffer.byteLength)
    const saved = await this.storageService.saveBuffer({
      buffer: file.buffer,
      subDir: 'canvas_uploads',
      fileName: file.fileName,
      mimeType: file.mimeType,
      extension: path.extname(file.fileName),
    })

    const nodeId = uid('node')
    const resultId = uid('res')
    const title = fields.title?.trim() || file.fileName
    const result: CanvasNodeResult = {
      id: resultId,
      kind: media.resultKind,
      url: saved.url,
      thumbnail_url: media.resultKind === 'image' ? saved.url : null,
      mime_type: file.mimeType,
      title,
      source_type: CANVAS_ASSET_SOURCE_TYPES.UPLOAD,
      created_at: new Date().toISOString(),
      metadata: { storage_key: saved.key, size: saved.size },
    }

    const upload = {
      url: saved.url,
      mime_type: file.mimeType,
      kind: media.resultKind,
      title,
    }

    if (fields.node_id) {
      const appended = await this.nodeResultService.appendResult(canvasId, fields.node_id, {
        kind: media.resultKind,
        url: saved.url,
        thumbnail_url: media.resultKind === 'image' ? saved.url : null,
        mime_type: file.mimeType,
        title,
        source_type: CANVAS_ASSET_SOURCE_TYPES.UPLOAD,
        metadata: { storage_key: saved.key, size: saved.size },
      })
      let node = appended.node
      let appendedResult: CanvasNodeResult = appended.result
      let asset: { id: number } | null = null
      if (fields.save_to_assets === 'true' || fields.save_to_assets === '1') {
        asset = await this.canvasAssetService.createAssetFromUpload({
          canvasId,
          userId,
          kind: media.assetKind,
          title,
          url: saved.url,
          thumbnailUrl: media.resultKind === 'image' ? saved.url : null,
          mimeType: file.mimeType,
          nodeId: fields.node_id,
          resultId: appended.result.id,
          canvasTitle: canvas.title,
          nodeDefId: appended.node.type,
          dramaId: toOptionalInt(canvas.sourceDramaId),
          episodeId: toOptionalInt(canvas.sourceEpisodeId),
          sourcePath: canvasSourcePath(canvas),
        })
        appendedResult = { ...appended.result, asset_id: asset.id }
        node = await this.nodeResultService.markAssetId(canvasId, fields.node_id, appended.result.id, asset.id)
      }
      return { node, result: appendedResult, upload, asset }
    }

    const data = this.buildNodeData(media.nodeType, title, result)
    await this.db.db.insert(canvasNodes).values({
      id: nodeId,
      canvasId,
      nodeDefId: media.nodeType,
      label: title,
      dataJson: JSON.stringify(data),
      positionX: toNumber(fields.position_x, 120),
      positionY: toNumber(fields.position_y, 120),
      isHidden: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    let asset: { id: number } | null = null
    if (fields.save_to_assets === 'true' || fields.save_to_assets === '1') {
      asset = await this.canvasAssetService.createAssetFromUpload({
        canvasId,
        userId,
        kind: media.assetKind,
        title,
        url: saved.url,
        thumbnailUrl: media.resultKind === 'image' ? saved.url : null,
        mimeType: file.mimeType,
        nodeId,
        resultId,
        canvasTitle: canvas.title,
        nodeDefId: media.nodeType,
        dramaId: toOptionalInt(canvas.sourceDramaId),
        episodeId: toOptionalInt(canvas.sourceEpisodeId),
        sourcePath: canvasSourcePath(canvas),
      })
      result.asset_id = asset.id
      data.results = [result]
    }

    return {
      node: {
        id: nodeId,
        type: media.nodeType,
        position: { x: toNumber(fields.position_x, 120), y: toNumber(fields.position_y, 120) },
        data,
      },
      result,
      upload,
      asset,
    }
  }

  private buildNodeData(nodeType: string, title: string, result: CanvasNodeResult) {
    const base: Record<string, unknown> = {
      title,
      name: title,
      results: [result],
      current_result_id: result.id,
      previewUrl: result.url,
      outputUrl: result.url,
      __lastRunResult: {
        url: result.url,
        at: result.created_at,
        result_id: result.id,
        source_type: CANVAS_ASSET_SOURCE_TYPES.UPLOAD,
      },
    }
    if (nodeType === 'image') base.images = [result.url]
    if (nodeType === 'video-asset') {
      base.video = result.url
      base.videoUrl = result.url
    }
    if (nodeType === 'audio') {
      base.audio = result.url
      base.audioUrl = result.url
    }
    return base
  }

  private parseMultipartRequest(request: FastifyRequest) {
    const body = request.body
    if (!Buffer.isBuffer(body)) throw new BadRequestException('canvas_upload_multipart_required')
    if (body.byteLength > MAX_CANVAS_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new PayloadTooLargeException('canvas_upload_too_large')
    }

    const boundary = extractBoundary(String(request.headers['content-type'] || ''))
    if (!boundary) throw new BadRequestException('canvas_upload_boundary_missing')
    const parts = this.parseMultipartBody(body, boundary)
    const file = parts.find((item): item is Extract<ParsedMultipartPart, { kind: 'file' }> => item.kind === 'file' && item.fieldName === 'file')
    if (!file) throw new BadRequestException('canvas_upload_file_required')
    if (file.buffer.byteLength > MAX_CANVAS_UPLOAD_BYTES) throw new PayloadTooLargeException('canvas_upload_too_large')

    const fields: Record<string, string> = {}
    for (const part of parts) {
      if (part.kind === 'field') fields[part.fieldName] = part.value
    }
    return { file, fields }
  }

  private parseMultipartBody(body: Buffer, boundary: string): ParsedMultipartPart[] {
    const bodyText = body.toString('latin1')
    const segments = bodyText.split(`--${boundary}`).slice(1, -1)
    const parts: ParsedMultipartPart[] = []

    for (let segment of segments) {
      if (segment.startsWith('\r\n')) segment = segment.slice(2)
      if (segment.endsWith('\r\n')) segment = segment.slice(0, -2)
      if (!segment) continue

      const headerEnd = segment.indexOf('\r\n\r\n')
      if (headerEnd < 0) continue

      const headerText = segment.slice(0, headerEnd)
      const payloadText = segment.slice(headerEnd + 4)
      const headerLines = headerText.split('\r\n')
      const disposition = headerLines.find((line) => line.toLowerCase().startsWith('content-disposition:'))
      if (!disposition) continue

      const fieldName = extractDispositionValue(disposition, 'name')
      const rawFileName = extractDispositionValue(disposition, 'filename')
      if (!fieldName) continue

      if (!rawFileName) {
        parts.push({ kind: 'field', fieldName, value: Buffer.from(payloadText, 'latin1').toString('utf8') })
        continue
      }

      const contentTypeHeader = headerLines.find((line) => line.toLowerCase().startsWith('content-type:'))
      const mimeType = contentTypeHeader
        ? contentTypeHeader.slice(contentTypeHeader.indexOf(':') + 1).trim()
        : 'application/octet-stream'

      parts.push({
        kind: 'file',
        fieldName,
        fileName: sanitizeFilename(rawFileName),
        mimeType,
        buffer: Buffer.from(payloadText, 'latin1'),
      })
    }

    return parts
  }
}
