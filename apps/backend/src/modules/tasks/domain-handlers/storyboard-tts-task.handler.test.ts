import { describe, expect, it, vi } from 'vitest'

import { StoryboardTtsTaskHandler } from './storyboard-tts-task.handler'

function createUpdateDb(setPayloads: Array<Record<string, unknown>>) {
  return {
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        setPayloads.push(payload)
        return {
          where: vi.fn(() => Promise.resolve()),
        }
      }),
    })),
  }
}

describe('StoryboardTtsTaskHandler', () => {
  it('classifies failed TTS tasks with the shared error-kind inference', async () => {
    const setPayloads: Array<Record<string, unknown>> = []
    const handler = new StoryboardTtsTaskHandler(
      { db: createUpdateDb(setPayloads) } as any,
      {} as any,
    )

    await handler.markFailed({ id: 42 } as any, new Error('network timeout while creating audio'))

    expect(setPayloads).toHaveLength(1)
    expect(setPayloads[0]).toMatchObject({
      status: 'failed',
      errorKind: 'network',
      errorMessage: 'network timeout while creating audio',
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })
    expect(JSON.parse(String(setPayloads[0].errorDetailsJson))).toEqual({
      error_kind: 'network',
      raw_error: 'network timeout while creating audio',
    })
  })
})
