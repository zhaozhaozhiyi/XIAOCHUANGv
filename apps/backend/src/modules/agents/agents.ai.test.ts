import { describe, expect, it } from 'vitest'

import type { AIConfig } from '../ai-configs/ai-configs.resolver'
import { withTextProviderRequestOptions } from './agents.ai'

function textConfig(overrides: Partial<AIConfig>): AIConfig {
  return {
    id: 1,
    userId: 1,
    serviceType: 'text',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: 'test-key',
    model: 'deepseek-v4-flash',
    modelList: ['deepseek-v4-flash'],
    settings: {},
    ...overrides,
  }
}

describe('withTextProviderRequestOptions', () => {
  it('disables DeepSeek V4 thinking mode for plain text requests', () => {
    const body = withTextProviderRequestOptions(textConfig({}), {
      model: 'deepseek-v4-flash',
      messages: [{ role: 'user', content: 'ping' }],
    })

    expect(body).toMatchObject({
      thinking: { type: 'disabled' },
    })
  })

  it('keeps explicit thinking settings', () => {
    const body = withTextProviderRequestOptions(textConfig({}), {
      model: 'deepseek-v4-pro',
      thinking: { type: 'enabled' },
    })

    expect(body.thinking).toEqual({ type: 'enabled' })
  })

  it('does not modify other providers', () => {
    const body = withTextProviderRequestOptions(
      textConfig({ provider: 'moonshot', model: 'moonshot-v1-8k' }),
      { model: 'moonshot-v1-8k' },
    )

    expect(body).toEqual({ model: 'moonshot-v1-8k' })
  })
})
