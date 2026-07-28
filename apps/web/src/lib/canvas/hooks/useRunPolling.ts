'use client'

/**
 * useRunPolling — 业务动作触发后的轻量轮询（v0.2.0 PR3）
 *
 * 触发业务动作后调用 startPolling(hiddenNodeId)：
 *   - 每 800ms 调一次 canvasApi.runStatus 拿全量 nodeStates
 *   - 把每个节点的 status / progress merge 进 runtimeStore（驱动 NodeBase 6 状态机）
 *   - 同时把 progress 走 scheduleProgressUpdate 直改 DOM（性能链路一致）
 *   - 当 hiddenNodeId 的 status 进入 completed/failed：
 *       1. 用 GET /canvases/:id 拉一次完整 detail
 *       2. nodesStore.replaceAll（让前端节点 data 拿到回填后的 images/audioUrl/videoUrl）
 *       3. 停止轮询，clearPendingAction
 *
 * 不做：5s 轮询常驻 + SSE 双通道 → PR4 用 useRunStatus 替换。
 */

import { useCallback, useEffect, useRef } from 'react'

import { canvasApi } from '@/lib/canvas/api/canvas'
import {
  useCanvasStore,
  useEdgesStore,
  useNodesStore,
  useRuntimeStore,
  useUiStore,
  type FlowEdge,
  type FlowNode,
} from '@/lib/canvas/store'
import { scheduleProgressUpdate } from '@/lib/canvas/utils/progressBuffer'

const POLL_MS = 800

export function useRunPolling() {
  const timerRef = useRef<number | null>(null)
  const watchingRef = useRef(new Map<string, string | null>())
  const mergeNodeState = useRuntimeStore((s) => s.mergeNodeState)
  const clearPendingAction = useUiStore((s) => s.clearPendingAction)

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    watchingRef.current.clear()
  }, [])

  /** 拉一次完整 detail → 字段级 merge nodes（保留本地编辑）+ 全量替换 edges，让回填生效 */
  const reloadCanvas = useCallback(async () => {
    const canvasId = useCanvasStore.getState().canvasId
    if (!canvasId) return
    try {
      const detail = await canvasApi.get(canvasId)
      // 生成期间用户可能拖动节点/编辑 prompt，reload 时按 id 字段级 merge：
      // 保留本地 position/selected/data.prompt，合入后端回填的 results/images/videoUrl 等。
      const existingById = new Map(useNodesStore.getState().nodes.map((n) => [n.id, n]))
      const flowNodes: FlowNode[] = detail.nodes.map((n) => {
        const backend: FlowNode = {
          id: n.id,
          type: n.type,
          position: n.position,
          width: n.width,
          data: n.data,
          hidden: n.hidden,
        }
        const local = existingById.get(n.id)
        if (!local) return backend
        const localData = (local.data ?? {}) as Record<string, unknown>
        const backendData = (backend.data ?? {}) as Record<string, unknown>
        return {
          ...backend,
          position: local.position,
          selected: local.selected,
          data: {
            ...backendData,
            prompt: localData.prompt ?? backendData.prompt,
          },
        }
      })
      const flowEdges: FlowEdge[] = detail.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.source_port,
        targetHandle: e.target_port,
        type: e.edge_kind,
        data: {
          edge_kind: e.edge_kind,
          relation_type: e.relation_type,
          source_port: e.source_port,
          target_port: e.target_port,
        },
      }))
      useNodesStore.getState().replaceAll(flowNodes)
      useEdgesStore.getState().replaceAll(flowEdges)
    } catch {
      // 拉失败先静默；下一轮 poll 仍可补救
    }
  }, [])

  const start = useCallback(
    (hiddenNodeId: string, runId?: string) => {
      watchingRef.current.set(hiddenNodeId, runId ?? null)
      if (timerRef.current !== null) return

      const poll = async () => {
        const canvasId = useCanvasStore.getState().canvasId
        if (!canvasId || watchingRef.current.size === 0) return
        try {
          const status = await canvasApi.runStatus(canvasId)
          // 把全量 node_states merge 进 runtime（驱动 6 状态）
          for (const [id, st] of Object.entries(status.node_states)) {
            mergeNodeState(id, st)
            if (st.status === 'running' && typeof st.progress === 'number') {
              scheduleProgressUpdate(id, st.progress)
            }
          }
          const settled = [...watchingRef.current].filter(([nodeId, watchedRunId]) => {
            const own = status.node_states[nodeId]
            return own?.status === 'completed'
              || own?.status === 'failed'
              || Boolean(watchedRunId && status.run_id && watchedRunId !== status.run_id)
          }).map(([nodeId]) => nodeId)
          if (settled.length > 0) {
            // 每个任务完成后立即拉画布，不必等同批次的其他任务。
            await reloadCanvas()
            settled.forEach((nodeId) => watchingRef.current.delete(nodeId))
            clearPendingAction()
            if (watchingRef.current.size === 0) {
              if (timerRef.current !== null) window.clearTimeout(timerRef.current)
              timerRef.current = null
              return
            }
          }
        } catch {
          // 网络错暂忽略
        }
        // 继续 poll
        timerRef.current = window.setTimeout(poll, POLL_MS)
      }
      timerRef.current = window.setTimeout(poll, POLL_MS)
    },
    [clearPendingAction, mergeNodeState, reloadCanvas],
  )

  useEffect(() => stop, [stop])

  return { start, stop }
}
