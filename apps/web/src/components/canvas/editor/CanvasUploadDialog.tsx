'use client'

import { useMemo, useState } from 'react'
import { Upload } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogActions, DialogContent, DialogHeaderBar, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { canvasApi } from '@/lib/canvas/api/canvas'
import { useCanvasStore, useNodesStore } from '@/lib/canvas/store'

const MB = 1024 * 1024

const UPLOAD_POLICIES = [
  { kind: 'image', maxBytes: 30 * MB, mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], extensions: ['.png', '.jpg', '.jpeg', '.webp', '.gif'], label: '图片' },
  { kind: 'video', maxBytes: 200 * MB, mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'], extensions: ['.mp4', '.webm', '.mov'], label: '视频' },
  { kind: 'audio', maxBytes: 100 * MB, mimeTypes: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a', 'audio/webm'], extensions: ['.mp3', '.wav', '.m4a', '.aac', '.webm'], label: '声音' },
] as const

function formatBytes(bytes: number) {
  if (bytes >= MB) return `${(bytes / MB).toFixed(bytes % MB === 0 ? 0 : 1)}MB`
  return `${Math.max(1, Math.round(bytes / 1024))}KB`
}

function resolvePolicy(file: File | null) {
  if (!file) return null
  const mime = file.type.split(';')[0].toLowerCase()
  const lowerName = file.name.toLowerCase()
  return UPLOAD_POLICIES.find((policy) => (
    policy.mimeTypes.includes(mime as never) || policy.extensions.some((extension) => lowerName.endsWith(extension))
  )) || null
}

export function CanvasUploadDialog({
  open,
  onOpenChange,
  position,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  position?: { x: number; y: number } | null
}) {
  const canvasId = useCanvasStore((s) => s.canvasId)
  const addNode = useNodesStore((s) => s.addNode)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [saveToAssets, setSaveToAssets] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const policy = useMemo(() => resolvePolicy(file), [file])
  const fileError = useMemo(() => {
    if (!file) return ''
    if (!policy) return '仅支持 PNG、JPG、WEBP、GIF、MP4、WEBM、MOV、MP3、WAV、M4A'
    if (file.size > policy.maxBytes) return `${policy.label}文件不能超过 ${formatBytes(policy.maxBytes)}`
    return ''
  }, [file, policy])

  const handleSubmit = async () => {
    if (!canvasId || !file) return
    if (fileError) {
      toast.error(fileError)
      return
    }
    setSubmitting(true)
    try {
      const form = new FormData()
      form.set('file', file)
      form.set('title', title.trim() || file.name)
      form.set('save_to_assets', String(saveToAssets))
      form.set('position_x', String(Math.round(position?.x ?? 180)))
      form.set('position_y', String(Math.round(position?.y ?? 180)))
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
      <DialogContent variant="form" size="compact">
        <DialogHeaderBar variant="form">
          <DialogTitle className="text-base">上传到画布</DialogTitle>
        </DialogHeaderBar>
        <DialogMain variant="form" className="gap-4">
          <label className="flex cursor-pointer flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-bg-1 px-4 py-8 text-center transition-colors hover:border-border-strong">
            <Upload className="size-6 text-text-2" />
            <span className="text-sm text-text-1">{file ? file.name : '选择图片、视频或音频'}</span>
            {file ? (
              <span className={fileError ? 'text-xs text-error' : 'text-xs text-text-3'}>
                {fileError || `${policy?.label || '文件'} · ${formatBytes(file.size)}`}
              </span>
            ) : (
              <span className="text-xs text-text-3">图片 30MB 内，视频 200MB 内，声音 100MB 内</span>
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/webm"
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
        <DialogActions variant="form">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" onClick={handleSubmit} disabled={!file || Boolean(fileError) || submitting}>
            {submitting ? '上传中' : '上传'}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  )
}
