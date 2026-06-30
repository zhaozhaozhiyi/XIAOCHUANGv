/**
 * edgesStore — 连线数据（v0.2.0 PR1）
 *
 * 关键约定：
 * - 区分 narrative（叙事关系，flow / reference / parallel）和 dataflow（数据流，含端口）
 * - React Flow 兼容的 onEdgesChange / onConnect
 * - 写操作触发 useCanvasStore.markEditing()
 */

import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import {
  type Connection,
  type Edge as RFEdge,
  type EdgeChange,
  addEdge as addRFEdge,
  applyEdgeChanges,
} from '@xyflow/react'
import type { EdgeKind, RelationType } from '@xiaochuang/canvas-shared'
import { useCanvasStore } from './canvasStore'

export interface FlowEdgeData extends Record<string, unknown> {
  edge_kind?: EdgeKind
  /** PRD §8.3 8 种叙事关系（solid / dashed / arrow / cut / dissolve / wipe / jump-cut / fade） */
  relation_type?: RelationType
  source_port?: string
  target_port?: string
}

export type FlowEdge = RFEdge<FlowEdgeData>

interface EdgesState {
  edges: FlowEdge[]

  replaceAll: (edges: FlowEdge[]) => void
  applyChanges: (changes: EdgeChange<FlowEdge>[]) => void
  /** React Flow onConnect 回调 */
  addConnection: (connection: Connection) => void
  addEdge: (edge: FlowEdge) => void
  deleteEdge: (id: string) => void
  clear: () => void
}

export const useEdgesStore = create<EdgesState>()(
  immer((set) => ({
    edges: [],

    replaceAll: (edges) =>
      set((s) => {
        s.edges = edges
      }),

    applyChanges: (changes) =>
      set((s) => {
        s.edges = applyEdgeChanges(changes, s.edges)
        if (changes.some((c) => c.type === 'remove')) {
          useCanvasStore.getState().markEditing()
        }
      }),

    addConnection: (connection) =>
      set((s) => {
        // 端口形如 "out:image" / "in:video"；带类型 → dataflow，否则 narrative
        const sourceHandle = connection.sourceHandle ?? undefined
        const targetHandle = connection.targetHandle ?? undefined
        const hasPortType = !!(sourceHandle && sourceHandle.includes(':'))
        const edgeKind: EdgeKind = hasPortType ? 'dataflow' : 'narrative'

        const edge: FlowEdge = {
          id: `edge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
          source: connection.source,
          target: connection.target,
          sourceHandle,
          targetHandle,
          // React Flow edge type → 对应 EDGE_TYPES 注册的组件
          type: edgeKind,
          data: {
            edge_kind: edgeKind,
            // narrative 默认 solid（PRD §8.3 基础）；dataflow 不带 relation_type
            relation_type: edgeKind === 'narrative' ? 'solid' : undefined,
            source_port: sourceHandle,
            target_port: targetHandle,
          },
        }
        s.edges = addRFEdge(edge, s.edges)
        useCanvasStore.getState().markEditing()
      }),

    addEdge: (edge) =>
      set((s) => {
        s.edges.push(edge)
        useCanvasStore.getState().markEditing()
      }),

    deleteEdge: (id) =>
      set((s) => {
        s.edges = s.edges.filter((e) => e.id !== id)
        useCanvasStore.getState().markEditing()
      }),

    clear: () =>
      set((s) => {
        s.edges = []
      }),
  })),
)
