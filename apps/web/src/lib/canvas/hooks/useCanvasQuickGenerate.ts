'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { canvasApi } from '@/lib/canvas/api/canvas'
import { useCanvasStore, useNodesStore } from '@/lib/canvas/store'
import type { CanvasNode } from '@/lib/canvas/types'

export function useCanvasQuickGenerate() {
  const canvasId = useCanvasStore((s) => s.canvasId)
  const addNode = useNodesStore((s) => s.addNode)
  const [running, setRunning] = useState(false)

  const quickGenerate = async (input: {
    prompt: string
    sourceNodeId?: string
    sourceNodeDefId?: string
    position?: { x: number; y: number }
    targetNodeType?: CanvasNode['type']
  }) => {
    if (!canvasId) return null
    setRunning(true)
    try {
      const result = await canvasApi.triggerBusinessAction(canvasId, {
        actionLabel: '构想画面',
        sourceNodeId: input.sourceNodeId,
        sourceNodeDefId: input.sourceNodeDefId,
        userInput: input.prompt,
        output_mode: 'insert_new_node',
        position_x: input.position?.x,
        position_y: input.position?.y,
        target_node_type: input.targetNodeType || 'image',
      })
      if (result.node) {
        addNode(result.node)
      }
      toast.success('已开始生成')
      return result
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '快速生成失败')
      return null
    } finally {
      setRunning(false)
    }
  }

  return { quickGenerate, running }
}
