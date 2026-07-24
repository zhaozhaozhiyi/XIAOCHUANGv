import { afterEach, describe, expect, it } from 'vitest'

import {
  buildDevPhoneCodeResponse,
  getDevAuthCode,
  isLocalAuthBypassEnabled,
  isLocalAuthCodeMockEnabled,
} from './auth-dev'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('auth-dev flags', () => {
  it('enables local auth code mock from DEV_AUTH_CODE without enabling bypass user mode', () => {
    process.env.NODE_ENV = 'development'
    process.env.DEV_AUTH_BYPASS = '0'
    process.env.E2E_AUTH_MOCK = '0'
    process.env.DEV_AUTH_CODE = '123456'

    expect(isLocalAuthCodeMockEnabled()).toBe(true)
    expect(isLocalAuthBypassEnabled()).toBe(false)
  })

  it('disables local auth helpers in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.DEV_AUTH_BYPASS = '1'
    process.env.E2E_AUTH_MOCK = '1'
    process.env.DEV_AUTH_CODE = '123456'

    expect(isLocalAuthCodeMockEnabled()).toBe(false)
    expect(isLocalAuthBypassEnabled()).toBe(false)
  })

  it('returns the local mock code payload when a valid dev code is configured', () => {
    process.env.NODE_ENV = 'development'
    process.env.DEV_AUTH_CODE = '654321'

    expect(getDevAuthCode()).toBe('654321')
    expect(buildDevPhoneCodeResponse()).toEqual({
      message: '本地开发：验证码为 654321，无需真实短信',
      data: {
        resendInSeconds: 60,
        mockCode: '654321',
      },
    })
  })

  it('throws when local auth mock is enabled without a valid 6-digit code', () => {
    process.env.NODE_ENV = 'development'
    process.env.DEV_AUTH_BYPASS = '1'
    process.env.DEV_AUTH_CODE = 'abc'

    expect(() => getDevAuthCode()).toThrow(/DEV_AUTH_CODE must be a 6-digit code/)
  })
})
