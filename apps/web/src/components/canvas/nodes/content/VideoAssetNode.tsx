'use client'

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Film, PlayCircle } from 'lucide-react'

import { NodeBase } from '../NodeBase'

interface VideoAssetData {
  title?: string
  label?: string
  videoUrl?: string
  thumbnailUrl?: string
  provider?: string
}

function VideoAssetNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as VideoAssetData
  const title = d.title || d.label || '未命名视频'

  return (
    <NodeBase
      nodeId={id}
      definition={{
        id: 'video-asset',
        businessName: '视频资产',
        displayName: '视频资产',
        category: 'content',
        width: 240,
        outputs: [
          { name: 'video', label: '视频', type: 'video' },
        ],
      } as never}
      selected={selected}
      width={240}
    >
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-base">🎬</span>
        <span className="text-sm font-medium text-text-0">视频资产</span>
      </div>

      <div className="overflow-hidden rounded-b-2xl">
        <div className="relative aspect-video bg-bg-2">
          {d.thumbnailUrl ? (
            <img src={d.thumbnailUrl} alt={title} className="size-full object-cover" loading="lazy" />
          ) : (
            <div className="flex size-full items-center justify-center">
              <Film className="size-9 text-text-3" />
            </div>
          )}
          {d.videoUrl ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex size-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                <PlayCircle className="size-6" />
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 px-3 py-3">
          <div>
            <p className="truncate text-sm font-medium text-text-0">{title}</p>
            <p className="truncate text-[11px] text-text-3">{d.provider || '视频资源'}</p>
          </div>
          {d.videoUrl ? (
            <video src={d.videoUrl} controls className="w-full rounded-xl border border-border bg-black" preload="metadata" />
          ) : (
            <p className="text-xs italic text-text-3">当前视频还没有可播放地址</p>
          )}
        </div>
      </div>
    </NodeBase>
  )
}

export const VideoAssetNode = memo(VideoAssetNodeComponent)
