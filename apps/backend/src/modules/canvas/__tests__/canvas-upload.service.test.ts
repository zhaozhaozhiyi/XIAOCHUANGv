import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  assertCanvasUploadSize,
  CANVAS_UPLOAD_POLICIES,
  CanvasUploadService,
  resolveCanvasUploadPolicy,
} from '../canvas-upload.service'

const BOUNDARY = '----xc-test-boundary'

function multipartBody(parts: Array<
  | { kind: 'field'; name: string; value: string }
  | { kind: 'file'; name: string; filename: string; mimeType: string; content: string }
>) {
  const chunks: string[] = []
  for (const part of parts) {
    chunks.push(`--${BOUNDARY}\r\n`)
    if (part.kind === 'field') {
      chunks.push(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`)
    } else {
      chunks.push(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n`)
      chunks.push(`Content-Type: ${part.mimeType}\r\n\r\n${part.content}\r\n`)
    }
  }
  chunks.push(`--${BOUNDARY}--\r\n`)
  return Buffer.from(chunks.join(''), 'utf8')
}

function request(parts: Parameters<typeof multipartBody>[0]) {
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    body: multipartBody(parts),
  }
}

function createDbMock() {
  const inserts: Array<Record<string, unknown>> = []
  const values = vi.fn((payload: Record<string, unknown>) => {
    inserts.push(payload)
    return Promise.resolve()
  })
  return {
    inserts,
    values,
    db: {
      insert: vi.fn(() => ({ values })),
    },
  }
}

function createService() {
  const db = createDbMock()
  const storageService = {
    saveBuffer: vi.fn(({ fileName, mimeType }) => Promise.resolve({
      url: `/static/canvas_uploads/${fileName}`,
      key: `canvas_uploads/${fileName}`,
      size: 12,
      mimeType,
    })),
  }
  const canvasService = {
    requireOwnedCanvas: vi.fn(() => Promise.resolve({ id: 'cnv_1', title: '测试画布' })),
  }
  const canvasAssetService = {
    createAssetFromUpload: vi.fn(() => Promise.resolve({ id: 42 })),
  }
  const nodeResultService = {
    appendResult: vi.fn(() => Promise.resolve({
      result: {
        id: 'res_existing',
        kind: 'image',
        url: '/static/canvas_uploads/a.png',
        created_at: '2026-07-07T00:00:00.000Z',
      },
      node: {
        id: 'node_existing',
        type: 'image',
        position: { x: 0, y: 0 },
        data: {
          current_result_id: 'res_existing',
          results: [{ id: 'res_existing', kind: 'image', url: '/static/canvas_uploads/a.png' }],
        },
      },
    })),
    markAssetId: vi.fn(() => Promise.resolve({
      id: 'node_existing',
      type: 'image',
      position: { x: 0, y: 0 },
      data: {
        current_result_id: 'res_existing',
        results: [{ id: 'res_existing', kind: 'image', url: '/static/canvas_uploads/a.png', asset_id: 42 }],
      },
    })),
  }

  const service = new CanvasUploadService(
    db as any,
    storageService as any,
    canvasService as any,
    canvasAssetService as any,
    nodeResultService as any,
  )

  return { service, db, storageService, canvasService, canvasAssetService, nodeResultService }
}

describe('CanvasUploadService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads a png as a new image node without saving to assets by default', async () => {
    const { service, db, canvasAssetService } = createService()

    const result = await service.uploadToCanvas('cnv_1', 1, request([
      { kind: 'field', name: 'title', value: '雨夜参考图' },
      { kind: 'field', name: 'position_x', value: '320' },
      { kind: 'field', name: 'position_y', value: '180' },
      { kind: 'file', name: 'file', filename: 'rain.png', mimeType: 'image/png', content: 'png-content' },
    ]) as any)

    expect(db.db.insert).toHaveBeenCalledTimes(1)
    const payload = db.inserts[0]!
    expect(payload.nodeDefId).toBe('image')
    expect(payload.positionX).toBe(320)
    expect(payload.positionY).toBe(180)
    expect(result).toMatchObject({
      node: { type: 'image', position: { x: 320, y: 180 } },
      upload: { kind: 'image', title: '雨夜参考图' },
      asset: null,
    })
    expect(canvasAssetService.createAssetFromUpload).not.toHaveBeenCalled()
  })

  it('saves uploaded video to assets when requested', async () => {
    const { service, canvasAssetService } = createService()

    const result = await service.uploadToCanvas('cnv_1', 1, request([
      { kind: 'field', name: 'save_to_assets', value: 'true' },
      { kind: 'file', name: 'file', filename: 'clip.mp4', mimeType: 'video/mp4', content: 'video-content' },
    ]) as any)

    expect(canvasAssetService.createAssetFromUpload).toHaveBeenCalledWith(expect.objectContaining({
      canvasId: 'cnv_1',
      kind: 'video',
      title: 'clip.mp4',
      nodeDefId: 'video-asset',
      canvasTitle: '测试画布',
    }))
    expect(result.node.type).toBe('video-asset')
    expect(result.result.asset_id).toBe(42)
  })

  it('appends upload to an existing node when node_id is provided', async () => {
    const { service, db, nodeResultService } = createService()

    const result = await service.uploadToCanvas('cnv_1', 1, request([
      { kind: 'field', name: 'node_id', value: 'node_existing' },
      { kind: 'file', name: 'file', filename: 'voice.wav', mimeType: 'audio/wav', content: 'audio-content' },
    ]) as any)

    expect(db.db.insert).not.toHaveBeenCalled()
    expect(nodeResultService.appendResult).toHaveBeenCalledWith('cnv_1', 'node_existing', expect.objectContaining({
      kind: 'audio',
      url: '/static/canvas_uploads/voice.wav',
      mime_type: 'audio/wav',
      source_type: 'canvas_upload',
    }))
    expect(result.node.id).toBe('node_existing')
  })

  it('rejects unsupported file types', async () => {
    const { service } = createService()

    await expect(service.uploadToCanvas('cnv_1', 1, request([
      { kind: 'file', name: 'file', filename: 'archive.zip', mimeType: 'application/zip', content: 'zip' },
    ]) as any)).rejects.toThrow(/canvas_upload_type_unsupported/)
  })

  it('enforces tiered size limits for image, video, and audio uploads', () => {
    const image = resolveCanvasUploadPolicy('image/png', 'frame.png')
    const video = resolveCanvasUploadPolicy('video/mp4', 'clip.mp4')
    const audio = resolveCanvasUploadPolicy('audio/wav', 'voice.wav')

    expect(image.maxBytes).toBe(CANVAS_UPLOAD_POLICIES.image.maxBytes)
    expect(video.maxBytes).toBe(CANVAS_UPLOAD_POLICIES.video.maxBytes)
    expect(audio.maxBytes).toBe(CANVAS_UPLOAD_POLICIES.audio.maxBytes)

    expect(() => assertCanvasUploadSize(image, CANVAS_UPLOAD_POLICIES.image.maxBytes)).not.toThrow()
    expect(() => assertCanvasUploadSize(video, CANVAS_UPLOAD_POLICIES.video.maxBytes)).not.toThrow()
    expect(() => assertCanvasUploadSize(audio, CANVAS_UPLOAD_POLICIES.audio.maxBytes)).not.toThrow()

    expect(() => assertCanvasUploadSize(image, CANVAS_UPLOAD_POLICIES.image.maxBytes + 1)).toThrow(/canvas_upload_too_large/)
    expect(() => assertCanvasUploadSize(video, CANVAS_UPLOAD_POLICIES.video.maxBytes + 1)).toThrow(/canvas_upload_too_large/)
    expect(() => assertCanvasUploadSize(audio, CANVAS_UPLOAD_POLICIES.audio.maxBytes + 1)).toThrow(/canvas_upload_too_large/)
  })
})
