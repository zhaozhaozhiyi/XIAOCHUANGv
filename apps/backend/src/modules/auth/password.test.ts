import { describe, expect, it } from 'vitest'

import { generateRandomCode, generateSessionToken, hashPassword, verifyPassword } from './password'

describe('password helpers', () => {
  it('hashes and verifies passwords', () => {
    const hash = hashPassword('secret-pass')

    expect(hash).toContain(':')
    expect(verifyPassword('secret-pass', hash)).toBe(true)
    expect(verifyPassword('wrong-pass', hash)).toBe(false)
  })

  it('returns false for malformed password hashes', () => {
    expect(verifyPassword('secret-pass', 'malformed')).toBe(false)
  })

  it('generates a 64-character session token', () => {
    const token = generateSessionToken()

    expect(token).toMatch(/^[a-f0-9]{64}$/)
  })

  it('generates numeric codes with the requested length', () => {
    const singleDigitCode = generateRandomCode(1)
    const sixDigitCode = generateRandomCode()

    expect(singleDigitCode).toMatch(/^\d$/)
    expect(sixDigitCode).toMatch(/^\d{6}$/)
  })

  it('rejects invalid code lengths', () => {
    expect(() => generateRandomCode(0)).toThrow(/length must be a positive integer/)
    expect(() => generateRandomCode(1.5)).toThrow(/length must be a positive integer/)
  })
})
