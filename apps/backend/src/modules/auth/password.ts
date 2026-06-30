import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const KEY_LENGTH = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const derivedKey = scryptSync(password, salt, KEY_LENGTH).toString('hex')
  return `${salt}:${derivedKey}`
}

export function verifyPassword(password: string, hash: string): boolean {
  const [salt, key] = hash.split(':')
  if (!salt || !key) return false

  const derivedKey = scryptSync(password, salt, KEY_LENGTH)
  const storedKey = Buffer.from(key, 'hex')

  if (derivedKey.length !== storedKey.length) {
    return false
  }

  return timingSafeEqual(derivedKey, storedKey)
}

export function generateSessionToken() {
  return randomBytes(32).toString('hex')
}

export function generateRandomCode(length: number = 6): string {
  const digits = '0123456789'
  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += digits[Math.floor(Math.random() * digits.length)]
  }
  return code
}
