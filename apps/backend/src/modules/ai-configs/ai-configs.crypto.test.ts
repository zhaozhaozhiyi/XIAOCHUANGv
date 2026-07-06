import { afterEach, describe, expect, it } from 'vitest'

import {
  decryptAiConfigSecret,
  encryptAiConfigSecret,
  isEncryptedAiConfigSecret,
  prepareAiConfigSecretForStorage,
} from './ai-configs.crypto'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('ai-config secret crypto', () => {
  it('encrypts and decrypts secrets with an explicit key', () => {
    const encrypted = encryptAiConfigSecret('test-api-key', '0123456789abcdef')

    expect(isEncryptedAiConfigSecret(encrypted)).toBe(true)
    expect(decryptAiConfigSecret(encrypted, '0123456789abcdef')).toBe('test-api-key')
  })

  it('preserves plaintext when the value is not encrypted', () => {
    expect(decryptAiConfigSecret('plain-secret', '0123456789abcdef')).toBe('plain-secret')
  })

  it('uses the non-production fallback key for local writes', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.AI_CONFIG_ENCRYPTION_KEY

    const encrypted = prepareAiConfigSecretForStorage('local-secret')

    expect(isEncryptedAiConfigSecret(encrypted)).toBe(true)
    expect(decryptAiConfigSecret(encrypted)).toBe('local-secret')
  })
})
