import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import { normalizeAuthSession, type RawAuthSessionPayload } from '@/lib/auth-session'
import type { AuthSession, CurrentUser } from '@/types/auth'

const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:3010'
const SESSION_COOKIE_NAME = 'xiaochuang_session'

type BackendPayload = {
  error?: string
  message?: string
  details?: unknown
  code?: number
  data?: unknown
}

function isBackendEnvelope(payload: BackendPayload): payload is BackendPayload & { code: number; data: unknown } {
  return typeof payload.code === 'number' && 'data' in payload && typeof payload.message === 'string'
}

export function getBackendBaseUrl() {
  return process.env.BACKEND_BASE_URL || DEFAULT_BACKEND_BASE_URL
}

function joinUrl(base: string, path: string) {
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizedBase}${normalizedPath}`
}

async function resolveCookieHeader(explicitCookie?: string | null) {
  if (explicitCookie) return explicitCookie

  const cookieStore = await cookies()
  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value
  if (sessionToken) {
    return `${SESSION_COOKIE_NAME}=${sessionToken}`
  }

  const headerStore = await headers()
  return headerStore.get('cookie') || ''
}

export async function backendFetch(path: string, init?: RequestInit & { cookie?: string | null }) {
  const requestHeaders = new Headers(init?.headers)
  const cookieHeader = await resolveCookieHeader(init?.cookie)

  if (cookieHeader && !requestHeaders.has('cookie')) {
    requestHeaders.set('cookie', cookieHeader)
  }

  if (!requestHeaders.has('accept')) {
    requestHeaders.set('accept', 'application/json')
  }

  return fetch(joinUrl(getBackendBaseUrl(), path), {
    ...init,
    headers: requestHeaders,
    cache: init?.cache ?? 'no-store',
  })
}

function ok<T>(data: T, init?: ResponseInit) {
  return Response.json(
    { code: 0, message: 'ok', data },
    { status: 200, ...init },
  )
}

function fail(message: string, code = 400, details?: unknown, init?: ResponseInit) {
  return Response.json(
    { code, message, details },
    { ...init, status: init?.status ?? code },
  )
}

export async function wrapBackendJson(response: Response, fallbackMessage = '请求失败') {
  const rawPayload = await response.json().catch(() => ({}))
  const payload = (rawPayload && typeof rawPayload === 'object' ? rawPayload : null) as BackendPayload | null

  if (response.ok && !payload?.error) {
    if (payload && isBackendEnvelope(payload)) {
      return Response.json(payload, { status: response.status })
    }
    return ok(rawPayload ?? null, { status: response.status })
  }

  const message = payload?.message || payload?.error || fallbackMessage
  const status = response.ok ? 400 : response.status
  return fail(message, status, payload?.details ?? payload ?? rawPayload, { status })
}

export function copySetCookieHeader(source: Response, target: Response) {
  const setCookie = source.headers.get('set-cookie')
  if (setCookie) {
    target.headers.set('set-cookie', setCookie)
  }
  return target
}

export async function buildBackendProxyInit(request: Request): Promise<RequestInit> {
  const method = request.method.toUpperCase()
  const contentType = request.headers.get('content-type') || ''
  const headers = new Headers()

  let body: BodyInit | undefined
  if (!['GET', 'HEAD'].includes(method)) {
    if (contentType.includes('multipart/form-data')) {
      body = await request.formData()
    } else {
      body = await request.text()
      if (contentType) {
        headers.set('Content-Type', contentType)
      }
    }
  }

  return {
    method,
    headers,
    body,
  }
}

const getCurrentAuthSessionCached = cache(async (): Promise<AuthSession | null> => {
  try {
    const cookieHeader = await resolveCookieHeader()
    if (!cookieHeader || !cookieHeader.includes(`${SESSION_COOKIE_NAME}=`)) {
      return null
    }

    const response = await backendFetch('/api/v1/auth/session', { cookie: cookieHeader })
    if (!response.ok) {
      return null
    }

    const payload = (await response.json()) as RawAuthSessionPayload
    return normalizeAuthSession(payload)
  } catch {
    return null
  }
})

export async function getCurrentAuthSession(): Promise<AuthSession | null> {
  return getCurrentAuthSessionCached()
}

export async function hasSessionCookie() {
  const cookieHeader = await resolveCookieHeader()
  return Boolean(cookieHeader && cookieHeader.includes(`${SESSION_COOKIE_NAME}=`))
}

/**
 * 开发期短路：当 NODE_ENV !== 'production' 且 DEV_AUTH_BYPASS=1 时，
 * 跳过 backend /api/v1/auth/session 调用，返回一个 mock user。
 *
 * 动机：画布 PR1 验收只跑前端 + MSW，无需 backend；但 (protected) layout
 * 在 server side 守卫登录，会因 backend 未起而抛 UNAUTHORIZED → 500。
 *
 * 生产环境（NODE_ENV=production）无论 env 怎么设都不生效，避免误开。
 */
function getDevBypassUser(): CurrentUser | null {
  if (process.env.NODE_ENV === 'production') return null
  if (process.env.DEV_AUTH_BYPASS !== '1') return null
  return {
    id: 1,
    admin_user_id: null,
    account_type: 'user',
    role: 'user',
    display_name: process.env.DEV_AUTH_DISPLAY_NAME || '本地开发用户',
    email: null,
    phone: process.env.DEV_AUTH_PHONE || '13800138000',
    status: 'active',
  }
}

export async function getCurrentUserOptional(): Promise<CurrentUser | null> {
  const bypass = getDevBypassUser()
  if (bypass) return bypass
  const session = await getCurrentAuthSession()
  return session?.user ?? null
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUserOptional()
  if (!user) {
    throw new Error('UNAUTHORIZED')
  }
  return user
}

export const requirePageSession = cache(async (): Promise<CurrentUser> => {
  const user = await getCurrentUserOptional()
  if (!user) {
    const headerStore = await headers()
    const pathname = headerStore.get('x-pathname') || headerStore.get('x-invoke-path') || ''
    const loginUrl = pathname ? `/login?next=${encodeURIComponent(pathname)}` : '/login'
    redirect(loginUrl)
  }
  return user
})
