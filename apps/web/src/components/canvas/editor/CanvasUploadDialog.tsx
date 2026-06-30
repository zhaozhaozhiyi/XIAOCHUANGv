'use client'

import { useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogActions, DialogContent, DialogHeader, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { canvasApi } from '@/lib/canvas/api/canvas'
import { useCanvasStore, useNodesStore } from '@/lib/canvas/store'

export function CanvasUploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const canvasId = useCanvasStore((s) => s.canvasId)
  const addNode = useNodesStore((s) => s.addNode)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [saveToAssets, setSaveToAssets] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (!canvasId || !file) return
    setSubmitting(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('title', title.trim() || file.name)
      form.set('save_to_assets', String(saveToAssets))
      form.set('position_x', '180')
      form.set('position_y', '180')
      const result = await canvasApi.upload(canvasId, form)
      addNode(result.node)
      toast.success(saveToAssets ? '已上传并保存到资产' : '已上传到画布')
      onOpenChange(false)
      setFile(null)
      setTitle('')
      setSaveToAssets(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="compact" layout="panel">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="text-base">上传到画布</DialogTitle>
        </DialogHeader>
        <DialogMain density="compact">
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-bg-1 px-4 py-8 text-center transition-colors hover:border-border-strong">
            <Upload className="size-6 text-text-2" />
            <span className="text-sm text-text-1">{file ? file.name : '选择图片、视频或音频'}</span>
            <input
              type="file"
              accept="image/*,video/*,audio/*"
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="标题"
          />
          <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
            <span className="text-sm text-text-1">同步保存到资产库</span>
            <Switch checked={saveToAssets} onCheckedChange={setSaveToAssets} />
          </label>
        </DialogMain>
        <DialogActions density="compact">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" onClick={handleSubmit} disabled={!file || submitting}>
            {submitting ? '上传中' : '上传'}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  )
}
