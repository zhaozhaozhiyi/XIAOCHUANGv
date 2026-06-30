import type { APIRequestContext } from '@playwright/test'
import { expect } from '@playwright/test'

type ApiEnvelope<T> = { code?: number; message?: string; data?: T }

export async function apiJson<T>(request: APIRequestContext, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const init: Parameters<APIRequestContext['fetch']>[1] = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) init.data = body
  const res = await request.fetch(path, init)
  const text = await res.text()
  let json: ApiEnvelope<T> | T
  try {
    json = JSON.parse(text) as ApiEnvelope<T> | T
  } catch {
    throw new Error(`Invalid JSON from ${path}: ${text.slice(0, 200)}`)
  }
  expect(res.ok(), `${method} ${path} -> ${res.status()}: ${text.slice(0, 300)}`).toBeTruthy()
  if (json && typeof json === 'object' && 'code' in json && typeof (json as ApiEnvelope<T>).code === 'number') {
    const e = json as ApiEnvelope<T>
    expect(e.code, `API error ${path}: ${e.message}`).toBeLessThan(400)
    if (e.data !== undefined) return e.data as T
  }
  return json as T
}

export type DramaRow = {
  id: number
  title: string
  episodes?: { id: number; episode_number: number; title?: string }[]
}

export async function listEpisodeStoryboards(request: APIRequestContext, episodeId: number): Promise<unknown[]> {
  const data = await apiJson<unknown[]>(request, 'GET', `/api/v1/episodes/${episodeId}/storyboards`)
  return Array.isArray(data) ? data : []
}

export async function listDramas(request: APIRequestContext): Promise<DramaRow[]> {
  const data = await apiJson<{ items: DramaRow[] }>(request, 'GET', '/api/v1/dramas')
  return data.items || []
}
