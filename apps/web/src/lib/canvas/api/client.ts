/**
 * 画布 API 客户端 — 薄 fetch 封装（v0.2.0 PR1）
 *
 * 关键约定：
 * - 走与现有 lib/api.ts 相同的 /api/v1/* 前缀（避免和 MSW handler 端点错位）
 * - 统一 envelope { code, message, data } 解包
 * - 网络异常用 friendlyFetchErrorMessage 包装；业务异常抛 CanvasApiError
 * - 不做缓存 / 不做 retry，留给上层 store
 */

import { friendlyFetchErrorMessage } from '@/lib/client-fetch-error'
import type { ApiEnvelope } from '@/lib/canvas/types'

const BASE = '/api/v1'
const GET_RESPONSE_CACHE_TTL_MS = 30_000
const getResponseCache = new Map<string, { expiresAt: number; data: unknown }>()

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

interface RequestOptions {
  signal?: AbortSignal
}

export class CanvasApiError extends Error {
  status?: number
  code?: number
  constructor(message: string, options: { status?: number; code?: number; cause?: unknown } = {}) {
    super(message)
    this.name = 'CanvasApiError'
    this.status = options.status
    this.code = options.code
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause
  }
}

async function request<T>(
  method: Method,
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  const cacheKey = method === 'GET' && !options.signal ? `${method}:${path}` : null
  if (cacheKey) {
    const cached = getResponseCache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T
    }
    if (cached) {
      getResponseCache.delete(cacheKey)
    }
  }

  const headers: Record<string, string> = { Accept: 'application/json' }
  // 仅在确有 body 时才声明 JSON content-type，否则空 body + application/json
  // 会被严格的后端（如 Hono 的 JSON 校验）判为 "Body cannot be empty"。
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  const init: RequestInit = {
    method,
    headers,
    signal: options.signal,
  }
  if (body !== undefined) init.body = JSON.stringify(body)

  let resp: Response
  try {
    resp = await fetch(`${BASE}${path}`, init)
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    throw new CanvasApiError(friendlyFetchErrorMessage(err, `${method} ${path} 网络异常`), { cause: err })
  }

  const text = await resp.text()
  let parsed: ApiEnvelope<T> | { code?: number; message?: string }
  try {
    parsed = text ? JSON.parse(text) : ({} as ApiEnvelope<T>)
  } catch {
    throw new CanvasApiError(`${method} ${path} 返回了非法 JSON (HTTP ${resp.status})`, {
      status: resp.status,
    })
  }

  const envCode = (parsed as { code?: number }).code
  if (!resp.ok || (envCode !== undefined && envCode !== 0)) {
    const msg = (parsed as { message?: string })?.message || `${method} ${path} 失败 (HTTP ${resp.status})`
    throw new CanvasApiError(msg, { status: resp.status, code: envCode })
  }

  const data = (parsed as ApiEnvelope<T>).data
  if (cacheKey) {
    getResponseCache.set(cacheKey, {
      data,
      expiresAt: Date.now() + GET_RESPONSE_CACHE_TTL_MS,
    })
  } else if (method !== 'GET') {
    getResponseCache.clear()
  }
  return data
}

export const canvasClient = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, undefined, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('POST', path, body, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>('PATCH', path, body, options),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>('DELETE', path, undefined, options),
  raw: async (path: string, init: RequestInit = {}) => {
    const resp = await fetch(`${BASE}${path}`, init)
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new CanvasApiError(text || `${path} 失败 (HTTP ${resp.status})`, { status: resp.status })
    }
    return resp
  },
}
