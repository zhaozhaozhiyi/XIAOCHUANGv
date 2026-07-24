import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { WebhooksController } from './webhooks.controller'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('WebhooksController', () => {
  it('rejects callbacks when the webhook secret is missing', async () => {
    delete process.env.VIDU_WEBHOOK_SECRET
    const controller = new WebhooksController({ handleViduWebhook: vi.fn() } as any)

    await expect(controller.handleWebhook('vidu', { task_id: '123' })).rejects.toBeInstanceOf(ServiceUnavailableException)
  })

  it('rejects callbacks with an invalid token', async () => {
    process.env.VIDU_WEBHOOK_SECRET = '1234567890abcdef'
    const controller = new WebhooksController({ handleViduWebhook: vi.fn() } as any)

    await expect(controller.handleWebhook('vidu', { task_id: '123' }, 'wrong-token')).rejects.toBeInstanceOf(ForbiddenException)
  })

  it('forwards callbacks when the token is valid', async () => {
    process.env.VIDU_WEBHOOK_SECRET = '1234567890abcdef'
    const handleViduWebhook = vi.fn(async () => ({ message: 'ok' }))
    const controller = new WebhooksController({ handleViduWebhook } as any)
    const body = { task_id: '123', status: 'success' }

    await expect(controller.handleWebhook('vidu', body, '1234567890abcdef')).resolves.toEqual({ message: 'ok' })
    expect(handleViduWebhook).toHaveBeenCalledWith(body)
  })
})
