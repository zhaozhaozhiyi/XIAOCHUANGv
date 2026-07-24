import { describe, expect, it, vi } from 'vitest'

import { episodeEditRevisions } from '../../db/schema'
import { MergeService } from './merge.service'

function createDatabase(editRevisionId: number | null) {
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = []
  return {
    updates,
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([{ editRevisionId }])),
        })),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn((values: Record<string, unknown>) => {
          updates.push({ table, values })
          return {
            where: vi.fn(() => Promise.resolve()),
          }
        }),
      })),
    },
  }
}

describe('MergeService edit revision task state', () => {
  it('keeps an edit revision aligned with retry, cancellation, and failure actions', async () => {
    const database = createDatabase(401)
    const service = new MergeService(
      database as any,
      {} as any,
      {} as any,
    )

    await service.resetEditRevisionRenderForRetry(91)
    await service.cancelEditRevisionRender(91)
    await service.failEditRevisionRender(91, 'ffmpeg exited with status 1')

    expect(database.updates).toEqual([
      expect.objectContaining({
        table: episodeEditRevisions,
        values: expect.objectContaining({
          status: 'rendering',
          failureCode: null,
          failureDetail: null,
        }),
      }),
      expect.objectContaining({
        table: episodeEditRevisions,
        values: expect.objectContaining({
          status: 'approved',
          failureCode: null,
          failureDetail: null,
        }),
      }),
      expect.objectContaining({
        table: episodeEditRevisions,
        values: expect.objectContaining({
          status: 'failed',
          failureCode: 'timeline_render_failed',
          failureDetail: 'ffmpeg exited with status 1',
        }),
      }),
    ])
  })
})
