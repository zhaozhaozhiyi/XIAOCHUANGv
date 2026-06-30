'use client'

/**
 * SceneNode — 场景卡（v0.2.0 PR2，nodeRegistry['scene']）
 *
 * 16:9 场景图 + 场景名 + 描述截断。
 * 无输入，1 输出 (scene 类型)。
 *
 * 右键"设为分镜背景" / "换时段" / "换天气" → PR3 接业务动作。
 */

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { ImageIcon, MapPin } from 'lucide-react'
import { sceneNode } from '@xiaochuang/canvas-shared'

import type { SceneData } from '@/lib/canvas/types'
import { NodeBase } from '../NodeBase'
import { NodeGenerateCta } from '../NodeGenerateCta'

function SceneNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as SceneData
  const img = d.images?.[0]
  const name = d.name || d.label || '未命名场景'

  return (
    <NodeBase nodeId={id} definition={sceneNode} selected={selected} width={224}>
      <div className="overflow-hidden rounded-t-2xl">
        {img ? (
          <img
            src={img}
            alt={name}
            className="aspect-video w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="relative flex aspect-video w-full flex-col items-center justify-center gap-2 bg-bg-2">
            <ImageIcon className="size-9 text-text-3" />
            <NodeGenerateCta nodeId={id} label="生成场景" compact />
          </div>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs text-text-3">
          <MapPin className="size-3" />
          <span>场景</span>
        </div>
        <h3 className="mt-1 truncate text-sm font-medium text-text-0">{name}</h3>
        {d.description && (
          <p className="mt-1 line-clamp-2 text-xs text-text-2">{d.description}</p>
        )}
      </div>
    </NodeBase>
  )
}

export const SceneNode = memo(SceneNodeComponent)
