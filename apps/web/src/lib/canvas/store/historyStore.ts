/**
 * historyStore — 画布撤销/重做栈（v0.2.0 PR1.5）
 *
 * 关键约定：
 * - 仅记录 (nodes, edges) 快照；viewport 不算撤销项（拖画布不该进栈）
 * - 仅在"语义提交点"push：节点拖动结束、连线增删、节点增删、批量粘贴
 * - 持续编辑文字 / 调字段不进栈（PR2 再加 50ms 合并窗口）
 * - 上限 50 步，超出从队头丢
 * - 不持久化（刷新即清，参考项目原行为）
 *
 * 与 zundo / zustand temporal middleware 的区别：
 * - 我们手动控制 push 时机，避免每次 immer 写入都进栈（性能 + 语义都更可控）
 */

import { create } from 'zustand'
import type { FlowEdge, FlowNode } from './index'
import { useEdgesStore } from './edgesStore'
import { useNodesStore } from './nodesStore'

interface Snapshot {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

interface HistoryState {
  past: Snapshot[]
  future: Snapshot[]

  /** 在调用 mutate action 之前调用：把"当前状态"压栈，清空 future */
  push: () => void
  /** 把栈顶弹回 nodes/edges store；当前状态进 future */
  undo: () => void
  /** 反过来 */
  redo: () => void
  clear: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

const MAX = 50

/** 注意：用 structuredClone 而不是 immer / spread，避免 React Flow 节点引用混乱 */
function snap(): Snapshot {
  return {
    nodes: structuredClone(useNodesStore.getState().nodes),
    edges: structuredClone(useEdgesStore.getState().edges),
  }
}

function apply(s: Snapshot) {
  useNodesStore.getState().replaceAll(s.nodes)
  useEdgesStore.getState().replaceAll(s.edges)
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  past: [],
  future: [],

  push: () => {
    set((s) => {
      const next = [...s.past, snap()]
      if (next.length > MAX) next.shift()
      return { past: next, future: [] }
    })
  },

  undo: () => {
    const { past } = get()
    if (past.length === 0) return
    const top = past[past.length - 1]
    const current = snap()
    apply(top)
    set({ past: past.slice(0, -1), future: [current, ...get().future] })
  },

  redo: () => {
    const { future } = get()
    if (future.length === 0) return
    const top = future[0]
    const current = snap()
    apply(top)
    set({ past: [...get().past, current], future: future.slice(1) })
  },

  clear: () => set({ past: [], future: [] }),
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}))
