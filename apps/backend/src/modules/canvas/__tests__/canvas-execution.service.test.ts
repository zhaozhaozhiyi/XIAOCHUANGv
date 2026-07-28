import { describe, expect, it, vi } from 'vitest'

import { CanvasExecutionService } from '../execution/canvas-execution.service'

function queryResult(result: any[]) {
  const promise = Promise.resolve(result)
  const chain: any = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    then: promise.then.bind(promise),
  }
  return chain
}

describe('CanvasExecutionService', () => {
  it('reclaims a running canvas task after its BullMQ job is retried', async () => {
    const task = {
      id: 'task_1', runId: 'run_1', canvasId: 'cnv_1', nodeId: 'node_1',
      nodeDefId: 'image-to-video', status: 'running', paramsJson: '{}',
    }
    const selectResults = [
      [task],
      [{ id: 'run_1', versionId: 'ver_1', status: 'running' }],
      [task],
      [task],
    ]
    let selectIndex = 0
    const db = {
      db: {
        select: vi.fn(() => queryResult(selectResults[selectIndex++] ?? [])),
        update: vi.fn(() => ({
          set: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
        })),
      },
    }
    const inputResolver = { resolve: vi.fn(() => Promise.resolve({ videoUrls: [], references: [] })) }
    const moduleRouter = {
      execute: vi.fn(() => Promise.resolve({
        url: 'https://example.com/video.mp4',
        outputs: [{ type: 'video', url: 'https://example.com/video.mp4' }],
      })),
    }
    const backfill = { backfill: vi.fn(() => Promise.resolve()) }
    const service = new CanvasExecutionService(
      db as any,
      inputResolver as any,
      moduleRouter as any,
      backfill as any,
    )

    await expect(service.executeCanvasTaskById('task_1', 1, 'worker-retry')).resolves.toBe('completed')
    expect(moduleRouter.execute).toHaveBeenCalledOnce()
    expect(backfill.backfill).toHaveBeenCalledOnce()
  })
})
