'use client'

/**
 * ImageNode — 通用图片节点（v0.2.0 PR2）
 *
 * 与 PR1.6 ImageNode（已删）的区别：
 *   - 这是 nodeRegistry['image'] 的真正实现，不再统一渲染所有节点
 *   - 单 image 输入 / 单 image 输出（替换语义）
 *   - 没有 storyboard 的全套字段渲染
 */

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Image as ImageIcon, ImagePlus } from 'lucide-react'
import { imageNode } from '@xiaochuang/canvas-shared'

import type { ImageData } from '@/lib/canvas/types'
import { NodeBase } from '../NodeBase'
import { NodeGenerateCta } from '../NodeGenerateCta'

function ImageNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as ImageData
  const url = d.images?.[0]

  return (
    <NodeBase nodeId={id} definition={imageNode} selected={selected} width={208}>
      <div className="overflow-hidden rounded-t-2xl">
        {url ? (
          <img
            src={url}
            alt={d.label || '图片'}
            className="h-32 w-full object-cover"
            loading="lazy"
          />
        ) : (
          // 空态引导（而非"裂图"观感）：双击节点 → 底栏可上传/拖拽图片
          <div className="relative flex h-32 w-full flex-col items-center justify-center gap-2 border-b border-dashed border-border bg-bg-2 text-text-3 transition-colors group-hover:border-accent/50 group-hover:text-accent">
            <ImagePlus className="size-8" />
            <NodeGenerateCta nodeId={id} label="生成画面" compact />
          </div>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="size-3 text-text-3" />
          <span className="truncate text-sm font-medium text-text-0">
            {d.label || '未命名图片'}
          </span>
        </div>
      </div>
    </NodeBase>
  )
}

export const ImageNode = memo(ImageNodeComponent)
