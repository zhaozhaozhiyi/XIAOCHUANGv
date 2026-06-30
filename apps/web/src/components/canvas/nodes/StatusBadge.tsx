'use client'

/**
 * StatusBadge — 节点 6 状态角标（v0.2.0 PR2）
 *
 * 位置：节点左上角（NodeBase 内部 absolute 定位）。
 * idle 不渲染角标，其他 5 态显示对应图标 + 颜色。
 *
 * 配色对齐项目 status token；动效（spin/pulse）走 tailwind 默认 utility。
 */

import { AlertCircle, CheckCircle2, Hourglass, Loader2, PauseCircle } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { NodeStatus } from '@/lib/canvas/types'

interface StatusBadgeProps {
  status: NodeStatus
  /** 错误时 hover 显示 */
  errorMessage?: string
}

const STATUS_CONFIG: Record<
  Exclude<NodeStatus, 'idle'>,
  { Icon: React.ElementType; tone: string; bg: string; spin?: boolean; label: string }
> = {
  queued: {
    Icon: Hourglass,
    tone: 'text-text-2',
    bg: 'bg-bg-2',
    label: '排队中',
  },
  running: {
    Icon: Loader2,
    tone: 'text-accent',
    bg: 'bg-accent-bg',
    spin: true,
    label: '运行中',
  },
  completed: {
    Icon: CheckCircle2,
    tone: 'text-success',
    bg: 'bg-success-bg',
    label: '已完成',
  },
  failed: {
    Icon: AlertCircle,
    tone: 'text-error',
    bg: 'bg-error-bg',
    label: '失败',
  },
  paused: {
    Icon: PauseCircle,
    tone: 'text-warning',
    bg: 'bg-warning-bg',
    label: '已暂停',
  },
}

export function StatusBadge({ status, errorMessage }: StatusBadgeProps) {
  if (status === 'idle') return null
  const cfg = STATUS_CONFIG[status]
  const { Icon, tone, bg, spin, label } = cfg

  return (
    <div
      className={cn(
        'absolute -top-2 -left-2 z-20 flex size-5 items-center justify-center rounded-full border border-border shadow-sm',
        bg,
      )}
      title={errorMessage || label}
      aria-label={errorMessage || label}
    >
      <Icon className={cn('size-3', tone, spin && 'animate-spin')} />
    </div>
  )
}
