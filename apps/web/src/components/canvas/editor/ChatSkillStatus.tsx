'use client'

import { Sparkles } from 'lucide-react'

export function ChatSkillStatus({ running }: { running: boolean }) {
  if (!running) return null
  return (
    <div className="flex items-center gap-1.5 px-1 text-xs text-text-3">
      <Sparkles className="size-3.5 animate-pulse text-accent" />
      正在处理画布操作…
    </div>
  )
}
