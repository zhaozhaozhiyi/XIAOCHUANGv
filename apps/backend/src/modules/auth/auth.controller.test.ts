import { UnauthorizedException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthController } from './auth.controller'

const ORIGINAL_ENV = { ...process.env }

function createController() {
  const authService = {
    loginWithPassword: vi.fn(),
    setSessionCookie: vi.fn(),
    createSessionForUser: vi.fn(),
    logout: vi.fn(),
    clearSessionCookie: vi.fn(),
  }
  const authRegistrationService = {
    issueMockVerificationCode: vi.fn(),
    sendRegisterCode: vi.fn(),
    sendLoginCode: vi.fn(),
    registerUser: vi.fn(),
    loginWithPhoneCode: vi.fn(),
  }

  return {
    controller: new AuthController(authService as any, authRegistrationService as any),
    authService,
    authRegistrationService,
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('AuthController', () => {
  it('logs in with password, sets the session cookie, and keeps safe redirects', async () => {
    const { controller, authService } = createController()
    const reply = {}
    const expiresAt = new Date('2026-07-06T08:00:00.000Z')
    const user = { id: 1, role: 'admin', displayName: 'Admin' }

    authService.loginWithPassword.mockResolvedValue({
      token: 'session-token',
      expiresAt,
      user,
    })

    const result = await controller.loginWithPassword(
      { identifier: 'admin@example.com', password: 'secret', next: '/dashboard/users' },
      reply as any,
    )

    expect(authService.loginWithPassword).toHaveBeenCalledWith('admin@example.com', 'secret')
    expect(authService.setSessionCookie).toHaveBeenCalledWith(reply, 'session-token', expiresAt)
    expect(result).toEqual({
      user,
      expiresAt: expiresAt.toISOString(),
      redirectTo: '/dashboard/users',
    })
  })

  it('falls back to email and strips unsafe password redirect targets', async () => {
    const { controller, authService } = createController()
    const reply = {}
    const expiresAt = new Date('2026-07-06T08:00:00.000Z')

    authService.loginWithPassword.mockResolvedValue({
      token: 'session-token',
      expiresAt,
      user: { id: 1, role: 'admin', displayName: 'Admin' },
    })

    const result = await controller.loginWithPassword(
      { email: 'admin@example.com', password: 'secret', next: 'https://malicious.example.com' },
      reply as any,
    )

    expect(authService.loginWithPassword).toHaveBeenCalledWith('admin@example.com', 'secret')
    expect(result.redirectTo).toBe('/')
  })

  it('uses the local mock path when sending registration codes in development', async () => {
    const { controller, authRegistrationService } = createController()
    process.env.NODE_ENV = 'development'
    process.env.DEV_AUTH_CODE = '123456'
    process.env.DEV_AUTH_BYPASS = '0'
    process.env.E2E_AUTH_MOCK = '0'

    const result = await controller.sendRegisterCode({ phone: '13800138000' })

    expect(authRegistrationService.issueMockVerificationCode).toHaveBeenCalledWith('13800138000', 'register', '123456')
    expect(authRegistrationService.sendRegisterCode).not.toHaveBeenCalled()
    expect(result).toEqual({
      message: '本地开发：验证码为 123456，无需真实短信',
      data: {
        resendInSeconds: 60,
        mockCode: '123456',
      },
    })
  })

  it('sends login codes through the registration service outside local mock mode', async () => {
    const { controller, authRegistrationService } = createController()
    process.env.NODE_ENV = 'production'

    const result = await controller.sendLoginCode({ phone: '13800138000' })

    expect(authRegistrationService.sendLoginCode).toHaveBeenCalledWith('13800138000')
    expect(result).toEqual({
      message: '验证码已发送',
      data: {
        resendInSeconds: 60,
      },
    })
  })

  it('registers a user, creates a session, and strips unsafe register redirects', async () => {
    const { controller, authService, authRegistrationService } = createController()
    const reply = {}
    const expiresAt = new Date('2026-07-06T08:00:00.000Z')

    authRegistrationService.registerUser.mockResolvedValue({
      user: {
        id: 9,
        displayName: '创作者',
        phone: '13800138000',
        email: 'creator@example.com',
      },
      organization: {
        id: 11,
        name: '创作者的组织',
      },
    })
    authService.createSessionForUser.mockResolvedValue({
      token: 'session-token',
      expiresAt,
    })

    const result = await controller.register(
      {
        name: '创作者',
        phone: '13800138000',
        smsCode: '123456',
        email: 'creator@example.com',
        password: 'secret',
        next: 'https://malicious.example.com',
      },
      reply as any,
    )

    expect(authRegistrationService.registerUser).toHaveBeenCalledWith(
      {
        displayName: '创作者',
        phone: '13800138000',
        email: 'creator@example.com',
        password: 'secret',
      },
      '123456',
    )
    expect(authService.createSessionForUser).toHaveBeenCalledWith(9)
    expect(authService.setSessionCookie).toHaveBeenCalledWith(reply, 'session-token', expiresAt)
    expect(result.redirectTo).toBe('/')
    expect(result.registered).toBe(true)
    expect(result.organization).toEqual({
      id: 11,
      name: '创作者的组织',
    })
  })

  it('rejects malformed phone verification codes before calling the login service', async () => {
    const { controller, authRegistrationService } = createController()

    await expect(
      controller.loginWithPhoneSession(
        { phone: '13800138000', smsCode: '12345' },
        {} as any,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException)

    expect(authRegistrationService.loginWithPhoneCode).not.toHaveBeenCalled()
  })

  it('wraps phone login failures as unauthorized errors', async () => {
    const { controller, authRegistrationService } = createController()
    process.env.NODE_ENV = 'production'

    authRegistrationService.loginWithPhoneCode.mockRejectedValue(new Error('验证码错误'))

    await expect(
      controller.loginWithPhoneSession(
        { phone: '13800138000', smsCode: '123456', next: '/writing' },
        {} as any,
      ),
    ).rejects.toThrow('验证码错误')
  })

  it('returns the current session or reconstructs a minimal session payload', async () => {
    const { controller } = createController()

    await expect(
      controller.getCurrentSession(
        {
          currentSession: {
            id: 7,
            userId: 3,
            user: { id: 3, role: 'admin', displayName: 'Admin' },
          },
        } as any,
        { id: 3, role: 'admin', displayName: 'Admin' } as any,
      ),
    ).resolves.toEqual({
      authenticated: true,
      session: {
        id: 7,
        userId: 3,
        user: { id: 3, role: 'admin', displayName: 'Admin' },
      },
    })

    await expect(
      controller.getCurrentSession(
        {} as any,
        { id: 5, role: 'super_admin', displayName: 'Boss' } as any,
      ),
    ).resolves.toEqual({
      authenticated: true,
      session: {
        id: 0,
        userId: 5,
        user: { id: 5, role: 'super_admin', displayName: 'Boss' },
      },
    })
  })

  it('logs out and clears the session cookie', async () => {
    const { controller, authService } = createController()
    const reply = {}
    const request = { cookies: { xiaochuang_session: 'token' } }

    const result = await controller.logout(request as any, reply as any)

    expect(authService.logout).toHaveBeenCalledWith(request)
    expect(authService.clearSessionCookie).toHaveBeenCalledWith(reply)
    expect(result).toEqual({ success: true })
  })
})
