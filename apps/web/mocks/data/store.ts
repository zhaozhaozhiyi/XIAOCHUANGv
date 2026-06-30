/**
 * MSW mock 数据存储 — 浏览器内存 Map + localStorage 持久化
 *
 * 设计要点：
 * - 启动时从 localStorage 读取，失败则种 SEED_CANVASES
 * - 所有写操作触发 debounce 200ms 落盘
 * - key 用 'xc-canvas-mock-v1'，schema 变更时 bump 版本号
 */

import type { CanvasDetail } from '@/lib/canvas/types'
import { SEED_CANVASES } from './seed'

// v4：当前 seed 仅保留全局灵感板 + 演示画布
const STORAGE_KEY = 'xc-canvas-mock-v4'

interface MockSnapshot {
  version: 4
  canvases: CanvasDetail[]
  /** 软删除回收站（v0.2.0 不实现 30 天恢复，仅记录） */
  trash: CanvasDetail[]
}

let memory: MockSnapshot | null = null
let saveTimer: number | null = null

function readFromStorage(): MockSnapshot | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as MockSnapshot
    if (parsed.version !== 4 || !Array.isArray(parsed.canvases)) return null
    return parsed
  } catch {
    return null
  }
}

function writeToStorage(snapshot: MockSnapshot) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch (err) {
    // 通常是 QuotaExceededError；先静默
    console.warn('[mock] localStorage write failed:', err)
  }
}

function ensureMemory(): MockSnapshot {
  if (memory) return memory
  const restored = readFromStorage()
  if (restored) {
    memory = restored
  } else {
    memory = {
      version: 4,
      canvases: SEED_CANVASES.map(c => JSON.parse(JSON.stringify(c)) as CanvasDetail),
      trash: [],
    }
    writeToStorage(memory)
  }
  return memory
}

function scheduleSave() {
  if (typeof window === 'undefined') return
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    if (memory) writeToStorage(memory)
    saveTimer = null
  }, 200)
}

// ─── 对外 API ────────────────────────────────────────────────────────────────

export function listCanvases(): CanvasDetail[] {
  const snap = ensureMemory()
  // 全局灵感板始终置顶；其余按 updated_at 倒序
  return [...snap.canvases].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
    return b.updated_at.localeCompare(a.updated_at)
  })
}

export function getCanvas(id: string): CanvasDetail | null {
  const snap = ensureMemory()
  return snap.canvases.find(c => c.id === id) ?? null
}

export function createCanvas(canvas: CanvasDetail): CanvasDetail {
  const snap = ensureMemory()
  snap.canvases.push(canvas)
  scheduleSave()
  return canvas
}

export function updateCanvas(id: string, patch: Partial<CanvasDetail>): CanvasDetail | null {
  const snap = ensureMemory()
  const idx = snap.canvases.findIndex(c => c.id === id)
  if (idx < 0) return null
  const next: CanvasDetail = {
    ...snap.canvases[idx],
    ...patch,
    id: snap.canvases[idx].id, // 不允许覆写 id
    updated_at: new Date().toISOString(),
  }
  snap.canvases[idx] = next
  scheduleSave()
  return next
}

export function deleteCanvas(id: string): boolean {
  const snap = ensureMemory()
  const idx = snap.canvases.findIndex(c => c.id === id)
  if (idx < 0) return false
  // 全局灵感板不可删
  if (snap.canvases[idx].source === 'global-inspiration') return false
  const [removed] = snap.canvases.splice(idx, 1)
  snap.trash.push(removed)
  scheduleSave()
  return true
}

export function duplicateCanvas(id: string): CanvasDetail | null {
  const snap = ensureMemory()
  const src = snap.canvases.find(c => c.id === id)
  if (!src) return null
  const copy: CanvasDetail = JSON.parse(JSON.stringify(src))
  copy.id = `cnv_${cryptoRandomId()}`
  copy.title = `${src.title} · 副本`
  copy.is_pinned = false
  copy.source = 'blank'
  copy.created_at = new Date().toISOString()
  copy.updated_at = copy.created_at
  copy.current_version_id = `ver_${cryptoRandomId()}`
  snap.canvases.push(copy)
  scheduleSave()
  return copy
}

/** 整画布保存（节点 + 边 + 视口，3s 防抖触发） */
export function saveCanvasGraph(
  id: string,
  payload: { nodes: CanvasDetail['nodes']; edges: CanvasDetail['edges']; viewport: CanvasDetail['viewport'] },
): CanvasDetail | null {
  return updateCanvas(id, payload)
}

/** 重置 mock 数据（仅开发用，回归 seed） */
export function resetMock(): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(STORAGE_KEY)
  }
  memory = null
}

/** crypto.randomUUID 的兼容封装（旧浏览器 fallback） */
export function cryptoRandomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 12)
  }
  return Math.random().toString(36).slice(2, 14)
}
