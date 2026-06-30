'use client'

/**
 * NoteNode — 便签节点（v0.2.0 PR2，PRD §8.2）
 *
 * 暖纸色，可缩放（v0.2.0 用 max-w 软上限，PR3+ 加 NodeResizer）。
 * 无端口（noteNode definition.inputs/outputs 为空数组），NodeBase 不渲染 Handle。
 */

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { StickyNote } from 'lucide-react'
import { noteNode } from '@xiaochuang/canvas-shared'

import type { NoteData } from '@/lib/canvas/types'
import { NodeBase } from '../NodeBase'

const STICKY_COLOR_VARS: Record<string, string> = {
  yellow: 'var(--canvas-sticky-yellow)',
  blue: 'var(--canvas-sticky-blue)',
  pink: 'var(--canvas-sticky-pink)',
  green: 'var(--canvas-sticky-green)',
}

function NoteNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as NoteData
  const bg = d.color
    ? STICKY_COLOR_VARS[d.color] ?? d.color
    : 'var(--canvas-sticky-yellow)'

  return (
    <NodeBase
      nodeId={id}
      definition={noteNode}
      selected={selected}
      width={240}
      className="min-w-[200px] max-w-[300px] !bg-transparent !border-transparent !shadow-none"
    >
      <div
        className="rounded-2xl px-4 py-3 text-[var(--canvas-sticky-text)] shadow-default"
        style={{ backgroundColor: bg }}
      >
        <div className="mb-1.5 flex items-center gap-1.5 text-xs opacity-70">
          <StickyNote className="size-3" />
          <span>便签</span>
        </div>
        <div className="whitespace-pre-wrap break-words text-sm">
          {d.text || '空便签'}
        </div>
      </div>
    </NodeBase>
  )
}

export const NoteNode = memo(NoteNodeComponent)
