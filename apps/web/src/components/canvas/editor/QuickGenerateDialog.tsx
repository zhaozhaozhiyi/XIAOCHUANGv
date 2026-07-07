'use client'

import { useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogActions, DialogContent, DialogHeaderBar, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { useCanvasQuickGenerate } from '@/lib/canvas/hooks/useCanvasQuickGenerate'
import { useNodesStore } from '@/lib/canvas/store'
import type { CanvasNode } from '@/lib/canvas/types'

export function QuickGenerateDialog({
  open,
  onOpenChange,
  sourceNodeId,
  sourceNodeDefId,
  position,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceNodeId?: string
  sourceNodeDefId?: string
  position?: { x: number; y: number } | null
}) {
  const [prompt, setPrompt] = useState('')
  const { quickGenerate, running } = useCanvasQuickGenerate()
  const reactFlow = useReactFlow<CanvasNode>()
  const nodes = useNodesStore((s) => s.nodes)

  const resolveInsertPosition = () => {
    const source = sourceNodeId ? nodes.find((item) => item.id === sourceNodeId) : null
    if (source) {
      return {
        x: source.position.x + (typeof source.width === 'number' ? source.width : 260) + 80,
        y: source.position.y,
      }
    }
    if (position) return position
    if (typeof window !== 'undefined') {
      return reactFlow.screenToFlowPosition({
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      })
    }
    return { x: 220, y: 220 }
  }

  const handleSubmit = async () => {
      const result = await quickGenerate({
        prompt,
        sourceNodeId,
        sourceNodeDefId,
        position: resolveInsertPosition(),
        targetNodeType: 'image',
      })
    if (result) {
      setPrompt('')
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="form" size="standard">
        <DialogHeaderBar variant="form">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-accent" />
            快速生成
          </DialogTitle>
        </DialogHeaderBar>
        <DialogMain variant="form">
          <Textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            placeholder="描述要生成的画面，也可以留空先创建占位结果"
          />
        </DialogMain>
        <DialogActions variant="form">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" onClick={handleSubmit} disabled={running}>
            {running ? '生成中' : '开始生成'}
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  )
}
