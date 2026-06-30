'use client'

/**
 * TextToImageNode — 画面构想（v0.2.0 PR2，nodeRegistry['text-to-image']）
 *
 * 端口：prompt(text, required) + references(image[], 可多连) → image
 * 业务动作（PR3 接入）：构想画面 / 换装 / 换表情 / 换时段 / 换天气
 * 隐藏节点模式：右键节点上"构想画面" → 创建本节点 hidden:true，结果回填到原节点
 */

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Palette } from 'lucide-react'
import { textToImageNode } from '@xiaochuang/canvas-shared'

import type { ImageData } from '@/lib/canvas/types'
import { NodeBase } from '../NodeBase'

function TextToImageNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as ImageData & { prompt?: string; style?: string; aspectRatio?: string }
  const result = d.images?.[0]

  return (
    <NodeBase nodeId={id} definition={textToImageNode} selected={selected} width={224}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-base">🎨</span>
        <span className="text-sm font-medium text-text-0">画面构想</span>
      </div>

      {/* 结果预览（如果有） */}
      {result ? (
        <div className="overflow-hidden">
          <img
            src={result}
            alt="生成结果"
            className="h-32 w-full object-cover"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="flex h-32 w-full items-center justify-center bg-bg-2">
          <Palette className="size-8 text-text-3" />
        </div>
      )}

      {/* prompt 预览 */}
      <div className="px-3 py-2 text-xs">
        {d.prompt ? (
          <p className="line-clamp-2 text-text-2">{d.prompt}</p>
        ) : (
          <p className="text-text-3 italic">未填写描述</p>
        )}
        {(d.style || d.aspectRatio) && (
          <div className="mt-1.5 flex items-center gap-1">
            {d.style && <Tag>{d.style}</Tag>}
            {d.aspectRatio && <Tag>{d.aspectRatio}</Tag>}
          </div>
        )}
      </div>
    </NodeBase>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-bg-2 px-1.5 py-0.5 text-[10px] text-text-2">
      {children}
    </span>
  )
}

export const TextToImageNode = memo(TextToImageNodeComponent)
