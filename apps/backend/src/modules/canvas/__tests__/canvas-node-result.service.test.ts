import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CanvasNodeResultService, type CanvasNodeResult } from '../canvas-node-result.service'

type MockNode = {
  id: string
  canvasId: string
  nodeDefId: string
  label: string
  dataJson: string
  positionX: number
  positionY: number
  width: number
  height: number
  isHidden: boolean
  updatedAt?: Date
}

function cloneNode(node: MockNode): MockNode {
  return { ...node }
}

function createNode(data: Record<string, unknown> = {}, nodeDefId = 'image'): MockNode {
  return {
    id: 'node_1',
    canvasId: 'cnv_1',
    nodeDefId,
    label: '图片节点',
    dataJson: JSON.stringify(data),
    positionX: 10,
    positionY: 20,
    width: 208,
    height: 160,
    isHidden: false,
  }
}

function createDbMock(initialNode: MockNode) {
  const state = { node: cloneNode(initialNode) }
  const txLocks: string[] = []
  let chain = Promise.resolve()

  const buildTx = () => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          for: vi.fn((strength: string) => {
            txLocks.push(strength)
            return Promise.resolve([cloneNode(state.node)])
          }),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn((payload: Partial<MockNode>) => ({
        where: vi.fn(() => {
          state.node = { ...state.node, ...payload }
          return Promise.resolve()
        }),
      })),
    })),
    execute: vi.fn(() => Promise.resolve()),
  })

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve([cloneNode(state.node)])),
      })),
    })),
    transaction: vi.fn((callback: (tx: ReturnType<typeof buildTx>) => Promise<unknown>) => {
      const run = chain.then(() => callback(buildTx()))
      chain = run.then(() => undefined, () => undefined)
      return run
    }),
  }

  return {
    db: { db } as any,
    state,
    txLocks,
    transaction: db.transaction,
  }
}

function resultsFrom(node: MockNode) {
  const data = JSON.parse(node.dataJson) as Record<string, unknown> & {
    results?: CanvasNodeResult[]
    current_result_id?: string | null
  }
  return {
    data,
    results: Array.isArray(data.results) ? data.results : [],
  }
}

describe('CanvasNodeResultService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('appends a result and marks it as current inside a row-locking transaction', async () => {
    const mock = createDbMock(createNode({ label: '原图' }))
    const service = new CanvasNodeResultService(mock.db)

    const output = await service.appendResult('cnv_1', 'node_1', {
      kind: 'image',
      url: '/static/new.png',
      title: '新结果',
      source_type: 'canvas_generation',
    })

    const { data, results } = resultsFrom(mock.state.node)
    expect(mock.transaction).toHaveBeenCalledTimes(1)
    expect(mock.txLocks).toEqual(['update'])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ url: '/static/new.png', title: '新结果' })
    expect(data.current_result_id).toBe(results[0].id)
    expect(data.images).toEqual(['/static/new.png'])
    expect(data.previewUrl).toBe('/static/new.png')
    expect(output.node.data.current_result_id).toBe(output.result.id)
  })

  it('keeps only the newest 20 results and does not leave current_result_id dangling', async () => {
    const existing = Array.from({ length: 20 }, (_, index) => ({
      id: `res_${index}`,
      kind: 'image' as const,
      url: `/static/${index}.png`,
      created_at: `2026-07-07T00:00:${String(index).padStart(2, '0')}.000Z`,
    }))
    const mock = createDbMock(createNode({ results: existing, current_result_id: 'res_19' }))
    const service = new CanvasNodeResultService(mock.db)

    await service.appendResult('cnv_1', 'node_1', { kind: 'image', url: '/static/latest.png' })

    const { data, results } = resultsFrom(mock.state.node)
    expect(results).toHaveLength(20)
    expect(results[0].url).toBe('/static/latest.png')
    expect(results.some((item) => item.id === 'res_19')).toBe(false)
    expect(results.some((item) => item.id === data.current_result_id)).toBe(true)
  })

  it('selects an existing historical result and updates the node preview', async () => {
    const mock = createDbMock(createNode({
      results: [
        { id: 'res_new', kind: 'image', url: '/static/new.png', created_at: '2026-07-07T00:00:01.000Z' },
        { id: 'res_old', kind: 'image', url: '/static/old.png', created_at: '2026-07-07T00:00:00.000Z' },
      ],
      current_result_id: 'res_new',
    }))
    const service = new CanvasNodeResultService(mock.db)

    const output = await service.selectResult('cnv_1', 'node_1', 'res_old')

    const { data } = resultsFrom(mock.state.node)
    expect(data.current_result_id).toBe('res_old')
    expect(data.previewUrl).toBe('/static/old.png')
    expect(output.result.id).toBe('res_old')
  })

  it('updates DramaClaw image node preview fields', async () => {
    const mock = createDbMock(createNode({ isGenerating: true, status: 'generating' }, 'imageNode'))
    const service = new CanvasNodeResultService(mock.db)

    await service.appendResult('cnv_1', 'node_1', { kind: 'image', url: '/static/drama.png' })

    const { data } = resultsFrom(mock.state.node)
    expect(data.imageUrl).toBe('/static/drama.png')
    expect(data.previewImageUrl).toBe('/static/drama.png')
    expect(data.generationBatch).toEqual(['/static/drama.png'])
    expect(data.isGenerating).toBe(false)
    expect(data.status).toBe('completed')
  })

  it('updates DramaClaw video node result fields', async () => {
    const mock = createDbMock(createNode({ isGenerating: true }, 'videoNode'))
    const service = new CanvasNodeResultService(mock.db)

    await service.appendResult('cnv_1', 'node_1', {
      kind: 'video',
      url: '/static/drama.mp4',
      thumbnail_url: '/static/thumb.png',
    })

    const { data } = resultsFrom(mock.state.node)
    expect(data.videoUrl).toBe('/static/drama.mp4')
    expect(data.resultVideoUrl).toBe('/static/drama.mp4')
    expect(data.url).toBe('/static/drama.mp4')
    expect(data.previewImageUrl).toBe('/static/thumb.png')
    expect(data.isGenerating).toBe(false)
  })

  it('updates DramaClaw audio node url fields', async () => {
    const mock = createDbMock(createNode({ isGenerating: true }, 'audioNode'))
    const service = new CanvasNodeResultService(mock.db)

    await service.appendResult('cnv_1', 'node_1', { kind: 'audio', url: '/static/drama.mp3' })

    const { data } = resultsFrom(mock.state.node)
    expect(data.audioUrl).toBe('/static/drama.mp3')
    expect(data.url).toBe('/static/drama.mp3')
    expect(data.isGenerating).toBe(false)
  })

  it('marks a result asset id without changing a valid current selection', async () => {
    const mock = createDbMock(createNode({
      results: [
        { id: 'res_new', kind: 'image', url: '/static/new.png', created_at: '2026-07-07T00:00:01.000Z' },
        { id: 'res_old', kind: 'image', url: '/static/old.png', created_at: '2026-07-07T00:00:00.000Z' },
      ],
      current_result_id: 'res_old',
    }))
    const service = new CanvasNodeResultService(mock.db)

    await service.markAssetId('cnv_1', 'node_1', 'res_new', 42)

    const { data, results } = resultsFrom(mock.state.node)
    expect(data.current_result_id).toBe('res_old')
    expect(results.find((item) => item.id === 'res_new')?.asset_id).toBe(42)
  })

  it('preserves both results across concurrent appends', async () => {
    const mock = createDbMock(createNode())
    const service = new CanvasNodeResultService(mock.db)

    await Promise.all([
      service.appendResult('cnv_1', 'node_1', { kind: 'image', url: '/static/a.png' }),
      service.appendResult('cnv_1', 'node_1', { kind: 'image', url: '/static/b.png' }),
    ])

    const { data, results } = resultsFrom(mock.state.node)
    expect(mock.transaction).toHaveBeenCalledTimes(2)
    expect(results.map((item) => item.url).sort()).toEqual(['/static/a.png', '/static/b.png'])
    expect(results.some((item) => item.id === data.current_result_id)).toBe(true)
  })

  it('keeps data valid when append and select overlap', async () => {
    const mock = createDbMock(createNode({
      results: [
        { id: 'res_base', kind: 'image', url: '/static/base.png', created_at: '2026-07-07T00:00:00.000Z' },
      ],
      current_result_id: 'res_base',
    }))
    const service = new CanvasNodeResultService(mock.db)

    await Promise.all([
      service.appendResult('cnv_1', 'node_1', { kind: 'image', url: '/static/new.png' }),
      service.selectResult('cnv_1', 'node_1', 'res_base'),
    ])

    const { data, results } = resultsFrom(mock.state.node)
    expect(results.map((item) => item.url).sort()).toEqual(['/static/base.png', '/static/new.png'])
    expect(results.some((item) => item.id === data.current_result_id)).toBe(true)
  })
})
