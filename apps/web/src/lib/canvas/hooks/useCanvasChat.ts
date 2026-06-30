'use client'

import { useState } from 'react'
import { toast } from 'sonner'

import { canvasApi } from '@/lib/canvas/api/canvas'
import { useCanvasChatStore, useCanvasStore, useNodesStore, useUiStore } from '@/lib/canvas/store'
import type { CanvasNode } from '@/lib/canvas/types'
import type { CanvasChatMessage } from '@/lib/canvas/store'

function id() {
  return `msg_${Math.random().toString(36).slice(2, 10)}`
}

function isCanvasNode(value: unknown): value is CanvasNode {
  return Boolean(value && typeof value === 'object' && 'id' in value && 'type' in value && 'position' in value)
}

export function useCanvasChat() {
  const canvasId = useCanvasStore((s) => s.canvasId)
  const selectedNodeId = useUiStore((s) => s.selectedNodeId)
  const nodes = useNodesStore((s) => s.nodes)
  const addNode = useNodesStore((s) => s.addNode)
  const updateNodeData = useNodesStore((s) => s.updateNodeData)
  const messages = useCanvasChatStore((s) => s.messages)
  const pendingPlan = useCanvasChatStore((s) => s.pendingPlan)
  const addMessage = useCanvasChatStore((s) => s.addMessage)
  const setPendingPlan = useCanvasChatStore((s) => s.setPendingPlan)
  const [running, setRunning] = useState(false)

  const ingestOutputs = (outputs: unknown[] = []) => {
    for (const output of outputs) {
      if (!isCanvasNode(output)) continue
      if (nodes.some((node) => node.id === output.id)) {
        updateNodeData(output.id, output.data || {})
      } else {
        addNode(output)
      }
    }
  }

  const send = async (text: string) => {
    if (!canvasId) return
    const message = text.trim()
    if (!message || running) return
    addMessage({ id: id(), role: 'user', text: message })
    setRunning(true)
    try {
      const events = await canvasApi.chat(canvasId, {
        message,
        selected_node_ids: selectedNodeId ? [selectedNodeId] : [],
      })
      for (const event of events) {
        if (event.type === 'plan') {
          setPendingPlan(event.plan)
          addMessage({ id: id(), role: 'assistant', text: event.plan.summary || event.plan.title, event })
          continue
        }
        if (event.type === 'skill_result') {
          ingestOutputs(event.outputs)
        }
        addMessage({ id: id(), role: 'assistant', text: event.content, event })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '对话执行失败')
    } finally {
      setRunning(false)
    }
  }

  const confirmPlan = async () => {
    if (!canvasId || !pendingPlan) return
    setRunning(true)
    try {
      const outputs = await canvasApi.applyChatPlan(canvasId, pendingPlan)
      ingestOutputs(outputs)
      addMessage({ id: id(), role: 'assistant', text: '已执行计划。' })
      setPendingPlan(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '计划执行失败')
    } finally {
      setRunning(false)
    }
  }

  return { messages, pendingPlan, running, send, confirmPlan, cancelPlan: () => setPendingPlan(null) }
}
