/**
 * runtimeStore — 节点运行状态（v0.2.0 PR1 占位骨架）
 *
 * 性能关键 store（TRD §3.4）：
 * - 任何节点状态变化都不能引起所有节点 rerender
 * - PR2 真正接入 useRuntimeStore(s => s.nodeStates[id], shallow) 模式
 * - PR4 的 useRunStatus 双通道（5s 轮询 + SSE）写入此 store
 *
 * PR1 阶段：仅暴露接口，无实际运行逻辑。
 */

import { create } from 'zustand'
import type { NodeRuntimeState } from '@/lib/canvas/types'

/** PR4：画布级 run 状态（顶栏 RunProgressIndicator 用） */
export type RunOverallState = 'idle' | 'running' | 'completed' | 'failed'

export interface RunProgress {
  current: number
  total: number
  eta_seconds?: number
}

interface RuntimeState {
  /** 当前活跃的 runId（PR4 启用） */
  currentRunId: string | null
  /** 节点状态映射（按 nodeId 索引） */
  nodeStates: Record<string, NodeRuntimeState>

  // ─── PR4 新增 ───
  runState: RunOverallState
  runProgress: RunProgress

  /** 5s 轮询：全量覆盖（权威数据源） */
  setNodeStates: (states: Record<string, NodeRuntimeState>, runId?: string | null) => void
  /** SSE：单点合并（优化通道，仅终态事件） */
  mergeNodeState: (nodeId: string, partial: Partial<NodeRuntimeState>) => void
  /** 清空（画布切换时调用） */
  clear: () => void

  setRunState: (state: RunOverallState) => void
  setRunProgress: (progress: RunProgress) => void
}

export const useRuntimeStore = create<RuntimeState>((set) => ({
  currentRunId: null,
  nodeStates: {},
  runState: 'idle',
  runProgress: { current: 0, total: 0 },

  setNodeStates: (states, runId) =>
    set(() => ({
      nodeStates: states,
      currentRunId: runId !== undefined ? runId : null,
    })),

  mergeNodeState: (nodeId, partial) =>
    set((s) => ({
      nodeStates: {
        ...s.nodeStates,
        [nodeId]: { ...(s.nodeStates[nodeId] ?? { status: 'idle' }), ...partial },
      },
    })),

  clear: () =>
    set(() => ({
      currentRunId: null,
      nodeStates: {},
      runState: 'idle',
      runProgress: { current: 0, total: 0 },
    })),

  setRunState: (state) => set({ runState: state }),
  setRunProgress: (progress) => set({ runProgress: progress }),
}))
