/**
 * useNodeState — 单节点状态选择器（v0.2.0 PR2，TRD §3.4 性能关键）
 *
 * 目的：让节点状态变化只 re-render 该节点，不引起全图 reconciliation。
 *
 * 用法：
 *   const state = useNodeState('node_xxx') // -> { status, progress?, errorMessage? } | undefined
 *
 * zustand v5 的 selector 默认浅比较已经能区分对象引用，但为安全起见显式 useShallow，
 * 防止后续把字段加多了不小心引发 re-render。
 */

import { useShallow } from 'zustand/react/shallow'
import { useRuntimeStore } from '@/lib/canvas/store/runtimeStore'
import type { NodeRuntimeState } from '@/lib/canvas/types'

const EMPTY: NodeRuntimeState = { status: 'idle' }

export function useNodeState(nodeId: string): NodeRuntimeState {
  return useRuntimeStore(
    useShallow((s) => s.nodeStates[nodeId] ?? EMPTY),
  )
}
