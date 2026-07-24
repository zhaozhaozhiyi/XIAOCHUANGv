'use client'

import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogHeaderBar,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type ConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  loading = false,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="confirm"
      >
        <DialogHeaderBar variant="confirm">
          <DialogTitle className="font-display text-lg font-semibold text-text-0">{title}</DialogTitle>
          <DialogDescription className="mt-1.5 text-sm leading-6 text-text-2">{description}</DialogDescription>
        </DialogHeaderBar>
        <DialogActions variant="confirm">
          <Button type="button" variant="ghost" disabled={loading} onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={loading}
            onClick={() => {
              void onConfirm()
            }}
          >
            {confirmLabel}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  )
}
