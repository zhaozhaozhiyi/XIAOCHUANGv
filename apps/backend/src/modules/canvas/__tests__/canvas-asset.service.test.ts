import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasAssetService } from '../canvas-asset.service'

function createDbMock(selectRows: unknown[][], insertedAsset: Record<string, unknown> = { id: 77 }) {
  const values = vi.fn((_payload: Record<string, unknown>) => ({
    returning: vi.fn(() => Promise.resolve([insertedAsset])),
  }))
  return {
    values,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(selectRows.shift() || [])),
        })),
      })),
      insert: vi.fn(() => ({ values })),
    },
  }
}

function createService(db: ReturnType<typeof createDbMock>) {
  const canvasService = {
    requireOwnedCanvas: vi.fn(() => Promise.resolve({ id: 'cnv_1', title: '来源画布' })),
  }
  const nodeResultService = {
    markAssetId: vi.fn((_canvasId: string, nodeId: string, resultId: string, assetId: number) => Promise.resolve({
      id: nodeId,
      type: 'image',
      position: { x: 0, y: 0 },
      data: {
        current_result_id: resultId,
        results: [{ id: resultId, kind: 'image', url: '/static/a.png', asset_id: assetId }],
      },
    })),
  }

  return {
    service: new CanvasAssetService(db as any, canvasService as any, nodeResultService as any),
    canvasService,
    nodeResultService,
  }
}

describe('CanvasAssetService', () => {
  const node = {
    id: 'node_1',
    label: '图片节点',
    nodeDefId: 'image',
    dataJson: JSON.stringify({
      current_result_id: 'res_1',
      results: [{
        id: 'res_1',
        kind: 'image',
        url: '/static/a.png',
        thumbnail_url: '/static/a-thumb.png',
        prompt: '雨夜',
        created_at: '2026-07-07T00:00:00.000Z',
      }],
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a canvas asset with source metadata and returns updated node state', async () => {
    const insertedAsset = { id: 88, sourceType: 'canvas_generation' }
    const db = createDbMock([[node], []], insertedAsset)
    const { service, nodeResultService } = createService(db)

    const result = await service.createAssetFromNodeResult('cnv_1', 1, { node_id: 'node_1' })

    expect(db.db.insert).toHaveBeenCalledTimes(1)
    expect(db.values).toHaveBeenCalledTimes(1)
    const payload = db.values.mock.calls[0][0]
    expect(payload.sourceType).toBe('canvas_generation')
    expect(payload.sourceRef).toBe('cnv_1')
    expect(payload.sourcePath).toBe('/canvas/cnv_1')
    expect(JSON.parse(String(payload.metadataJson))).toMatchObject({
      canvas_id: 'cnv_1',
      canvas_title: '来源画布',
      node_id: 'node_1',
      node_def_id: 'image',
      result_id: 'res_1',
      prompt: '雨夜',
    })
    expect(nodeResultService.markAssetId).toHaveBeenCalledWith('cnv_1', 'node_1', 'res_1', 88)
    expect(result).toMatchObject({
      asset: insertedAsset,
      node: { id: 'node_1' },
      result: { id: 'res_1', asset_id: 88 },
    })
  })

  it('reuses an existing canvas asset for the same node result', async () => {
    const existingAsset = {
      id: 99,
      sourceRef: 'cnv_1',
      metadataJson: JSON.stringify({ node_id: 'node_1', result_id: 'res_1' }),
    }
    const db = createDbMock([[node], [existingAsset]])
    const { service, nodeResultService } = createService(db)

    const result = await service.createAssetFromNodeResult('cnv_1', 1, { node_id: 'node_1' })

    expect(db.db.insert).not.toHaveBeenCalled()
    expect(nodeResultService.markAssetId).toHaveBeenCalledWith('cnv_1', 'node_1', 'res_1', 99)
    expect(result).toMatchObject({
      asset: existingAsset,
      result: { id: 'res_1', asset_id: 99 },
    })
  })

  it('uses canvas_history source type when saving a non-current historical result', async () => {
    const historicalNode = {
      ...node,
      dataJson: JSON.stringify({
        current_result_id: 'res_1',
        results: [
          {
            id: 'res_1',
            kind: 'image',
            url: '/static/a.png',
            created_at: '2026-07-07T00:00:00.000Z',
            source_type: 'canvas_generation',
          },
          {
            id: 'res_0',
            kind: 'image',
            url: '/static/old.png',
            created_at: '2026-07-06T00:00:00.000Z',
            source_type: 'canvas_generation',
          },
        ],
      }),
    }
    const db = createDbMock([[historicalNode], []], { id: 100, sourceType: 'canvas_history' })
    const { service } = createService(db)

    await service.createAssetFromNodeResult('cnv_1', 1, { node_id: 'node_1', result_id: 'res_0' })

    expect(db.values.mock.calls[0][0]).toMatchObject({
      sourceType: 'canvas_history',
      sourceRef: 'cnv_1',
      sourcePath: '/canvas/cnv_1',
    })
  })

  it('creates upload assets with the canvas_upload source type and source metadata', async () => {
    const db = createDbMock([], { id: 101, sourceType: 'canvas_upload' })
    const { service } = createService(db)

    const asset = await service.createAssetFromUpload({
      canvasId: 'cnv_1',
      userId: 1,
      kind: 'image',
      title: '上传图',
      url: '/static/upload.png',
      thumbnailUrl: '/static/upload.png',
      mimeType: 'image/png',
      nodeId: 'node_upload',
      resultId: 'res_upload',
      canvasTitle: '来源画布',
      nodeDefId: 'image',
    })

    expect(asset).toMatchObject({ id: 101 })
    expect(db.values.mock.calls[0][0]).toMatchObject({
      sourceType: 'canvas_upload',
      sourceRef: 'cnv_1',
      sourcePath: '/canvas/cnv_1',
    })
    expect(JSON.parse(String(db.values.mock.calls[0][0].metadataJson))).toMatchObject({
      canvas_id: 'cnv_1',
      node_id: 'node_upload',
      result_id: 'res_upload',
    })
  })
})
