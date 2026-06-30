/**
 * RunController — mock 端的"运行链路"调度器（v0.2.0 PR2）
 *
 * 负责：
 *  - 接收 POST /api/v1/canvases/:id/run
 *  - 拓扑排序 execute 节点（v0.2.0 简化：按 nodeId 顺序）
 *  - setTimeout 链推 6 状态变化：queued → running(0~100) → completed
 *  - GET /api/v1/canvases/:id/run-status 返回当前 nodeStates 全量
 *
 * 不做：
 *  - SSE 推送（PR4 接 useRunStatus 双通道）
 *  - 真实 wiring（节点之间的依赖）— v0.2.0 简化为线性串行
 *  - 失败/重试场景（perf 页可手动触发）
 */

import type { NodeRuntimeState } from '@/lib/canvas/types'
import { getCanvas } from './store'

interface RunInfo {
  runId: string
  canvasId: string
  versionId: string
  startedAt: number
  /** 当前所有节点状态 */
  nodeStates: Record<string, NodeRuntimeState>
  /** 完成节点数 */
  completedCount: number
  /** 执行节点总数 */
  totalCount: number
  /** 调度 timer ids（清理用） */
  timers: number[]
}

const EXECUTE_TYPES = new Set([
  'text-to-image',
  'image-to-video',
  'text-to-speech',
  'concat',
  'export',
])

let current: RunInfo | null = null

function nextRunId(): string {
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 7)
  return `run_${ts}_${rnd}`
}

/** 启动一次运行，返回 runInfo（不阻塞，setTimeout 链异步推进） */
export function startRun(canvasId: string): RunInfo | null {
  const canvas = getCanvas(canvasId)
  if (!canvas) return null

  // 先清理旧 run（避免 timer 泄漏）
  if (current) cancelRun()

  const execNodes = canvas.nodes.filter((n) => EXECUTE_TYPES.has(n.type))
  const runInfo: RunInfo = {
    runId: nextRunId(),
    canvasId,
    versionId: canvas.current_version_id,
    startedAt: Date.now(),
    nodeStates: {},
    completedCount: 0,
    totalCount: execNodes.length,
    timers: [],
  }

  // 初始全部 idle
  for (const n of canvas.nodes) {
    runInfo.nodeStates[n.id] = { status: 'idle' }
  }

  // 调度推进：每节点 queued → running(0~100，步长 10，每 200ms) → completed
  let delay = 100
  for (const n of execNodes) {
    const nodeId = n.id
    // queued
    runInfo.timers.push(
      window.setTimeout(() => {
        runInfo.nodeStates[nodeId] = { status: 'queued' }
      }, delay),
    )
    delay += 200

    // running 0
    runInfo.timers.push(
      window.setTimeout(() => {
        runInfo.nodeStates[nodeId] = { status: 'running', progress: 0 }
      }, delay),
    )
    delay += 200

    // running progress 10 → 100
    for (let p = 10; p <= 100; p += 10) {
      const progress = p
      runInfo.timers.push(
        window.setTimeout(() => {
          runInfo.nodeStates[nodeId] = { status: 'running', progress }
        }, delay),
      )
      delay += 200
    }

    // completed
    runInfo.timers.push(
      window.setTimeout(() => {
        runInfo.nodeStates[nodeId] = { status: 'completed', progress: 100 }
        runInfo.completedCount += 1
      }, delay),
    )
    delay += 100
  }

  current = runInfo
  return runInfo
}

/** 取消当前 run（清所有 timer，状态保留供查询） */
export function cancelRun(): void {
  if (!current) return
  for (const t of current.timers) {
    window.clearTimeout(t)
  }
  current.timers = []
}

/** 获取指定画布的当前 run-status（5s 轮询用） */
export function getRunStatus(canvasId: string): {
  canvas_id: string
  version_id: string
  run_id: string | null
  progress: { current: number; total: number }
  node_states: Record<string, NodeRuntimeState>
} | null {
  const canvas = getCanvas(canvasId)
  if (!canvas) return null
  if (!current || current.canvasId !== canvasId) {
    return {
      canvas_id: canvasId,
      version_id: canvas.current_version_id,
      run_id: null,
      progress: { current: 0, total: 0 },
      node_states: {},
    }
  }
  return {
    canvas_id: canvasId,
    version_id: current.versionId,
    run_id: current.runId,
    progress: { current: current.completedCount, total: current.totalCount },
    node_states: { ...current.nodeStates },
  }
}

/** 立即把指定节点设为某状态（perf 页 / 调试用） */
export function setNodeStatus(
  canvasId: string,
  nodeId: string,
  state: NodeRuntimeState,
): void {
  if (!current || current.canvasId !== canvasId) {
    // 没有活跃 run，临时建一个仅含该节点状态的"哑 run"
    const canvas = getCanvas(canvasId)
    if (!canvas) return
    current = {
      runId: nextRunId(),
      canvasId,
      versionId: canvas.current_version_id,
      startedAt: Date.now(),
      nodeStates: {},
      completedCount: 0,
      totalCount: 0,
      timers: [],
    }
  }
  current.nodeStates[nodeId] = state
}
