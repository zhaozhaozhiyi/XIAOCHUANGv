import { describe, expect, it, vi } from 'vitest'

import { CanvasInputResolverService } from '../execution/canvas-input-resolver.service'

function queryResult(result: any[]) {
  const promise = Promise.resolve(result)
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    then: promise.then.bind(promise),
  }
  return chain
}

describe('CanvasInputResolverService', () => {
  it('resolves existing and generated videos in the requested shot order', async () => {
    const results = [
      [
        { sourceNodeId: 'video_2', targetNodeId: 'concat_1', edgeKind: 'dataflow' },
        { sourceNodeId: 'video_3', targetNodeId: 'concat_1', edgeKind: 'dataflow' },
      ],
      [
        { id: 'video_2', nodeDefId: 'image-to-video', dataJson: '{}' },
        { id: 'video_3', nodeDefId: 'image-to-video', dataJson: '{}' },
      ],
      [
        { nodeId: 'video_2', resultJson: JSON.stringify({ url: 'https://example.com/2.mp4' }) },
        { nodeId: 'video_3', resultJson: JSON.stringify({ url: 'https://example.com/3.mp4' }) },
      ],
    ]
    let selectIndex = 0
    const db = {
      db: {
        select: vi.fn(() => queryResult(results[selectIndex++] ?? [])),
      },
    }
    const service = new CanvasInputResolverService(db as any)

    const resolved = await service.resolve('cnv_1', 'run_1', 'concat_1', {
      videoSources: [
        { url: 'https://example.com/1.mp4' },
        { nodeId: 'video_2' },
        { nodeId: 'video_3' },
      ],
    })

    expect(resolved.videoUrls).toEqual([
      'https://example.com/1.mp4',
      'https://example.com/2.mp4',
      'https://example.com/3.mp4',
    ])
  })
})
