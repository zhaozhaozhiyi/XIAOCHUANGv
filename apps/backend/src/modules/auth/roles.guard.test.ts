import { ForbiddenException, UnauthorizedException } from '@nestjs/common'
import { describe, expect, it, vi } from 'vitest'

import { RolesGuard } from './roles.guard'

function createExecutionContext(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => 'handler',
    getClass: () => 'class',
  } as any
}

describe('RolesGuard', () => {
  it('allows requests when no role metadata is present', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => undefined),
    }
    const authService = {
      getSession: vi.fn(),
    }
    const guard = new RolesGuard(reflector as any, authService as any)

    await expect(guard.canActivate(createExecutionContext({}))).resolves.toBe(true)
    expect(authService.getSession).not.toHaveBeenCalled()
  })

  it('loads the session user when the request has not been hydrated yet', async () => {
    const request: Record<string, unknown> = {}
    const reflector = {
      getAllAndOverride: vi.fn(() => ['admin']),
    }
    const authService = {
      getSession: vi.fn(async () => ({
        user: { id: 1, role: 'admin', displayName: 'Admin' },
      })),
    }
    const guard = new RolesGuard(reflector as any, authService as any)

    await expect(guard.canActivate(createExecutionContext(request))).resolves.toBe(true)
    expect(request.currentUser).toEqual({ id: 1, role: 'admin', displayName: 'Admin' })
  })

  it('rejects unauthenticated requests when a role is required', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => ['admin']),
    }
    const authService = {
      getSession: vi.fn(async () => null),
    }
    const guard = new RolesGuard(reflector as any, authService as any)

    await expect(guard.canActivate(createExecutionContext({}))).rejects.toBeInstanceOf(UnauthorizedException)
  })

  it('rejects users whose role is not allowed', async () => {
    const reflector = {
      getAllAndOverride: vi.fn(() => ['super_admin']),
    }
    const authService = {
      getSession: vi.fn(),
    }
    const guard = new RolesGuard(reflector as any, authService as any)
    const request = {
      currentUser: { id: 2, role: 'admin', displayName: 'Editor' },
    }

    await expect(guard.canActivate(createExecutionContext(request))).rejects.toBeInstanceOf(ForbiddenException)
  })
})
