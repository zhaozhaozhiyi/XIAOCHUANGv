'use client'

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Headphones, Music2 } from 'lucide-react'

import { NodeBase } from '../NodeBase'

interface AudioData {
  title?: string
  label?: string
  url?: string
  provider?: string
}

function AudioNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as AudioData
  const title = d.title || d.label || '未命名音频'

  return (
    <NodeBase
      nodeId={id}
      definition={{
        id: 'audio',
        businessName: '音频资产',
        displayName: '音频资产',
        category: 'content',
        width: 224,
        ports: [
          { id: 'audio_out', type: 'audio', direction: 'output', label: '音频' },
        ],
      } as never}
      selected={selected}
      width={224}
    >
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-base">🎧</span>
        <span className="text-sm font-medium text-text-0">音频资产</span>
      </div>

      <div className="space-y-3 p-3">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-bg-2 px-3 py-3">
          <div className="flex size-11 items-center justify-center rounded-full bg-accent-bg text-accent">
            {d.url ? <Headphones className="size-5" /> : <Music2 className="size-5" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-0">{title}</p>
            <p className="truncate text-[11px] text-text-3">{d.provider || '音频资源'}</p>
          </div>
        </div>

        {d.url ? (
          <audio src={d.url} controls className="w-full" preload="metadata" />
        ) : (
          <p className="text-xs italic text-text-3">当前音频还没有可播放地址</p>
        )}
      </div>
    </NodeBase>
  )
}

export const AudioNode = memo(AudioNodeComponent)
