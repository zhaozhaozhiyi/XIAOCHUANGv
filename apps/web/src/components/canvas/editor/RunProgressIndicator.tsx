'use client'

/**
 * RunProgressIndicator — 顶栏运行进度（v0.2.0 PR4，PRD §10.2）
 *
 * `▶ 生成中 4/12 · ETA 8:32 [取消]`
 *
 * 直接从 runtimeStore 读 runState / runProgress，由 useRunStatus 推动。
 * 取消按钮：调用外部传入的 onCancel（CanvasEditor 持有 hook 引用调 stop）。
 */

import { Loader2, X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useRuntimeStore } from '@/lib/canvas/store'

interface Props {
  onCancel: () => void
}

function formatEta(seconds?: number): string | null {
  if (!seconds || seconds <= 0) return null
  if (seconds < 60) return `${Math.round(seconds)}s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${m}min`
}

export function RunProgressIndicator({ onCancel }: Props) {
  const runState = useRuntimeStore((s) => s.runState)
  const progress = useRuntimeStore((s) => s.runProgress)
  if (runState !== 'running') return null
  const eta = formatEta(progress.eta_seconds)
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-accent/40 bg-accent-bg px-2.5 py-1',
        'text-xs font-medium text-accent-text',
      )}
    >
      <Loader2 className="size-3.5 animate-spin" />
      <span>
        生成中 {progress.current}/{progress.total}
      </span>
      {eta && <span className="text-text-3">· ETA {eta}</span>}
      <button
        type="button"
        onClick={onCancel}
        className="ml-1 flex size-5 items-center justify-center rounded text-text-2 transition-colors hover:bg-bg-hover hover:text-text-0"
        aria-label="取消"
        title="取消（不撤销已生成的结果）"
      >
        <X className="size-3" />
      </button>
    </div>
  )
}
