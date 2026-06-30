'use client'

/**
 * RunStatusBadge — 列表卡片运行状态徽章（v0.2.0 PR4）
 *
 * - running   →  ▶ 4/12（accent 色 + 慢呼吸）
 * - completed →  ✓ 已完成（success）
 * - failed    →  ⚠ 失败（error）
 * - idle / 无 →  不渲染
 */

import { AlertTriangle, CheckCircle2, Play } from 'lucide-react'

import { cn } from '@/lib/cn'
import type { CanvasSummary } from '@/lib/canvas/types'

interface Props {
  summary: CanvasSummary
}

export function RunStatusBadge({ summary }: Props) {
  const rs = summary.run_status
  if (!rs || rs.state === 'idle') return null

  if (rs.state === 'running') {
    const txt = rs.progress
      ? `${rs.progress.current}/${rs.progress.total}`
      : '运行中'
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full bg-accent-bg px-2 py-0.5 text-[11px] font-medium text-accent-text',
          'xc-node-running',
        )}
      >
        <Play size={11} className="fill-current" />
        <span>{txt}</span>
      </span>
    )
  }

  if (rs.state === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-medium text-success">
        <CheckCircle2 size={11} />
        <span>已完成</span>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-error-bg px-2 py-0.5 text-[11px] font-medium text-error">
      <AlertTriangle size={11} />
      <span>失败</span>
    </span>
  )
}
