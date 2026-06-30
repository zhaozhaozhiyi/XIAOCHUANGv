'use client'

import {
  agentConfigAPI,
  aiConfigAPI,
  assetAPI,
  dramaAPI,
  skillsAPI,
  taskAPI,
  writingAPI,
} from '@/lib/api'
import { canvasApi } from '@/lib/canvas/api/canvas'

const WARM_TTL_MS = 30_000
const warmedAt = new Map<string, number>()

function oncePerWindow(key: string, run: () => Promise<unknown>[]) {
  const now = Date.now()
  const last = warmedAt.get(key) || 0
  if (now - last < WARM_TTL_MS) return
  warmedAt.set(key, now)
  void Promise.allSettled(run()).then((results) => {
    if (results.every((result) => result.status === 'rejected')) {
      warmedAt.delete(key)
    }
  })
}

export function prefetchNavData(href: string) {
  const path = href.split('?')[0]

  if (path === '/drama') {
    oncePerWindow(path, () => [
      dramaAPI.list({ include_details: false }, { redirectOnUnauthorized: false }),
    ])
    return
  }

  if (path === '/canvas') {
    oncePerWindow(path, () => [
      canvasApi.list(),
    ])
    return
  }

  if (path === '/writing') {
    oncePerWindow(path, () => [
      writingAPI.list({ page: 1, page_size: 50, sort: 'updated_at' }),
    ])
    return
  }

  if (path === '/assets') {
    oncePerWindow(path, () => [
      assetAPI.list(),
      dramaAPI.list({ include_details: false }),
    ])
    return
  }

  if (path === '/my') {
    oncePerWindow(path, () => [
      dramaAPI.stats(),
      taskAPI.list({ page_size: 20, sort: 'updated_at' }),
    ])
    return
  }

  if (path === '/settings') {
    oncePerWindow(path, () => [
      aiConfigAPI.list(),
      agentConfigAPI.list(),
      skillsAPI.list(),
    ])
  }
}
