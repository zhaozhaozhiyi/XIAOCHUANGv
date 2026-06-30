'use client'

/**
 * TextToSpeechNode — 角色配音（v0.2.0 PR2，nodeRegistry['text-to-speech']）
 *
 * 端口：text(required) + character(required) → audio
 * 业务动作（PR3）：配音
 * 智能默认：如果分镜关联了角色卡且该角色有 voiceId，自动选择对应声源
 */

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Mic, Volume2 } from 'lucide-react'
import { textToSpeechNode } from '@xiaochuang/canvas-shared'

import { NodeBase } from '../NodeBase'

interface TextToSpeechData {
  text?: string
  characterName?: string
  speed?: number
  pitch?: number
  audioUrl?: string
}

function TextToSpeechNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as TextToSpeechData

  return (
    <NodeBase nodeId={id} definition={textToSpeechNode} selected={selected} width={224}>
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-base">🎤</span>
        <span className="text-sm font-medium text-text-0">角色配音</span>
      </div>

      <div className="space-y-2 p-3">
        {/* 角色 + 音频指示 */}
        <div className="flex items-center gap-2 rounded-md border border-border bg-bg-2 px-2 py-1.5">
          <div className="flex size-8 items-center justify-center rounded-full bg-warning-bg">
            {d.audioUrl ? (
              <Volume2 className="size-4 text-warning" />
            ) : (
              <Mic className="size-4 text-text-3" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-text-0">
              {d.characterName || '未指定角色'}
            </p>
            <p className="text-[10px] text-text-3">
              {d.audioUrl ? '配音已生成' : '等待生成'}
            </p>
          </div>
        </div>

        {/* 台词 */}
        {d.text ? (
          <p className="line-clamp-3 text-xs text-text-2">{d.text}</p>
        ) : (
          <p className="text-xs italic text-text-3">未填写台词</p>
        )}

        {/* 参数 */}
        {(d.speed !== undefined || d.pitch !== undefined) && (
          <div className="flex items-center gap-1.5 text-[10px] text-text-3">
            {d.speed !== undefined && <span>速度 {d.speed.toFixed(1)}x</span>}
            {d.pitch !== undefined && <span>音调 {d.pitch}</span>}
          </div>
        )}
      </div>
    </NodeBase>
  )
}

export const TextToSpeechNode = memo(TextToSpeechNodeComponent)
