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
        showCloseButton={false}
        className="max-h-[min(calc(100vh-2rem),calc(100dvh-2rem))] max-w-[min(1100px,calc(100%-2rem))] gap-0 overflow-hidden border-0 bg-transparent p-3 shadow-none sm:p-5"
      >
        <DialogTitle className="sr-only">{title || '图片预览'}</DialogTitle>
        <div className="flex items-center justify-between border-b border-border bg-bg-surface/95 px-6 py-4 backdrop-blur-sm sm:px-8 sm:py-4 rounded-t-[var(--radius-xl)]">
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
        <div className="flex max-h-[min(72dvh,calc(100dvh-12rem))] items-center justify-center overflow-auto rounded-b-[var(--radius-xl)] bg-black/65 p-6 backdrop-blur-sm sm:p-8">
          {src ? (
            <img
              src={src}
              alt={title}
              className="max-h-[min(72dvh,calc(100dvh-14rem))] max-w-full rounded-[var(--radius-md)] object-contain shadow-shadow-xl"
            />
          ) : (
            <div className="text-sm text-white/80">暂无可预览图片</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
