'use client'

/**
 * AddNodeSubmenu — 添加节点子菜单（v0.2.0 PR3）
 *
 * 从 nodeRegistry 拿 v0.2.0 全部 10 节点，按 category 分组。
 * 用于：
 *   - CanvasContextMenu "添加节点 ▸" 子菜单
 *   - LeftToolbar "+" 按钮的 popover
 *
 * 创建逻辑：在指定 flow position 处加节点，标记 editing；
 * character / scene 节点禁用（需要资产库引用，v0.2.0 仅占位 toast）。
 */

import { useCallback } from 'react'
import { useReactFlow, type XYPosition } from '@xyflow/react'
import { listAvailableNodes, type CanvasNodeDefinition } from '@xiaochuang/canvas-shared'
import { toast } from 'sonner'

import { cn } from '@/lib/cn'
import { useCanvasStore, useHistoryStore, useNodesStore, useUiStore } from '@/lib/canvas/store'
import { cryptoRandomId, findFreePosition } from './_utils'

interface AddNodeSubmenuProps {
  /** 创建位置：'screen-center' 默认；或显式 flow 坐标 */
  position?: XYPosition | 'screen-center'
  onCreated?: () => void
  /** 渲染样式：菜单项列表（嵌入 ContextMenuSub）或独立 popover */
  variant?: 'menu' | 'popover'
}

/** 节点 type → 默认 data 模板 */
const DEFAULT_DATA: Record<string, Record<string, unknown>> = {
  storyboard: { shotIndex: 1, title: '新分镜', shotDescription: '', duration: 5 },
  note: { text: '新便签', color: 'yellow' },
  image: { label: '', images: [] },
  character: { name: '新角色' },
  scene: { name: '新场景' },
  'text-to-image': { prompt: '', style: 'realistic' },
  'image-to-video': { motion: '', duration: '5' },
  'text-to-speech': { text: '' },
  concat: {},
  export: { resolution: '1080p', codec: 'h264' },
}

/** 需要资产库引用的节点（PR3 暂禁，PR4 / v0.2.1 接入资产库后开放） */
const REQUIRES_ASSET = new Set(['character', 'scene'])
const DEFERRED_NODE_TYPES = new Set(['note', 'export'])

export function AddNodeSubmenu({
  position = 'screen-center',
  onCreated,
  variant = 'menu',
}: AddNodeSubmenuProps) {
  const reactFlow = useReactFlow()
  const addNode = useNodesStore((s) => s.addNode)
  const markEditing = useCanvasStore((s) => s.markEditing)
  const historyPush = useHistoryStore((s) => s.push)
  const setSelectedNodeId = useUiStore((s) => s.setSelectedNodeId)

  const allNodes = listAvailableNodes('v0.2.0')
  const visibleNodes = allNodes.filter((node) => !DEFERRED_NODE_TYPES.has(node.id))
  const content = visibleNodes.filter((n) => n.category === 'content')
  const execute = visibleNodes.filter((n) => n.category === 'execute')

  const handleCreate = useCallback(
    (def: CanvasNodeDefinition) => {
      if (REQUIRES_ASSET.has(def.id)) {
        toast.info(`${def.businessName}`, {
          description: '需要从资产库拖入，v0.2.1 开放',
        })
        return
      }
      const flowPos: XYPosition =
        position === 'screen-center'
          ? reactFlow.screenToFlowPosition({
              x: typeof window !== 'undefined' ? window.innerWidth / 2 : 600,
              y: typeof window !== 'undefined' ? window.innerHeight / 2 : 400,
            })
          : position
      historyPush()
      const id = `node_${cryptoRandomId()}`
      const nodePosition = findFreePosition(
        { x: flowPos.x - 96, y: flowPos.y - 96 },
        useNodesStore.getState().nodes,
      )
      addNode({
        id,
        type: def.id,
        position: nodePosition,
        data: { ...(DEFAULT_DATA[def.id] ?? {}) },
      })
      markEditing()
      setSelectedNodeId(id)
      onCreated?.()
    },
    [addNode, historyPush, markEditing, onCreated, position, reactFlow, setSelectedNodeId],
  )

  const container =
    variant === 'menu'
      ? 'flex flex-col gap-0.5'
      : 'flex w-56 flex-col gap-0.5 rounded-lg border border-border bg-popover p-1 shadow-default'

  return (
    <div className={container}>
      <Group label="内容节点">
        {content.map((def) => (
          <Row
            key={def.id}
            def={def}
            disabled={REQUIRES_ASSET.has(def.id)}
            onClick={() => handleCreate(def)}
          />
        ))}
      </Group>
      <div className="my-1 h-px bg-border" />
      <Group label="执行节点">
        {execute.map((def) => (
          <Row key={def.id} def={def} onClick={() => handleCreate(def)} />
        ))}
      </Group>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-3">
        {label}
      </div>
      {children}
    </div>
  )
}

function Row({
  def,
  disabled,
  onClick,
}: {
  def: CanvasNodeDefinition
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        disabled
          ? 'cursor-not-allowed text-text-3'
          : 'text-text-0 hover:bg-bg-hover focus:bg-bg-hover focus:outline-none',
      )}
      title={def.description}
    >
      <span className="text-base">{def.icon}</span>
      <span className="flex-1 truncate">{def.businessName}</span>
      {disabled && <span className="text-[10px] text-text-3">v0.2.1</span>}
    </button>
  )
}
