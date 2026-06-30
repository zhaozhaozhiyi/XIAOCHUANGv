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
})
