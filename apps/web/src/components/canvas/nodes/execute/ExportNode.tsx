'use client'

/**
 * ExportNode — 成片输出（v0.2.0 PR2，nodeRegistry['export']）
 *
 * 端口：video(required) → (无输出，终点节点)
 * 完成时把 MP4 落资产库；前端 toast + 顶栏进度条更新（PR4 接入）
 */

import { memo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Download, Package } from 'lucide-react'
import { exportNode } from '@xiaochuang/canvas-shared'

import { NodeBase } from '../NodeBase'

interface ExportData {
  resolution?: string
  codec?: string
  assetUrl?: string
  fileSize?: number
}

function ExportNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as ExportData

  return (
    <NodeBase nodeId={id} definition={exportNode} selected={selected} width={192}>
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-base">📦</span>
        <span className="text-sm font-medium text-text-0">成片输出</span>
      </div>

      <div className="space-y-2 p-3">
        <div className="flex flex-col items-center justify-center rounded-md border border-border bg-bg-2 py-3">
          <Package className="size-7 text-text-3" />
          <span className="mt-1.5 text-xs text-text-3">MP4 文件</span>
        </div>

        <div className="flex items-center gap-1">
          <Tag>{d.resolution || '1080p'}</Tag>
          <Tag>{d.codec || 'H.264'}</Tag>
        </div>

        {d.assetUrl && (
          <a
            href={d.assetUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center justify-center gap-1.5 rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-on-accent transition-colors hover:bg-accent-dark"
          >
            <Download className="size-3.5" />
            <span>下载</span>
          </a>
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

export const ExportNode = memo(ExportNodeComponent)
