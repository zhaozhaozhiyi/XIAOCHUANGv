/**
 * useCanvas — 加载单个画布详情到三个 store（PR1）
 */

import { useEffect, useState } from 'react'
import { canvasApi } from '@/lib/canvas/api/canvas'
import type { CanvasDetail } from '@/lib/canvas/types'
import {
  useCanvasStore,
  useEdgesStore,
  useNodesStore,
  useRuntimeStore,
  type FlowEdge,
  type FlowNode,
} from '@/lib/canvas/store'

interface State {
  loading: boolean
  error: Error | null
  canvas: CanvasDetail | null
}

export function useCanvas(canvasId: string | null) {
  const [state, setState] = useState<State>({ loading: true, error: null, canvas: null })
  const setMeta = useCanvasStore((s) => s.setMeta)
  const replaceNodes = useNodesStore((s) => s.replaceAll)
  const replaceEdges = useEdgesStore((s) => s.replaceAll)
  const resetCanvas = useCanvasStore((s) => s.reset)
  const clearNodes = useNodesStore((s) => s.clear)
  const clearEdges = useEdgesStore((s) => s.clear)
  const clearRuntime = useRuntimeStore((s) => s.clear)

  useEffect(() => {
    if (!canvasId) {
      // setState 放在 effect 内部的 microtask 里，避免同步 cascading render
      queueMicrotask(() => setState({ loading: false, error: null, canvas: null }))
      return
    }
    const controller = new AbortController()
    queueMicrotask(() => setState({ loading: true, error: null, canvas: null }))

    canvasApi
      .get(canvasId, { signal: controller.signal })
      .then((detail) => {
        if (controller.signal.aborted) return
        setMeta({
          canvasId: detail.id,
          title: detail.title,
          currentVersionId: detail.current_version_id,
          sourceDramaId: detail.source_drama_id ?? null,
          viewport: detail.viewport,
        })
        // 把后端 CanvasNode / CanvasEdge 转换为 React Flow 形态
        const flowNodes: FlowNode[] = detail.nodes.map((n) => ({
          id: n.id,
          type: n.type,
          position: n.position,
          width: n.width,
          data: n.data,
          hidden: n.hidden,
        }))
        const flowEdges: FlowEdge[] = detail.edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.source_port,
          targetHandle: e.target_port,
          // 用 edge_kind 对应到 EDGE_TYPES 注册的组件（'narrative' | 'dataflow'）
          type: e.edge_kind,
          data: {
            edge_kind: e.edge_kind,
            relation_type: e.relation_type,
            source_port: e.source_port,
            target_port: e.target_port,
          },
        }))
        replaceNodes(flowNodes)
        replaceEdges(flowEdges)
        setState({ loading: false, error: null, canvas: detail })
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === 'AbortError') return
        setState({ loading: false, error: err as Error, canvas: null })
      })

    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId])

  // 组件卸载时清空 store（避免下个画布拿到老数据）
  useEffect(() => {
    return () => {
      resetCanvas()
      clearNodes()
      clearEdges()
      clearRuntime()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return state
}
