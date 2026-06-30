import path from 'node:path'

import { BadRequestException, Inject, Injectable, PayloadTooLargeException } from '@nestjs/common'
import type { FastifyRequest } from 'fastify'
import { randomUUID } from 'crypto'

import { DatabaseService } from '../../db/database.service'
import { canvasNodes } from '../../db/schema'
import { StorageService } from '../storage/storage.service'
import { CanvasAssetService } from './canvas-asset.service'
import { CanvasNodeResult, CanvasNodeResultKind } from './canvas-node-result.service'
import { CanvasService } from './canvas.service'

const MULTIPART_OVERHEAD_BYTES = 512 * 1024
const MAX_CANVAS_UPLOAD_BYTES = 200 * 1024 * 1024

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

function mediaKindFromMime(mimeType: string): { resultKind: CanvasNodeResultKind; nodeType: string; assetKind: 'image' | 'video' | 'audio' } {
  if (mimeType.startsWith('image/')) return { resultKind: 'image', nodeType: 'image', assetKind: 'image' }
  if (mimeType.startsWith('video/')) return { resultKind: 'video', nodeType: 'video-asset', assetKind: 'video' }
  if (mimeType.startsWith('audio/')) return { resultKind: 'audio', nodeType: 'audio', assetKind: 'audio' }
  throw new BadRequestException('仅支持图片、视频、音频上传')
}

function toNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

@Injectable()
export class CanvasUploadService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(CanvasService) private readonly canvasService: CanvasService,
    @Inject(CanvasAssetService) private readonly canvasAssetService: CanvasAssetService,
  ) {}

  async uploadToCanvas(canvasId: string, userId: number, request: FastifyRequest) {
    await this.canvasService.requireOwnedCanvas(canvasId, userId)
    const { file, fields } = this.parseMultipartRequest(request)
    const media = mediaKindFromMime(file.mimeType)
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
      source_type: 'canvas_upload',
      created_at: new Date().toISOString(),
      metadata: { storage_key: saved.key, size: saved.size },
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

    let asset: unknown = null
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
      })
    }

    return {
      node: {
        id: nodeId,
        type: media.nodeType,
        position: { x: toNumber(fields.position_x, 120), y: toNumber(fields.position_y, 120) },
        data,
      },
      result,
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
        source_type: 'canvas_upload',
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
    if (!Buffer.isBuffer(body)) throw new BadRequestException('仅支持 multipart/form-data 上传')
    if (body.byteLength > MAX_CANVAS_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new PayloadTooLargeException('上传文件不能超过 200MB')
    }

    const boundary = extractBoundary(String(request.headers['content-type'] || ''))
    if (!boundary) throw new BadRequestException('上传数据缺少 boundary')
    const parts = this.parseMultipartBody(body, boundary)
    const file = parts.find((item): item is Extract<ParsedMultipartPart, { kind: 'file' }> => item.kind === 'file' && item.fieldName === 'file')
    if (!file) throw new BadRequestException('file is required')
    if (file.buffer.byteLength > MAX_CANVAS_UPLOAD_BYTES) throw new PayloadTooLargeException('上传文件不能超过 200MB')

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
