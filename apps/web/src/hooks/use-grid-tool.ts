import { create } from 'zustand'
import { toast } from 'sonner'
import { gridAPI, imageAPI } from '@/lib/api'
import { fetchSSE } from '@/lib/sse'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

export interface GridAssignment {
  storyboard_id: number | null
  frame_type: 'first_frame' | 'last_frame' | 'reference'
}

export interface GridHistoryItem {
  id: number
  imagePath: string
  layout: { rows: number; cols: number }
  modeLabel: string
  createdAtLabel: string
}

interface GridCellPrompt {
  shot_number?: number
  frame_type?: string
  prompt?: string
}

interface GridToolState {
  open: boolean
  step: number
  mode: 'first_frame' | 'first_last' | 'multi_ref'
  layout: string
  selected: number[]
  singleTarget: number | null
  genId: number | null
  imagePath: string
  statusText: string
  actualLayout: { rows: number; cols: number }
  promptText: string
  cellPrompts: GridCellPrompt[]
  promptSource: string
  promptLoading: boolean
  promptStatus: string
  assignments: GridAssignment[]
  activeShotIds: number[]
  history: GridHistoryItem[]
  showAllHistory: boolean
  activeCell: number
  assignmentPage: number
  storageKey: string
  // Actions
  setOpen: (v: boolean) => void
  openFresh: (storyboardIds: number[], dramaId: number, episodeId: number) => void
  reopenPreview: () => void
  setMode: (m: 'first_frame' | 'first_last' | 'multi_ref') => void
  setLayout: (l: string) => void
  toggleSelected: (id: number, allIds: number[]) => void
  selectAll: (ids: number[]) => void
  setSingleTarget: (id: number | null) => void
  generatePrompt: (dramaId: number, episodeId: number) => Promise<void>
  startGeneration: (dramaId: number) => Promise<void>
  doSplit: (dramaId: number, episodeId: number, onDone: () => void) => Promise<void>
  updateAssignment: (index: number, field: keyof GridAssignment, value: unknown) => void
  focusCell: (index: number) => void
  setAssignmentPage: (p: number) => void
  selectHistory: (item: GridHistoryItem) => void
  loadHistory: (dramaId: number) => Promise<void>
  setStorageKey: (key: string) => void
  setShowAllHistory: (v: boolean) => void
  persistState: (imagePath: string) => void
}

interface StorageEntry {
  generationId?: number | null
  layout?: { rows: number; cols: number }
  shotIds?: number[]
  assignments?: GridAssignment[]
  recoveredAt?: string
  recoveredMode?: string
}

interface StorageData {
  activeImagePath?: string
  entries?: Record<string, StorageEntry>
}

const DEFAULT_LAYOUT = { rows: 3, cols: 3 }

function parseLayout(layout: string): { rows: number; cols: number } {
  const parts = String(layout || '3x3').split('x').map(Number)
  return { rows: parts[0] || 3, cols: parts[1] || 3 }
}

function parseGridLayoutFromFrameType(value: string): { rows: number; cols: number } | null {
  const match = String(value || '').match(/grid_[^_]+_(\d+)x(\d+)$/)
  if (!match) return null
  return { rows: Number(match[1]) || 3, cols: Number(match[2]) || 3 }
}

function createAssignments(rows: number, cols: number): GridAssignment[] {
  return Array.from({ length: rows * cols }, () => ({ storyboard_id: null, frame_type: 'first_frame' }))
}

export const useGridTool = create<GridToolState>((set, get) => ({
  open: false,
  step: 0,
  mode: 'first_frame',
  layout: '3x3',
  selected: [],
  singleTarget: null,
  genId: null,
  imagePath: '',
  statusText: '',
  actualLayout: DEFAULT_LAYOUT,
  promptText: '',
  cellPrompts: [],
  promptSource: '',
  promptLoading: false,
  promptStatus: '',
  assignments: [],
  activeShotIds: [],
  history: [],
  showAllHistory: false,
  activeCell: 0,
  assignmentPage: 0,
  storageKey: '',

  setOpen: (v) => set({ open: v }),

  openFresh: (_storyboardIds, _dramaId, _episodeId) => {
    set({
      open: true,
      step: 0,
      selected: [],
      singleTarget: null,
      activeShotIds: [],
      promptText: '',
      cellPrompts: [],
      promptSource: '',
      promptStatus: '',
      assignments: [],
    })
  },

  reopenPreview: () => {
    const { imagePath, assignments, actualLayout } = get()
    if (!imagePath) {
      get().openFresh([], 0, 0)
      return
    }
    const newAssignments = assignments.length
      ? assignments
      : createAssignments(actualLayout.rows, actualLayout.cols)
    set({ open: true, step: 3, assignments: newAssignments })
  },

  setMode: (m) => set({ mode: m }),
  setLayout: (l) => set({ layout: l }),

  toggleSelected: (id, _allIds) => {
    const { selected } = get()
    const next = selected.includes(id) ? selected.filter(s => s !== id) : [...selected, id]
    set({ selected: next })
  },

  selectAll: (ids) => {
    const { selected } = get()
    set({ selected: selected.length === ids.length ? [] : [...ids] })
  },

  setSingleTarget: (id) => set({ singleTarget: id }),

  generatePrompt: async (dramaId, episodeId) => {
    const { mode, selected, singleTarget, layout } = get()
    const canStart = mode === 'multi_ref' ? !!singleTarget : selected.length > 0
    if (!canStart) {
      toast.warning('请先选择镜头')
      return
    }
    set({ promptLoading: true, promptStatus: '正在调用 AI 生成宫格提示词...', promptText: '', cellPrompts: [] })
    try {
      const shotIds = mode === 'multi_ref'
        ? (singleTarget ? [singleTarget] : [])
        : [...selected]
      const { rows, cols } = parseLayout(layout)
      let hasDonePayload = false
      let result: { grid_prompt?: string; cell_prompts?: GridCellPrompt[]; source?: string } = {}
      await fetchSSE({
        url: '/api/v1/ai/runs?stream=1',
        method: 'POST',
        body: {
          message: '生成宫格提示词',
          storyboard_ids: shotIds,
          drama_id: dramaId,
          episode_id: episodeId,
          rows,
          cols,
          mode,
        },
        onEvent: (evt) => {
          if (!evt.data) return
          const payload = JSON.parse(evt.data) as {
            type?: string
            message?: string
            text?: string
            payload?: { grid_prompt?: string; cell_prompts?: GridCellPrompt[]; source?: string }
          }
          if (payload.type === 'status' && (payload.text || payload.message)) {
            set({ promptStatus: payload.text || payload.message || '' })
          }
          if (payload.type === 'done' && payload.payload) {
            hasDonePayload = true
            result = payload.payload
          }
          if (payload.type === 'error') {
            throw new Error(payload.message || '生成提示词失败')
          }
        },
      })

      if (!hasDonePayload) throw new Error('生成提示词失败')

      const promptText = result.grid_prompt || ''
      const cellPrompts = Array.isArray(result.cell_prompts) ? result.cell_prompts : []
      const promptSource = result.source || 'agent'

      if (promptText) {
        const { rows: r, cols: c } = parseLayout(layout)
        set({
          promptText,
          cellPrompts,
          promptSource,
          promptStatus: promptSource === 'agent' ? 'AI 提示词已生成' : '已使用模板提示词',
          step: 1,
          assignments: createAssignments(r, c),
          activeCell: 0,
          assignmentPage: 0,
        })
      } else {
        set({ promptStatus: '' })
        toast.error('提示词生成失败')
      }
    } catch (e: unknown) {
      set({ promptStatus: '' })
      toast.error((e as Error).message || '生成提示词失败')
    } finally {
      set({ promptLoading: false })
    }
  },

  startGeneration: async (dramaId) => {
    const { mode, selected, singleTarget, layout, promptText } = get()
    const { rows, cols } = parseLayout(layout)
    let ids: number[]

    if (mode === 'multi_ref') {
      ids = singleTarget ? [singleTarget] : []
    } else {
      ids = mode === 'first_last' ? [...selected] : selected.slice(0, rows * cols)
    }

    const assignments = createAssignments(rows, cols)
    set({
      activeShotIds: ids.filter(Boolean),
      actualLayout: { rows, cols },
      step: 2,
      statusText: '提交生成请求...',
      assignments,
      activeCell: 0,
      assignmentPage: 0,
    })

    try {
      const res = await gridAPI.generate({
        storyboard_ids: ids,
        drama_id: dramaId,
        rows,
        cols,
        mode,
        custom_prompt: promptText || undefined,
      }) as { image_generation_id?: number; grid?: { rows: number; cols: number } }

      const genId = res.image_generation_id || null
      const actualLayout = res.grid || { rows, cols }
      set({ genId, actualLayout, statusText: '等待图片生成...' })

      // Poll
      for (let i = 0; i < 120; i++) {
        await sleep(3000)
        try {
          if (!genId) break
          const status = await gridAPI.status(genId) as { status: string; image_url?: string; error_msg?: string; id?: number }
          set({ statusText: `状态: ${status.status}` })
          const resolvedPath = status.image_url || ''
          if (status.status === 'completed' && resolvedPath) {
            get().persistState(resolvedPath)
            set({ imagePath: resolvedPath, step: 3, genId: genId })
            return
          }
          if (status.status === 'failed') {
            toast.error(status.error_msg || '生成失败')
            set({ step: 0 })
            return
          }
        } catch { /* ignore */ }
      }
      toast.error('生成超时')
      set({ step: 0 })
    } catch (e: unknown) {
      toast.error((e as Error).message)
      set({ step: 0 })
    }
  },

  doSplit: async (dramaId, _episodeId, onDone) => {
    const { imagePath, actualLayout, assignments, genId } = get()
    if (!imagePath) {
      toast.warning('没有可切分的宫格图')
      return
    }
    try {
      const saveItems = assignments
        .map((a, i) => ({ cell_index: i, storyboard_id: a.storyboard_id, frame_type: a.frame_type }))
        .filter(a => a.storyboard_id)

      await gridAPI.split({
        image_url: imagePath,
        generation_id: genId,
        drama_id: dramaId,
        rows: actualLayout.rows,
        cols: actualLayout.cols,
        assignments: saveItems,
      })
      toast.success('切分完成，图片已分配')
      set({ open: false })
      onDone()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  },

  updateAssignment: (index, field, value) => {
    const { assignments } = get()
    const next = [...assignments]
    next[index] = { ...next[index], [field]: value } as GridAssignment
    set({ assignments: next, activeCell: index })
    const { imagePath } = get()
    if (imagePath) get().persistState(imagePath)
  },

  focusCell: (index) => {
    const { assignments, assignmentPage } = get()
    const pageSize = assignments.length >= 25 ? 8 : assignments.length >= 16 ? 10 : 9
    const page = Math.floor(index / pageSize)
    if (page !== assignmentPage) set({ assignmentPage: page })
    set({ activeCell: index })
  },

  setAssignmentPage: (p) => set({ assignmentPage: p }),

  selectHistory: (item) => {
    const { storageKey } = get()
    const cached = loadFromStorage(storageKey)
    const cacheKey = item.imagePath
    const cachedEntry = cached?.entries?.[cacheKey] || {}
    const layout = cachedEntry.layout || item.layout || DEFAULT_LAYOUT
    const assignments = Array.isArray(cachedEntry.assignments) && cachedEntry.assignments.length
      ? cachedEntry.assignments
      : createAssignments(layout.rows, layout.cols)
    set({
      imagePath: item.imagePath,
      genId: cachedEntry.generationId || item.id || null,
      actualLayout: layout,
      activeShotIds: Array.isArray(cachedEntry.shotIds) ? cachedEntry.shotIds : [],
      assignments,
      activeCell: 0,
      assignmentPage: 0,
    })
    get().persistState(item.imagePath)
  },

  loadHistory: async (dramaId) => {
    try {
      const rows = await imageAPI.list({ drama_id: dramaId }) as unknown as Array<Record<string, unknown>>
      const list = Array.isArray(rows) ? rows : []
      const history: GridHistoryItem[] = list
        .filter(row => row?.status === 'completed' && String(row?.frame_type || '').startsWith('grid_') && row?.image_url)
        .sort((a, b) => Number(b?.id || 0) - Number(a?.id || 0))
        .map(row => {
          const frameType = String(row?.frame_type || '')
          const layout = parseGridLayoutFromFrameType(frameType) || { rows: 3, cols: 3 }
          const imagePath = String(row?.image_url || '')
          return {
            id: row.id as number,
            imagePath,
            layout,
            modeLabel: frameType.replace(/^grid_/, '').replace(/_/g, ' · '),
            createdAtLabel: row.created_at as string || '',
          }
        })
      set({ history })

      // Restore last active grid from storage
      const { storageKey } = get()
      const cached = loadFromStorage(storageKey)
      const preferredPath = cached?.activeImagePath && history.some(h => h.imagePath === cached.activeImagePath)
        ? cached.activeImagePath
        : history[0]?.imagePath

      if (preferredPath) {
        const item = history.find(h => h.imagePath === preferredPath)
        if (item) {
          const entry = cached?.entries?.[preferredPath] || {}
          const layout = entry.layout || item.layout || DEFAULT_LAYOUT
          set({
            imagePath: preferredPath,
            genId: entry.generationId || null,
            actualLayout: layout,
            activeShotIds: Array.isArray(entry.shotIds) ? entry.shotIds : [],
            assignments: Array.isArray(entry.assignments) && entry.assignments.length
              ? entry.assignments
              : createAssignments(layout.rows, layout.cols),
          })
        }
      }
    } catch { /* ignore */ }
  },

  setStorageKey: (key) => set({ storageKey: key }),
  setShowAllHistory: (v) => set({ showAllHistory: v }),

  // Internal: persist to localStorage
  persistState: (imagePath: string) => {
    const { storageKey, genId, actualLayout, activeShotIds, assignments } = get()
    if (typeof window === 'undefined' || !storageKey) return
    if (!imagePath) {
      window.localStorage.removeItem(storageKey)
      return
    }
    const current = loadFromStorage(storageKey) || {}
    const entries = current.entries || {}
    entries[imagePath] = { generationId: genId, layout: actualLayout, shotIds: activeShotIds, assignments }
    window.localStorage.setItem(storageKey, JSON.stringify({ activeImagePath: imagePath, entries }))
  },
}))

function loadFromStorage(key: string): StorageData | null {
  if (typeof window === 'undefined' || !key) return null
  const raw = window.localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as StorageData
  } catch {
    return null
  }
}
