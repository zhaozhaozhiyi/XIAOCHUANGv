import { describe, expect, it, vi } from 'vitest'

import { CanvasModuleRouterService } from '../execution/canvas-module-router.service'
import type { CanvasGenerateContext } from '../execution/canvas-execution.types'

describe('CanvasModuleRouterService stub mode', () => {
  it('text-to-image stub returns image url', async () => {
    const config = { get: vi.fn(() => '1') }
    const service = new CanvasModuleRouterService(
      {} as any,
      config as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    )

    const context: CanvasGenerateContext = { source: 'canvas', userId: '1', canvasId: 'cnv_1', nodeId: 'n1' }
    const result = await service.execute(
      'text-to-image',
      { prompt: 'hello world' },
      { videoUrls: [], references: [] },
      context,
    )

    expect(result.url).toContain('picsum.photos')
    expect(result.outputs[0]?.type).toBe('image')
  })

  it('inherits drama style and source ids for text-to-image execution', async () => {
    const config = { get: vi.fn(() => '0') }
    const selectRows = [
      [{ style: 'anime' }],
      [{ id: 42, status: 'completed', imageUrl: 'https://example.com/frame.png' }],
    ]
    let selectIndex = 0
    const db = {
      db: {
        select: vi.fn(() => {
          const rows = selectRows[selectIndex++] ?? []
          const chain: any = {
            from: vi.fn(() => chain),
            where: vi.fn(() => Promise.resolve(rows)),
          }
          return chain
        }),
      },
    }
    const images = {
      generateImage: vi.fn().mockResolvedValue(42),
      processImageGeneration: vi.fn().mockResolvedValue(undefined),
    }
    const service = new CanvasModuleRouterService(
      db as any,
      config as any,
      images as any,
      {} as any,
      {} as any,
      {} as any,
    )

    const context: CanvasGenerateContext = {
      source: 'canvas',
      userId: '1',
      canvasId: 'cnv_1',
      nodeId: 'n1',
      dramaId: '7',
      episodeId: '8',
    }
    await service.execute(
      'text-to-image',
      { prompt: '人物走进房间', storyboardId: 9 },
      { videoUrls: [], references: [] },
      context,
    )

    expect(images.generateImage).toHaveBeenCalledWith(expect.objectContaining({
      dramaId: 7,
      storyboardId: 9,
      prompt: expect.stringContaining('anime style'),
      taskPayload: expect.objectContaining({ drama_id: 7, episode_id: 8, storyboard_id: 9 }),
    }))
  })
})
