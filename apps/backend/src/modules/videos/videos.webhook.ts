import { timingSafeEqual } from 'node:crypto'

const VIDU_WEBHOOK_PATH = '/api/v1/webhooks/vidu'

function normalizeValue(value: string | null | undefined) {
  return String(value || '').trim()
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) return false
  return timingSafeEqual(leftBuffer, rightBuffer)
}

export function readViduWebhookSecret() {
  return normalizeValue(process.env.VIDU_WEBHOOK_SECRET)
}

export function isValidViduWebhookSecret(value: string | null | undefined) {
  const expected = readViduWebhookSecret()
  const actual = normalizeValue(value)
  if (!expected || !actual) return false
  return safeEqual(expected, actual)
}

export function buildViduCallbackUrl() {
  const baseUrl = normalizeValue(process.env.WEBHOOK_BASE_URL)
  const secret = readViduWebhookSecret()
  if (!baseUrl || !secret) return null

  const url = new URL(baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/g, '')}${VIDU_WEBHOOK_PATH}`.replace(/\/{2,}/g, '/')
  url.searchParams.set('token', secret)
  return url.toString()
}

export function requireViduCallbackUrl() {
  const callbackUrl = buildViduCallbackUrl()
  if (!callbackUrl) {
    throw new Error('Vidu requires WEBHOOK_BASE_URL and VIDU_WEBHOOK_SECRET to be configured')
  }
  return callbackUrl
}
