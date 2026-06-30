'use client'

import { Sparkles } from 'lucide-react'

import type { BriefState } from '@/components/writing/types'
import { renderBriefPreview } from '@/components/writing/writing-preview-utils'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'

type Props = {
  briefDraft: BriefState
  briefStructuredPreview: Record<string, unknown> | null
  onBriefChange: (patch: Partial<BriefState>) => void
}

export function BriefStepPanel({ briefDraft, briefStructuredPreview, onBriefChange }: Props) {
  return (
    <ScrollArea className="h-full">
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <div>
          <h2 className="text-lg font-semibold text-text-0">创作准备</h2>
          <p className="mt-1 text-sm text-text-3">填写世界观、背景、主线与角色，为后续大纲和章节写作打基础。修改将自动保存。</p>
        </div>

        <div className="space-y-4">
          {(
            [
              ['世界观', 'worldview', 3],
              ['背景', 'background', 3],
              ['主线', 'main_plot', 3],
              ['核心冲突', 'core_conflict', 3],
              ['主要角色', 'main_characters', 4],
            ] as const
          ).map(([label, key, rows]) => (
            <div key={key} className="space-y-1.5">
              <div className="text-sm font-medium text-text-1">{label}</div>
              <Textarea
                value={briefDraft[key]}
                onChange={(event) => onBriefChange({ [key]: event.target.value })}
                rows={rows}
              />
            </div>
          ))}
        </div>

        <section className="rounded-[var(--radius-lg)] border border-border bg-bg-0 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-text-1">
            <Sparkles className="size-4" />
            结构化预览
          </div>
          <div className="mt-3">{renderBriefPreview(briefDraft, briefStructuredPreview)}</div>
        </section>
      </div>
    </ScrollArea>
  )
}
