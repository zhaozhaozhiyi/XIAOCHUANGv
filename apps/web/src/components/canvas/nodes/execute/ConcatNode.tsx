'use client'

/**
 * ConcatNode — 剪辑台（v0.2.0 PR2，nodeRegistry['concat']）
 *
 * 端口：storyboards(可多连，required) → video
 * v0.2.0：基础拼接；v0.2.1 按 narrative 连线的 relationType 应用转场
 */

import { memo } from 'react'
import { type NodeProps, useStore } from '@xyflow/react'
import { Film, Scissors } from 'lucide-react'
import { concatNode } from '@xiaochuang/canvas-shared'

import { NodeBase } from '../NodeBase'

interface ConcatData {
  videoUrl?: string
  totalDuration?: number
}

function ConcatNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as ConcatData

  // 数已连入的分镜数（按 edge target 是当前节点 + sourceHandle 类型 storyboard）
  const connectedCount = useStore(
    (s) =>
      s.edges.filter(
        (e) => e.target === id && e.targetHandle?.endsWith(':storyboard'),
      ).length,
  )

  return (
    <NodeBase nodeId={id} definition={concatNode} selected={selected} width={208}>
      <div className="flex items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-base">🎞️</span>
        <span className="text-sm font-medium text-text-0">剪辑台</span>
      </div>

      <div className="space-y-2 p-3">
        {/* 输入分镜计数 */}
        <div className="flex items-center justify-between rounded-md border border-border bg-bg-2 px-2 py-2">
          <div className="flex items-center gap-1.5 text-xs text-text-2">
            <Scissors className="size-3.5" />
            <span>分镜序列</span>
          </div>
          <span className="font-mono text-sm font-medium text-text-0">{connectedCount}</span>
        </div>

        {/* 成片预览（占位） */}
        {d.videoUrl ? (
          <div className="flex items-center gap-2 rounded-md border border-success bg-success-bg px-2 py-1.5">
            <Film className="size-3.5 text-success" />
            <span className="text-xs text-success">
              成片就绪{d.totalDuration ? ` · ${d.totalDuration}s` : ''}
            </span>
          </div>
        ) : (
          <p className="text-xs text-text-3">
            {connectedCount > 0
              ? `就绪：${connectedCount} 个分镜可拼接`
              : '等待连入分镜'}
          </p>
        )}
      </div>
    </NodeBase>
  )
}

export const ConcatNode = memo(ConcatNodeComponent)
