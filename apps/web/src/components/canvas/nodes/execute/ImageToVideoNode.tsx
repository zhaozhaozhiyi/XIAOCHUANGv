'use client'

/**
 * ImageToVideoNode — 镜头拍摄（v0.2.0 PR2，nodeRegistry['image-to-video']）
 *
 * 端口：image(required) + motion(text, 可选) → video
 * 业务动作（PR3）：生成镜头视频
 * 隐藏节点模式：结果回填到原 storyboard 节点的 videoUrl
 */

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Film, Video } from 'lucide-react'
import { imageToVideoNode } from '@xiaochuang/canvas-shared'

import { NodeBase } from '../NodeBase'

interface ImageToVideoData {
  motion?: string
  duration?: string
  videoUrl?: string
  thumbnailUrl?: string
}

function ImageToVideoNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as ImageToVideoData

  return (
    <NodeBase nodeId={id} definition={imageToVideoNode} selected={selected} width={224}>
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-base">🎬</span>
        <span className="text-sm font-medium text-text-0">镜头拍摄</span>
      </div>

      {/* 视频预览（如果有） */}
      <div className="relative overflow-hidden bg-bg-2">
        {d.thumbnailUrl ? (
          <img
            src={d.thumbnailUrl}
            alt="视频缩略图"
            className="h-32 w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="flex h-32 items-center justify-center">
            <Video className="size-8 text-text-3" />
          </div>
        )}
        {d.videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
              <Film className="size-5 text-white" />
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 text-xs">
        {d.motion ? (
          <p className="line-clamp-2 text-text-2">{d.motion}</p>
        ) : (
          <p className="text-text-3 italic">未填写动态描述</p>
        )}
        <div className="mt-1.5 flex items-center gap-1">
          <span className="rounded border border-border bg-bg-2 px-1.5 py-0.5 text-[10px] text-text-2">
            {d.duration || '5'} 秒
          </span>
        </div>
      </div>
    </NodeBase>
  )
}

export const ImageToVideoNode = memo(ImageToVideoNodeComponent)
