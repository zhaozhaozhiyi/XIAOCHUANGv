/**
 * nodesStore — 节点结构数据（v0.2.0 PR1）
 *
 * 关键约定：
 * - 只放结构数据（position / type / data），不放运行状态（→ runtimeStore）
 * - 提供 React Flow 兼容的 onNodesChange handler，让 ReactFlow 直接驱动
 * - 任何写操作都通过 useCanvasStore.markEditing() 标记画布"待保存"
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  type Node as RFNode,
  type NodeChange,
  applyNodeChanges,
} from '@xyflow/react'
import type { CanvasNode } from '@/lib/canvas/types'
import { useCanvasStore } from './canvasStore'

/** React Flow 节点（业务 data 用 CanvasNode['data'] 形态） */
export type FlowNode = RFNode<CanvasNode['data']>

interface NodesState {
  nodes: FlowNode[]

  /** 全量替换（加载画布时用） */
  replaceAll: (nodes: FlowNode[]) => void
  /** React Flow onNodesChange 回调 */
  applyChanges: (changes: NodeChange<FlowNode>[]) => void
  addNode: (node: FlowNode) => void
  updateNodeData: (id: string, patch: Partial<CanvasNode['data']>) => void
  deleteNode: (id: string) => void
  clear: () => void
}

export const useNodesStore = create<NodesState>()(
  immer((set) => ({
    nodes: [],

    replaceAll: (nodes) =>
      set((s) => {
        s.nodes = nodes
      }),

    applyChanges: (changes) =>
      set((s) => {
        s.nodes = applyNodeChanges(changes, s.nodes)
        // 触发 markEditing 的语义点：
        //   - 节点删除 / 增加
        //   - 节点拖动"结束"（dragging:false）— 拖动期间的 position 流不算
        // 不触发：
        //   - select / dimensions（纯 UI）
        //   - position 但 dragging:true（拖动中 — 否则会 3s 一次狂存）
        const triggers = changes.some((c) => {
          if (c.type === 'remove' || c.type === 'add') return true
          if (c.type === 'position' && 'dragging' in c && c.dragging === false) return true
          return false
        })
        if (triggers) {
          useCanvasStore.getState().markEditing()
        }
      }),

    addNode: (node) =>
      set((s) => {
        s.nodes.push(node)
        useCanvasStore.getState().markEditing()
      }),

    updateNodeData: (id, patch) =>
      set((s) => {
        const target = s.nodes.find((n) => n.id === id)
        if (target) {
          target.data = { ...target.data, ...patch }
          useCanvasStore.getState().markEditing()
        }
      }),

    deleteNode: (id) =>
      set((s) => {
        s.nodes = s.nodes.filter((n) => n.id !== id)
        useCanvasStore.getState().markEditing()
      }),

    clear: () =>
      set((s) => {
        s.nodes = []
      }),
  })),
)
