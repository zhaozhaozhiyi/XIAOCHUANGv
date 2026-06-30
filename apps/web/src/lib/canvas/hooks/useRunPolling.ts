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
  const watchingRef = useRef<string | null>(null)
  const mergeNodeState = useRuntimeStore((s) => s.mergeNodeState)
  const clearPendingAction = useUiStore((s) => s.clearPendingAction)

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    watchingRef.current = null
  }, [])

  /** 拉一次完整 detail → 全量替换 nodes/edges，让回填生效 */
  const reloadCanvas = useCallback(async () => {
    const canvasId = useCanvasStore.getState().canvasId
    if (!canvasId) return
    try {
      const detail = await canvasApi.get(canvasId)
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
    (hiddenNodeId: string) => {
      stop()
      watchingRef.current = hiddenNodeId

      const poll = async () => {
        const canvasId = useCanvasStore.getState().canvasId
        if (!canvasId || watchingRef.current !== hiddenNodeId) return
        try {
          const status = await canvasApi.runStatus(canvasId)
          // 把全量 node_states merge 进 runtime（驱动 6 状态）
          for (const [id, st] of Object.entries(status.node_states)) {
            mergeNodeState(id, st)
            if (st.status === 'running' && typeof st.progress === 'number') {
              scheduleProgressUpdate(id, st.progress)
            }
          }
          const own = status.node_states[hiddenNodeId]
          if (own?.status === 'completed' || own?.status === 'failed') {
            // 完成 → 拉一次完整画布让 sourceNode 数据回填
            await reloadCanvas()
            clearPendingAction()
            stop()
            return
          }
        } catch {
          // 网络错暂忽略
        }
        // 继续 poll
        timerRef.current = window.setTimeout(poll, POLL_MS)
      }
      timerRef.current = window.setTimeout(poll, POLL_MS)
    },
    [clearPendingAction, mergeNodeState, reloadCanvas, stop],
  )

  useEffect(() => stop, [stop])

  return { start, stop }
}
