/**
 * canvasStore — 画布元数据（v0.2.0 PR1）
 *
 * 包含：id / title / 当前版本 / 保存状态 / 短剧来源
 * 不包含：节点（→ nodesStore）/ 边（→ edgesStore）/ 运行状态（→ runtimeStore）
 *
 * 这是顶栏和列表页的数据源。
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { CanvasViewport } from '@/lib/canvas/types'

export type SaveStatus = 'idle' | 'editing' | 'saving' | 'saved' | 'error'

interface CanvasMetaState {
  // ─── state ───
  canvasId: string | null
  title: string
  currentVersionId: string | null
  saveStatus: SaveStatus
  lastSavedAt: string | null
  sourceDramaId: string | null
  viewport: CanvasViewport

  // ─── actions ───
  reset: () => void
  setMeta: (meta: {
    canvasId: string
    title: string
    currentVersionId: string
    sourceDramaId?: string | null
    viewport?: CanvasViewport
  }) => void
  setTitle: (title: string) => void
  setSaveStatus: (status: SaveStatus, savedAt?: string) => void
  setViewport: (viewport: CanvasViewport) => void
  markEditing: () => void
}

const initial: Pick<
  CanvasMetaState,
  'canvasId' | 'title' | 'currentVersionId' | 'saveStatus' | 'lastSavedAt' | 'sourceDramaId' | 'viewport'
> = {
  canvasId: null,
  title: '未命名画布',
  currentVersionId: null,
  saveStatus: 'idle',
  lastSavedAt: null,
  sourceDramaId: null,
  viewport: { x: 0, y: 0, zoom: 1 },
}

export const useCanvasStore = create<CanvasMetaState>()(
  immer((set) => ({
    ...initial,
    reset: () => set(() => ({ ...initial })),
    setMeta: (meta) =>
      set((s) => {
        s.canvasId = meta.canvasId
        s.title = meta.title
        s.currentVersionId = meta.currentVersionId
        s.sourceDramaId = meta.sourceDramaId ?? null
        if (meta.viewport) s.viewport = meta.viewport
        s.saveStatus = 'saved'
      }),
    setTitle: (title) =>
      set((s) => {
        s.title = title
        s.saveStatus = 'editing'
      }),
    setSaveStatus: (status, savedAt) =>
      set((s) => {
        s.saveStatus = status
        if (savedAt) s.lastSavedAt = savedAt
      }),
    setViewport: (viewport) =>
      set((s) => {
        s.viewport = viewport
      }),
    markEditing: () =>
      set((s) => {
        if (s.saveStatus !== 'saving') s.saveStatus = 'editing'
      }),
  })),
)
