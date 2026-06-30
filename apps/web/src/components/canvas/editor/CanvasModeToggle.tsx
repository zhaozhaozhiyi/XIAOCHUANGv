'use client'

/**
 * CanvasModeToggle — 智能画布 ↔ 导演模式 切换（v2.2 PR-A）
 *
 * 双视图共用同一 canvas / 同一 store（见方案 docs/v2.2）：
 * - 智能画布（chat）：对话栏 + 流程栏，对话驱动落节点
 * - 导演模式（director）：隐藏对话/流程栏，专注手动连线 DAG
 *
 * 仅切换 UI 呈现，不改动 nodes/edges 数据。
 */

import { MessagesSquare, Workflow } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePipelineStore } from '@/lib/canvas/store/pipelineStore'

export function CanvasModeToggle() {
  const canvasMode = usePipelineStore((s) => s.canvasMode)
  const setCanvasMode = usePipelineStore((s) => s.setCanvasMode)

  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-border bg-bg-1 p-0.5">
      <ModeButton
        active={canvasMode === 'chat'}
        onClick={() => setCanvasMode('chat')}
        icon={<MessagesSquare className="size-3.5" />}
        label="智能画布"
      />
      <ModeButton
        active={canvasMode === 'director'}
        onClick={() => setCanvasMode('director')}
        icon={<Workflow className="size-3.5" />}
        label="导演模式"
      />
    </div>
  )
}

function ModeButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-bg-surface text-text-0 shadow-sm'
          : 'text-text-2 hover:text-text-0',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}
