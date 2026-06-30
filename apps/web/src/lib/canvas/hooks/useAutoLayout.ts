'use client'

import { useCallback } from 'react'
import { useReactFlow } from '@xyflow/react'
import { toast } from 'sonner'

import {
  useCanvasStore,
  useEdgesStore,
  useHistoryStore,
  useNodesStore,
} from '@/lib/canvas/store'
import { usePipelineStore } from '@/lib/canvas/store/pipelineStore'
import { getCanvasFitPadding, layoutCanvasNodes } from '@/lib/canvas/utils/autoLayout'

export function useAutoLayout() {
  const reactFlow = useReactFlow()
  const chatOpen = usePipelineStore((s) => s.chatOpen)
  const railOpen = usePipelineStore((s) => s.railOpen)

  const fitWithPanels = useCallback(() => {
    requestAnimationFrame(() => {
      reactFlow.fitView({
        duration: 400,
        padding: getCanvasFitPadding({
          chatOpen,
          railOpen,
        }),
      })
    })
  }, [chatOpen, railOpen, reactFlow])

  const applyAutoLayout = useCallback(
    (options?: { silent?: boolean; fitView?: boolean }) => {
      const nodesState = useNodesStore.getState()
      const edgesState = useEdgesStore.getState()
      const nodes = nodesState.nodes

      if (!nodes.length) {
        if (!options?.silent) toast.info('画布上没有节点')
        return false
      }

      useHistoryStore.getState().push()
      const positions = layoutCanvasNodes(nodes, edgesState.edges)
      nodesState.replaceAll(
        nodes.map((node) => ({
          ...node,
          position: positions.get(node.id) ?? node.position,
        })),
      )
      useCanvasStore.getState().markEditing()

      if (options?.fitView !== false) {
        fitWithPanels()
      }

      if (!options?.silent) {
        toast.success('已自动整理布局', { description: `${nodes.length} 个节点已展开排列` })
      }
      return true
    },
    [fitWithPanels],
  )

  return { applyAutoLayout, fitWithPanels }
}
