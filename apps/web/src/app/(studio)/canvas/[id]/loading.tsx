import { Loader2 } from 'lucide-react'

export default function CanvasEditorLoading() {
  return (
    <div className="flex h-full items-center justify-center text-text-3">
      <Loader2 size={28} className="animate-spin" />
    </div>
  )
}
