'use client'

import { Check, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { CanvasChatPlan } from '@/lib/canvas/types'

export function ChatPlanPreview({
  plan,
  onConfirm,
  onCancel,
  disabled,
}: {
  plan: CanvasChatPlan
  onConfirm: () => void
  onCancel: () => void
  disabled?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-bg-1 p-3">
      <div className="text-sm font-medium text-text-0">{plan.title}</div>
      {plan.summary && <div className="mt-1 text-xs text-text-2">{plan.summary}</div>}
      <div className="mt-2 space-y-1">
        {plan.operations.map((operation, index) => (
          <div key={index} className="rounded bg-bg-2 px-2 py-1 text-xs text-text-2">
            {operation.type}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" onClick={onConfirm} disabled={disabled}>
          <Check className="size-3.5" />
          确认
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={disabled}>
          <X className="size-3.5" />
          取消
        </Button>
      </div>
    </div>
  )
}
