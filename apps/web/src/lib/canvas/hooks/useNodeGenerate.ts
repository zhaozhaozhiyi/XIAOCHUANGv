'use client'

import { useCallback } from 'react'
import { toast } from 'sonner'
import {
  nodeRegistry,
  resolveBusinessActions,
  type ResolvedBusinessAction,
} from '@xiaochuang/canvas-shared'

import { canvasApi } from '@/lib/canvas/api/canvas'
import { useCanvasStore, useNodesStore, useUiStore } from '@/lib/canvas/store'
import { usePipelineStore } from '@/lib/canvas/store/pipelineStore'
import {
  defaultPromptForNode,
  isGeneratableNodeType,
  resolveDefaultGenerateAction,
} from '@/lib/canvas/utils/nodeGenerate'
import type { FlowNode } from '@/lib/canvas/store'

import { useRunPolling } from './useRunPolling'

type GenerateContext = 'storyboard' | 'character' | 'scene'

const TYPE_TO_CTX: Record<string, GenerateContext> = {
  storyboard: 'storyboard',
  image: 'storyboard',
  character: 'character',
  scene: 'scene',
}

function resolveActionByLabel(node: FlowNode, label: string): ResolvedBusinessAction | null {
  const ctx = TYPE_TO_CTX[node.type ?? '']
  if (!ctx) return null
  return resolveBusinessActions(nodeRegistry, ctx).find((a) => a.label === label) ?? null
}

export function useNodeGenerate() {
  const runPolling = useRunPolling()

  const executeGenerate = useCallback(
    async (params: {
      nodeId: string
      action: ResolvedBusinessAction
      userInput: string
      style?: string
    }) => {
      const canvasId = useCanvasStore.getState().canvasId
      if (!canvasId) return false

      const trimmed = params.userInput.trim()
      if (!trimmed) {
        toast.info('请填写描述内容')
        return false
      }

      try {
        const result = await canvasApi.triggerBusinessAction(canvasId, {
          actionLabel: params.action.label,
          sourceNodeId: params.nodeId,
          sourceNodeDefId: params.action.sourceNodeDefId,
          userInput: trimmed,
          style: params.style,
        })
        useCanvasStore.getState().markEditing()
        runPolling.start(result.hidden_node_id)
        toast.success(`已开始 ${params.action.label}`)
        return true
      } catch (err) {
        toast.error('触发失败', { description: (err as Error)?.message })
        return false
      }
    },
    [runPolling],
  )

  /** 打开检视面板并进入业务动作模式（可编辑 prompt 后点生成） */
  const openGenerate = useCallback((nodeId: string, actionLabel?: string) => {
    const node = useNodesStore.getState().nodes.find((n) => n.id === nodeId)
    if (!node || !isGeneratableNodeType(node.type)) {
      toast.info('此节点不支持生成')
      return
    }

    const action =
      (actionLabel ? resolveActionByLabel(node, actionLabel) : null) ??
      resolveDefaultGenerateAction(node)

    if (!action) {
      toast.info('此节点暂无可用生成动作')
      return
    }

    usePipelineStore.getState().setRailOpen(true)
    useUiStore.getState().setPendingAction({ action, sourceNodeId: nodeId })
  }, [])

  /** 用节点已有描述直接触发生成（检视面板 / 节点 CTA 一键生成） */
  const generateFromNode = useCallback(
    async (nodeId: string, userInput?: string, style?: string) => {
      const node = useNodesStore.getState().nodes.find((n) => n.id === nodeId)
      if (!node) return false

      const action = resolveDefaultGenerateAction(node)
      if (!action) {
        toast.info('此节点不支持生成')
        return false
      }

      const prompt = (userInput ?? defaultPromptForNode(node)).trim()
      if (!prompt) {
        openGenerate(nodeId)
        toast.info('请先填写描述，再点生成')
        return false
      }

      return executeGenerate({ nodeId, action, userInput: prompt, style })
    },
    [executeGenerate, openGenerate],
  )

  return { openGenerate, generateFromNode, executeGenerate }
}
