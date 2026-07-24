'use client'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { X } from 'lucide-react'

interface ImageViewerProps {
  open: boolean
  src: string
  title?: string
  onClose: () => void
}

export function ImageViewer({ open, src, title, onClose }: ImageViewerProps) {
  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent
        variant="media"
      >
        <DialogTitle className="sr-only">{title || '图片预览'}</DialogTitle>
        <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
          <div className="flex max-h-[min(92dvh,900px)] w-[min(1100px,calc(100vw-2rem))] flex-col overflow-hidden rounded-[var(--radius-xl)] shadow-shadow-xl">
            <div className="flex items-center justify-between border-b border-border bg-bg-surface/95 px-6 py-4 backdrop-blur-sm sm:px-8 sm:py-4">
              <span className="font-display pr-4 text-base font-bold text-text-0">{title || '图片预览'}</span>
              <button
                type="button"
                onClick={onClose}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-text-2 transition-colors hover:bg-bg-hover hover:text-text-0"
                aria-label="关闭预览"
                title="关闭"
              >
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/65 p-6 backdrop-blur-sm sm:p-8">
              {src ? (
                <img
                  src={src}
                  alt={title}
                  className="max-h-[min(78dvh,760px)] max-w-full rounded-[var(--radius-md)] object-contain shadow-shadow-xl"
                />
              ) : (
                <div className="text-sm text-white/80">暂无可预览图片</div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
