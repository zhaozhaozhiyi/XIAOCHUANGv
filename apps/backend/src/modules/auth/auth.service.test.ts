import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthService } from './auth.service'

function createInsertDbMock() {
  const insertedValues: unknown[] = []
  return {
    insertedValues,
    db: {
      insert: vi.fn(() => ({
        values: vi.fn(async (values: unknown) => {
          insertedValues.push(values)
        }),
      })),
    },
  }
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-06T00:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores a server-side session expiration when creating a session', async () => {
    const dbMock = createInsertDbMock()
    const configService = {
      get: vi.fn((key: string, fallback?: unknown) => key === 'SESSION_DURATION_DAYS' ? 3 : fallback),
    }
    const service = new AuthService(dbMock as any, configService as any, {} as any)

    const result = await service.createSessionForUser(9)

    expect(result.expiresAt.toISOString()).toBe('2026-07-09T00:00:00.000Z')
    expect(dbMock.insertedValues).toHaveLength(1)
    expect(dbMock.insertedValues[0]).toMatchObject({
      userId: 9,
      expiresAt: new Date('2026-07-09T00:00:00.000Z'),
      revokedAt: null,
    })
  })
})
