'use client'

import { useState } from 'react'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogActions, DialogContent, DialogHeader, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useCanvasQuickGenerate } from '@/lib/canvas/hooks/useCanvasQuickGenerate'

export function QuickGenerateDialog({
  open,
  onOpenChange,
  sourceNodeId,
  sourceNodeDefId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceNodeId?: string
  sourceNodeDefId?: string
}) {
  const [prompt, setPrompt] = useState('')
  const { quickGenerate, running } = useCanvasQuickGenerate()

  const handleSubmit = async () => {
    const result = await quickGenerate({
      prompt,
      sourceNodeId,
      sourceNodeDefId,
      position: { x: 220, y: 220 },
      targetNodeType: 'image',
    })
    if (result) {
      setPrompt('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="standard" layout="panel">
        <DialogHeader className="border-b border-border px-6 py-5">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-accent" />
            快速生成
          </DialogTitle>
        </DialogHeader>
        <DialogMain density="compact">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="描述要生成的画面，也可以留空先创建占位结果"
          />
        </DialogMain>
        <DialogActions density="compact">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" onClick={handleSubmit} disabled={running}>
            {running ? '生成中' : '开始生成'}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  )
}
