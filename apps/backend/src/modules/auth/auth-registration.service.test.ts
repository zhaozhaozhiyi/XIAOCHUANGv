import { afterEach, describe, expect, it, vi } from 'vitest'

import { AuthRegistrationService } from './auth-registration.service'

vi.mock('./auth-sms', () => ({
  sendVerificationSms: vi.fn(async () => undefined),
}))

type SelectResult = unknown[]

function createDbMock(selectResults: SelectResult[]) {
  const insertedValues: unknown[] = []
  const updatedValues: unknown[] = []

  const db = {
    select: vi.fn(() => {
      const result = selectResults.shift() ?? []
      const chain: any = {}
      chain.from = vi.fn(() => chain)
      chain.where = vi.fn(() => chain)
      chain.orderBy = vi.fn(() => chain)
      chain.limit = vi.fn(async () => result)
      return chain
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: unknown) => {
        insertedValues.push(values)
      }),
    })),
    update: vi.fn(() => {
      const updateChain: any = {}
      updateChain.set = vi.fn((values: unknown) => {
        updatedValues.push(values)
        return updateChain
      })
      updateChain.where = vi.fn(async () => undefined)
      return updateChain
    }),
  }

  return { db, insertedValues, updatedValues }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('AuthRegistrationService', () => {
  it('rejects verification code resends inside the cooldown window', async () => {
    const dbMock = createDbMock([
      [],
      [{ id: 1, createdAt: new Date() }],
    ])
    const service = new AuthRegistrationService(dbMock as any)

    await expect(service.sendRegisterCode('13800138000')).rejects.toThrow('验证码发送过于频繁')
    expect(dbMock.insertedValues).toHaveLength(0)
  })

  it('rejects verification code sends after the hourly limit', async () => {
    const dbMock = createDbMock([
      [],
      [],
      [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
    ])
    const service = new AuthRegistrationService(dbMock as any)

    await expect(service.sendRegisterCode('13800138000')).rejects.toThrow('验证码发送次数过多')
    expect(dbMock.insertedValues).toHaveLength(0)
  })

  it('counts failed verification attempts and locks the code after the limit', async () => {
    const dbMock = createDbMock([
      [{
        id: 7,
        phone: '13800138000',
        purpose: 'login',
        code: '123456',
        attemptCount: 4,
        usedAt: null,
      }],
    ])
    const service = new AuthRegistrationService(dbMock as any)

    await expect(service.loginWithPhoneCode('13800138000', '000000')).rejects.toThrow('验证码尝试次数过多')
    expect(dbMock.updatedValues[0]).toMatchObject({
      attemptCount: 5,
      usedAt: expect.any(Date),
    })
  })
})
