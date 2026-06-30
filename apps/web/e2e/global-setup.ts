import type { FullConfig } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT || 3001)
const BASE = `http://127.0.0.1:${PORT}`
const PHONE = process.env.E2E_CONSUMER_PHONE || '18811103664'
const SMS_CODE = process.env.DEV_AUTH_CODE || '123456'
const TIMEOUT_MS = Number(process.env.E2E_WARMUP_TIMEOUT_MS || 120_000)

async function waitForReady() {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/login`, { redirect: 'manual' })
      if (response.status > 0) return
    } catch {
      // keep waiting while the dev server starts
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`[e2e:warmup] Timed out waiting for ${BASE}/login`)
}

function cookieFrom(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  const setCookies = headers.getSetCookie?.() || []
  const raw = setCookies[0] || response.headers.get('set-cookie') || ''
  return raw.split(';')[0]
}

async function jsonFetch<T>(path: string, init?: RequestInit & { cookie?: string }) {
  const headers = new Headers(init?.headers)
  if (!headers.has('content-type') && init?.body) headers.set('content-type', 'application/json')
  if (init?.cookie) headers.set('cookie', init.cookie)

  const response = await fetch(`${BASE}${path}`, { ...init, headers })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(`[e2e:warmup] ${init?.method || 'GET'} ${path} -> ${response.status}: ${JSON.stringify(payload).slice(0, 300)}`)
  }
  return { response, payload: payload as T }
}

async function login() {
  await jsonFetch('/api/v1/auth/login/phone-code', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE }),
  })

  const { response } = await jsonFetch('/api/v1/auth/login/phone-session', {
    method: 'POST',
    body: JSON.stringify({ phone: PHONE, smsCode: SMS_CODE, next: '/writing' }),
  })

  const cookie = cookieFrom(response)
  if (!cookie) throw new Error('[e2e:warmup] Login did not return a session cookie')
  return cookie
}

function dataFrom<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

async function createWorkbenchDrama(cookie: string) {
  const title = `e2e-warmup-${Date.now()}`
  const created = await jsonFetch('/api/v1/dramas', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ title, total_episodes: 1, style: 'realistic' }),
  })
  const drama = dataFrom<{ id?: number }>(created.payload)
  const dramaId = Number(drama?.id)
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    throw new Error(`[e2e:warmup] Invalid drama id from create response: ${JSON.stringify(created.payload).slice(0, 300)}`)
  }

  await jsonFetch(`/api/v1/dramas/${dramaId}/split-episodes`, {
    method: 'POST',
    cookie,
    body: JSON.stringify({
      content: '第1集\nE2E warmup 内容。\n林砚走进旧物铺，雨声贴着窗沿落下。',
      replace_existing: true,
    }),
  })

  return dramaId
}

async function warm(path: string, cookie?: string) {
  const start = Date.now()
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  const response = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' })
  const elapsedMs = Date.now() - start
  console.log(`[e2e:warmup] ${response.status} ${elapsedMs}ms ${path}`)
  return response
}

export default async function globalSetup(_config: FullConfig) {
  if (process.env.E2E_SKIP_WARMUP === '1') return

  await waitForReady()
  const cookie = await login()
  const dramaId = await createWorkbenchDrama(cookie)

  await warm('/writing', cookie)
  await warm('/assets', cookie)
  await warm('/settings', cookie)
  await warm(`/drama/${dramaId}/episode/1`, cookie)
}
