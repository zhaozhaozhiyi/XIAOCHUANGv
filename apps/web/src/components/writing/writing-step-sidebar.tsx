'use client'

import { Check, FilePlus2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import type { WritingDetail } from '@/types/api'

import {
  formatDocumentType,
  WRITE_STEP_DOCUMENT_TYPES,
  WRITING_STEPS,
  type WritingStepKey,
} from './writing-steps'

type Props = {
  step: WritingStepKey
  stepDone: Record<WritingStepKey, boolean>
  progressDone: number
  progressTotal: number
  detail: WritingDetail
  activeDocId: number | null
  pendingProposalCount: number
  onStepChange: (step: WritingStepKey) => void
  onSelectDocument: (documentId: number) => void
  onAddChapter: () => void
}

export function WritingStepSidebar({
  step,
  stepDone,
  progressDone,
  progressTotal,
  detail,
  activeDocId,
  pendingProposalCount,
  onStepChange,
  onSelectDocument,
  onAddChapter,
}: Props) {
  const writeDocuments = detail.documents.filter((doc) => WRITE_STEP_DOCUMENT_TYPES.has(doc.document_type))

  return (
    <aside className="flex min-h-0 w-[220px] shrink-0 flex-col border-r border-border bg-bg-0">
      <nav className="min-h-0 flex-1 overflow-y-auto p-3">
        <div className="space-y-4">
          {WRITING_STEPS.map((item) => {
            const active = step === item.key
            const done = stepDone[item.key]
            const showBadge = item.key === 'review' && pendingProposalCount > 0

            return (
              <div key={item.key}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm transition',
                    active ? 'bg-primary/8 font-semibold text-text-0' : 'text-text-2 hover:bg-bg-hover',
                  )}
                  onClick={() => onStepChange(item.key)}
                >
                  <span
                    className={cn(
                      'flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                      done ? 'bg-success/15 text-success' : active ? 'bg-primary/15 text-primary' : 'bg-bg-2 text-text-3',
                    )}
                  >
                    {done ? <Check className="size-3" /> : WRITING_STEPS.findIndex((s) => s.key === item.key) + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {showBadge ? (
                    <span className="rounded-full bg-error px-1.5 py-0.5 text-[10px] font-bold text-on-accent">{pendingProposalCount}</span>
                  ) : null}
                </button>

                {item.key === 'write' && step === 'write' ? (
                  <div className="mt-2 space-y-1 border-l border-border pl-3">
                    <div className="flex items-center justify-between gap-2 px-1">
                      <span className="text-[11px] font-medium text-text-3">章节</span>
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={onAddChapter}>
                        <FilePlus2 className="mr-1 size-3" />
                        新增
                      </Button>
                    </div>
                    {writeDocuments.map((doc) => {
                      const docActive = doc.id === activeDocId
                      return (
                        <button
                          key={doc.id}
                          type="button"
                          className={cn(
                            'w-full rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs transition',
                            docActive ? 'bg-primary/8 font-medium text-text-0' : 'text-text-2 hover:bg-bg-hover',
                          )}
                          onClick={() => onSelectDocument(doc.id)}
                        >
                          <div className="truncate">{doc.title}</div>
                          <div className="mt-0.5 text-[10px] text-text-3">{formatDocumentType(doc.document_type)}</div>
                        </button>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </nav>

      <div className="shrink-0 border-t border-border p-3">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-text-3">
          <span>创作进度</span>
          <span className="font-semibold text-text-1">
            {progressDone}/{progressTotal}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-bg-2">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${progressTotal > 0 ? (progressDone / progressTotal) * 100 : 0}%` }}
          />
        </div>
      </div>
    </aside>
  )
}
