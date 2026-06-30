'use client'

/**
 * NodeBase — 所有画布节点的通用视觉外壳（v0.2.0 PR2）
 *
 * 关注三件事：
 *   1. 6 状态机视觉：边框 / 角标 / 顶部进度条 / CSS 动画 class
 *   2. PortHandle 从 nodeDefinition.inputs/outputs 自动渲染
 *   3. 业务内容 slot（children）
 *
 * 性能契约（TRD §3.4）：
 *   - 通过 useNodeState(id) 只订阅当前节点的 runtime → re-render 不扩散
 *   - 进度条宽度走 --xc-progress CSS var，由 progressBuffer 直改 DOM
 *   - 呼吸 / pop / 光点全 CSS keyframes，GPU 合成
 */

import { memo } from 'react'
import type { CanvasNodeDefinition } from '@xiaochuang/canvas-shared'

import { cn } from '@/lib/cn'
import { useUiStore } from '@/lib/canvas/store'
import { useNodeState } from '@/lib/canvas/hooks/useNodeState'

import { PortHandle } from './PortHandle'
import { StatusBadge } from './StatusBadge'

interface NodeBaseProps {
  nodeId: string
  definition: CanvasNodeDefinition
  selected?: boolean
  width?: number | string
  className?: string
  onPickNode?: () => void
  children: React.ReactNode
}

function NodeBaseComponent({
  nodeId,
  definition,
  selected,
  width,
  className,
  onPickNode,
  children,
}: NodeBaseProps) {
  const state = useNodeState(nodeId)
  const status = state.status
  const accent = definition.ui?.accentColor

  // UI 选中态（来自 uiStore 单击选中，与 React Flow `selected` 取并集）
  const uiSelectedId = useUiStore((s) => s.selectedNodeId)
  const toggleSelect = useUiStore((s) => s.toggleSelectedNodeId)
  const isSelected = selected || uiSelectedId === nodeId

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onPickNode) onPickNode()
    else toggleSelect(nodeId)
  }

  // input / output 多端口的垂直偏移：n 个端口时第 i 个 top = (i - (n-1)/2) * 18
  const inputs = definition.inputs ?? []
  const outputs = definition.outputs ?? []

  return (
    <div
      data-node-id={nodeId}
      data-node-status={status}
      onClick={handleClick}
      className={cn(
        'xc-node group relative cursor-pointer overflow-visible rounded-2xl border bg-bg-1 shadow-default transition-colors',
        'border-border',
        status === 'running' && 'xc-node-running',
        status === 'completed' && 'xc-node-completed',
        status === 'failed' && 'border-error',
        status === 'paused' && 'opacity-70',
        isSelected && 'border-accent shadow-accent-glow',
        className,
      )}
      style={
        {
          width,
          '--xc-accent': accent,
        } as React.CSSProperties
      }
    >
      {/* 顶部 2px 进度条（仅 running 显示，宽度由 progressBuffer 直改 DOM） */}
      {status === 'running' && (
        <div
          className="pointer-events-none absolute left-0 top-0 z-10 h-0.5 rounded-tl-2xl bg-accent transition-[width] duration-200"
          style={{ width: 'var(--xc-progress, 0%)' }}
          aria-hidden
        />
      )}

      {/* 6 状态角标 */}
      <StatusBadge status={status} errorMessage={state.errorMessage} />

      {/* 业务内容 */}
      {children}

      {/* Handles：input 左，output 右，垂直均匀分布 */}
      {inputs.map((p, idx) => (
        <PortHandle
          key={`in:${p.name}`}
          role="in"
          port={p}
          accent={accent}
          offsetPx={(idx - (inputs.length - 1) / 2) * 22}
        />
      ))}
      {outputs.map((p, idx) => (
        <PortHandle
          key={`out:${p.name}`}
          role="out"
          port={p}
          accent={accent}
          offsetPx={(idx - (outputs.length - 1) / 2) * 22}
        />
      ))}
    </div>
  )
}

export const NodeBase = memo(NodeBaseComponent)
