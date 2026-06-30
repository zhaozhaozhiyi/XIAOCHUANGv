'use client'

/**
 * CharacterNode — 角色卡（v0.2.0 PR2，PRD §8 + nodeRegistry['character']）
 *
 * 圆形头像 + 角色名 + 描述截断。
 * 无输入，1 输出 (character 类型) —— 可连入 TextToSpeech 表示"用这个角色配音"。
 *
 * 右键"关联到分镜" / "换装" / "换表情" → PR3 接业务动作。
 */

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { User } from 'lucide-react'
import { characterNode } from '@xiaochuang/canvas-shared'

import type { CharacterData } from '@/lib/canvas/types'
import { NodeBase } from '../NodeBase'
import { NodeGenerateCta } from '../NodeGenerateCta'

function CharacterNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as CharacterData
  const avatar = d.images?.[0]
  const name = d.name || d.label || '未命名角色'

  return (
    <NodeBase nodeId={id} definition={characterNode} selected={selected} width={192}>
      <div className="flex flex-col items-center gap-2 p-4">
        <div className="size-20 overflow-hidden rounded-full border-2 border-warning bg-bg-2">
          {avatar ? (
            <img
              src={avatar}
              alt={name}
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="relative flex size-full flex-col items-center justify-center gap-2 bg-bg-2">
              <User className="size-10 text-text-3" />
              <NodeGenerateCta nodeId={id} label="生成形象" compact />
            </div>
          )}
        </div>
        <div className="w-full text-center">
          <div className="flex items-center justify-center gap-1 text-xs text-text-3">
            <span>🎭</span>
            <span>角色</span>
          </div>
          <h3 className="mt-1 truncate text-sm font-medium text-text-0">{name}</h3>
          {d.description && (
            <p className="mt-1 line-clamp-2 text-xs text-text-2">{d.description}</p>
          )}
        </div>
      </div>
    </NodeBase>
  )
}

export const CharacterNode = memo(CharacterNodeComponent)
