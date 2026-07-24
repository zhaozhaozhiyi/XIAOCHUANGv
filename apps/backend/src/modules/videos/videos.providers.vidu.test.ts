import { afterEach, describe, expect, it } from 'vitest'

import { ViduVideoAdapter } from './videos.providers.vidu'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('ViduVideoAdapter', () => {
  it('includes callback_url when webhook env is configured', () => {
    process.env.WEBHOOK_BASE_URL = 'https://backend.example.com'
    process.env.VIDU_WEBHOOK_SECRET = '1234567890abcdef'

    const adapter = new ViduVideoAdapter()
    const request = adapter.buildGenerateRequest(
      {
        provider: 'vidu',
        baseUrl: 'https://api.vidu.example.com',
        apiKey: 'test-key',
        model: 'vidu-q1',
      },
      {
        id: 1,
        prompt: 'move camera up',
        referenceMode: 'single',
        imageUrl: 'https://example.com/reference.png',
      },
    )

    expect(request.body.callback_url).toBe(
      'https://backend.example.com/api/v1/webhooks/vidu?token=1234567890abcdef',
    )
    expect(request.body.images).toEqual(['https://example.com/reference.png'])
  })

  it('fails fast when webhook env is missing', () => {
    delete process.env.WEBHOOK_BASE_URL
    delete process.env.VIDU_WEBHOOK_SECRET

    const adapter = new ViduVideoAdapter()

    expect(() =>
      adapter.buildGenerateRequest(
        {
          provider: 'vidu',
          baseUrl: 'https://api.vidu.example.com',
          apiKey: 'test-key',
          model: 'vidu-q1',
        },
        {
          id: 1,
          prompt: 'move camera up',
        },
      ),
    ).toThrow(/WEBHOOK_BASE_URL and VIDU_WEBHOOK_SECRET/)
  })
})
