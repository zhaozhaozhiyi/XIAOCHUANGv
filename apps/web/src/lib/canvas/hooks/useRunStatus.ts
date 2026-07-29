'use client'

/**
 * useRunStatus — 画布运行状态全局监控（v0.2.0 PR4，TRD §7.8）
 *
 * 双通道设计（PR4 阶段仅实现通道 1）：
 *   通道 1（PR4）：5s setInterval 调 canvasApi.runStatus → 全量覆盖 setNodeStates
 *   通道 2（v0.2.1）：EventSource SSE → 单点 mergeNodeState；提供并行接口
 *
 * 状态写到 runtimeStore（currentRunId / runState / runProgress），让任何组件
 * 都能订阅（顶栏 RunProgressIndicator / 列表卡片 RunStatusBadge / 业务动作完成 toast）。
 *
 * 与 PR3 的 useRunPolling 区别：
 *   - useRunPolling 是"业务动作触发一次"的临时高频轮询（800ms），完成即停
 *   - useRunStatus 是顶栏画布级持久监控，5s 间隔，run 完才停
 */

import { useCallback, useEffect, useRef } from 'react'

import { canvasApi } from '@/lib/canvas/api/canvas'
import {
  useEdgesStore,
  useNodesStore,
  useRuntimeStore,
  type FlowEdge,
  type FlowNode,
} from '@/lib/canvas/store'
import { scheduleProgressUpdate } from '@/lib/canvas/utils/progressBuffer'

const POLL_INTERVAL_MS = 5_000

interface StartOpts {
  onComplete?: () => void
  onFailed?: () => void
}

interface UseRunStatusReturn {
  start: (runId: string, opts?: StartOpts) => void
  stop: () => void
}

export function useRunStatus(canvasId: string | null): UseRunStatusReturn {
  const timerRef = useRef<number | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)
  const onCompleteRef = useRef<(() => void) | undefined>(undefined)
  const onFailedRef = useRef<(() => void) | undefined>(undefined)

  const setNodeStates = useRuntimeStore((s) => s.setNodeStates)
  const setRunState = useRuntimeStore((s) => s.setRunState)
  const setRunProgress = useRuntimeStore((s) => s.setRunProgress)
  const replaceNodes = useNodesStore((s) => s.replaceAll)
  const replaceEdges = useEdgesStore((s) => s.replaceAll)

  const refreshCanvas = useCallback(async (signal: AbortSignal) => {
    if (!canvasId) return
    const detail = await canvasApi.get(canvasId, { signal })
    replaceNodes(detail.nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      width: node.width,
      data: node.data,
      hidden: node.hidden,
    })) as FlowNode[])
    replaceEdges(detail.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.source_port,
      targetHandle: edge.target_port,
      type: edge.edge_kind,
      data: {
        edge_kind: edge.edge_kind,
        relation_type: edge.relation_type,
        source_port: edge.source_port,
        target_port: edge.target_port,
        label: edge.label,
      },
    })) as FlowEdge[])
  }, [canvasId, replaceEdges, replaceNodes])

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (ctrlRef.current) {
      ctrlRef.current.abort()
      ctrlRef.current = null
    }
  }, [])

  const tick = useCallback(async () => {
    if (!canvasId) return
    if (ctrlRef.current) ctrlRef.current.abort()
    ctrlRef.current = new AbortController()
    try {
      const status = await canvasApi.runStatus(canvasId, {
        signal: ctrlRef.current.signal,
      })
      setNodeStates(status.node_states, status.run_id)
      for (const [id, st] of Object.entries(status.node_states)) {
        if (st.status === 'running' && typeof st.progress === 'number') {
          scheduleProgressUpdate(id, st.progress)
        }
      }
      setRunProgress({
        current: status.progress.current,
        total: status.progress.total,
        eta_seconds: status.progress.eta_seconds,
      })
      const states = Object.values(status.node_states)
      const hasRunning = states.some(
        (s) => s.status === 'running' || s.status === 'queued',
      )
      const allDone =
        status.progress.total > 0 && status.progress.current === status.progress.total
      if (status.state === 'failed') {
        setRunState('failed')
        await refreshCanvas(ctrlRef.current.signal)
        onFailedRef.current?.()
        stop()
      } else if (status.state === 'completed' && allDone && !hasRunning) {
        setRunState('completed')
        await refreshCanvas(ctrlRef.current.signal)
        onCompleteRef.current?.()
        stop()
      } else if (hasRunning) {
        setRunState('running')
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        // 静默
      }
    }
  }, [canvasId, refreshCanvas, setNodeStates, setRunProgress, setRunState, stop])

  const start = useCallback(
    (_rid: string, opts?: StartOpts) => {
      stop()
      setRunState('running')
      onCompleteRef.current = opts?.onComplete
      onFailedRef.current = opts?.onFailed
      void tick()
      timerRef.current = window.setInterval(tick, POLL_INTERVAL_MS)
    },
    [setRunState, stop, tick],
  )

  useEffect(() => {
    if (!canvasId) return stop
    let cancelled = false

    void canvasApi.runStatus(canvasId)
      .then((status) => {
        if (cancelled || status.state !== 'running' || !status.run_id) return
        start(status.run_id)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      stop()
    }
  }, [canvasId, start, stop])

  return { start, stop }
}
