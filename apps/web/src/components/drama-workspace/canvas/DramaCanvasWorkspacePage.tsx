'use client'

import { AlertCircle, Loader2 } from 'lucide-react'

import { CanvasPanel } from '../sections/CanvasPanel'
import { useDramaWorkspace } from '../use-drama-workspace'

export function DramaCanvasWorkspacePage({ dramaId }: { dramaId: number }) {
  const { data, loading, error, refresh } = useDramaWorkspace(dramaId)

  if (loading && !data) {
    return (
      <div className="drama-workspace-state" role="status">
        <Loader2 size={22} className="animate-spin" />
        <span>正在准备画布</span>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="drama-workspace-state" role="alert">
        <AlertCircle size={22} />
        <span>{error}</span>
        <button type="button" onClick={() => void refresh()}>重试</button>
      </div>
    )
  }

  return data ? <CanvasPanel dramaId={dramaId} data={data} /> : null
}
