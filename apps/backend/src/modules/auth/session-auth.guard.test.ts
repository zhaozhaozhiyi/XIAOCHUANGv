import { UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { SessionAuthGuard } from './session-auth.guard'

function createExecutionContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as any
}

describe('SessionAuthGuard', () => {
  it('attaches the current user and session when a session is found', async () => {
    const session = {
      id: 1,
      userId: 2,
      user: { id: 2, role: 'admin', displayName: 'Admin' },
    }
    const authService = {
      getSession: vi.fn(async () => session),
    }
    const guard = new SessionAuthGuard(authService as any)
    const request: Record<string, unknown> = {}

    await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true)
    expect(request.currentSession).toBe(session)
    expect(request.currentUser).toBe(session.user)
  })

  it('rejects requests without a valid session', async () => {
    const authService = {
      getSession: vi.fn(async () => null),
    }
    const guard = new SessionAuthGuard(authService as any)

    await expect(guard.canActivate(createExecutionContext({}))).rejects.toBeInstanceOf(UnauthorizedException)
  })
})
