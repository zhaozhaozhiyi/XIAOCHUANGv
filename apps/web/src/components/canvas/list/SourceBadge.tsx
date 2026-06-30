'use client'

/**
 * SourceBadge — 画布来源徽章
 *
 * source === 'global-inspiration' 时显示 `🌟 全局`（不可跳转）。
 * 其他 source 不渲染。
 */

import { Sparkles } from 'lucide-react'

import type { CanvasSummary } from '@/lib/canvas/types'

interface Props {
  summary: CanvasSummary
}

export function SourceBadge({ summary }: Props) {
  if (summary.source === 'global-inspiration') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-accent-bg px-2 py-0.5 text-[11px] font-medium text-accent-text"
        title="全局灵感板"
      >
        <Sparkles size={11} />
        <span>全局</span>
      </span>
    )
  }

  return null
}
