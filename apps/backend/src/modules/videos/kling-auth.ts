import { createHmac } from 'node:crypto'

function base64UrlEncode(value: string | Buffer) {
  return Buffer.from(value).toString('base64url')
}

export function signKlingJwt(accessKey: string, secretKey: string, expireSeconds = 1800) {
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    iss: accessKey,
    exp: now + expireSeconds,
    nbf: now - 5,
  }))
  const unsigned = `${header}.${payload}`
  const signature = createHmac('sha256', secretKey).update(unsigned).digest('base64url')
  return `${unsigned}.${signature}`
}

export function klingAuthHeaders(accessKey: string, secretKey: string) {
  return {
    Authorization: `Bearer ${signKlingJwt(accessKey, secretKey)}`,
    'Content-Type': 'application/json',
  }
}

export function readKlingSecretKey(settings?: Record<string, unknown>) {
  return String(settings?.secretKey || settings?.secret_key || process.env.KLING_SECRET_KEY || '').trim()
}
