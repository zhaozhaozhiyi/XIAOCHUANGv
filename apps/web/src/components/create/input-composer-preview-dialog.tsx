'use client'

import { X } from 'lucide-react'

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

export function InputComposerPreviewDialog(props: {
  open: boolean
  referencePreviewUrl: string
  referencePreviewTitle: string
  isPreviewVideo: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent showCloseButton={false} className="h-[100dvh] w-[100vw] max-w-none overflow-hidden border-0 bg-transparent p-0 shadow-none">
        <DialogTitle className="sr-only">
          {props.referencePreviewTitle || (props.isPreviewVideo ? '视频预览' : '图片预览')}
        </DialogTitle>
        <button
          type="button"
          onClick={() => props.onOpenChange(false)}
          className="fixed right-4 top-4 z-50 inline-flex size-8 items-center justify-center rounded-sm border border-white/25 bg-black/25 text-white/90 transition-colors hover:bg-black/45 hover:text-white sm:right-6 sm:top-6"
          aria-label="关闭预览"
          title="关闭"
        >
          <X size={14} aria-hidden />
        </button>
        <div className="flex h-full w-full items-center justify-center">
          {props.isPreviewVideo && props.referencePreviewUrl ? (
            <video
              src={props.referencePreviewUrl}
              controls
              className="max-h-[100dvh] max-w-[100vw] rounded-[8px] bg-black object-contain shadow-[0_22px_48px_rgba(0,0,0,0.4)]"
            />
          ) : props.referencePreviewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={props.referencePreviewUrl}
              alt={props.referencePreviewTitle || '图片预览'}
              className="max-h-[100dvh] max-w-[100vw] rounded-[8px] object-contain shadow-[0_22px_48px_rgba(0,0,0,0.4)]"
            />
          ) : (
            <div className="text-sm text-white/80">暂无可预览内容</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
