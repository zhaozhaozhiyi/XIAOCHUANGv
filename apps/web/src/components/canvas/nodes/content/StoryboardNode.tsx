'use client'

/**
 * StoryboardNode — 分镜卡（v0.2.0 PR2，PRD §8.2）
 *
 * 从 PR1.6 ImageNode 的 storyboard 分支移过来，并接入 NodeBase 6 状态外壳。
 * 渲染元素：
 *   - 顶部 4px 情绪色带（moodColor）
 *   - 图片区（16:9，无图时占位）
 *   - 标题行：镜头号 + 标题 + 🔊 音频标记
 *   - 景别 / 运镜徽章
 *   - 描述截断 2 行
 *   - 底部时长进度条 + 秒数
 *   - 折角标记（markStatus === 'confirmed'）
 *   - 附签（右侧伸出，最多 3 个）
 *
 * 编辑 / 字段单击选择器 / 拖拽改时长 → PR3 接入。
 */

import { memo, useMemo } from 'react'
import { type NodeProps } from '@xyflow/react'
import { Image as ImageIcon, Volume2 } from 'lucide-react'
import { storyboardNode } from '@xiaochuang/canvas-shared'

import { cn } from '@/lib/cn'
import type { StoryboardData } from '@/lib/canvas/types'
import { NodeBase } from '../NodeBase'
import { NodeGenerateCta } from '../NodeGenerateCta'

function StoryboardNodeComponent({ id, data, selected }: NodeProps) {
  const d = (data ?? {}) as StoryboardData

  const attachments = useMemo(() => {
    const arr = Array.isArray(d.attachments) ? d.attachments : []
    return arr
      .filter((a): a is { text: string; color?: string } => !!a && typeof a.text === 'string')
      .slice(0, 3)
  }, [d.attachments])

  const hasAudio = !!(d as { audioUrl?: string }).audioUrl
  const isConfirmed = d.markStatus === 'confirmed'
  const duration = d.duration

  return (
    <NodeBase
      nodeId={id}
      definition={storyboardNode}
      selected={selected}
      width={256}
      className="overflow-visible"
    >
      {/* 顶部情绪色带 */}
      {d.moodColor && (
        <div
          className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-1 rounded-t-2xl"
          style={{ backgroundColor: d.moodColor }}
          aria-hidden
        />
      )}

      {/* 附签（右侧伸出） */}
      {attachments.length > 0 && (
        <div className="absolute -right-3 top-3 z-20 flex flex-col gap-1.5">
          {attachments.map((a, i) => (
            <span
              key={i}
              className="rounded-r-md px-2 py-0.5 text-[10px] font-medium text-text-0 shadow-sm"
              style={{ backgroundColor: a.color || 'var(--color-warning-bg)' }}
            >
              {a.text}
            </span>
          ))}
        </div>
      )}

      {/* 图片区 */}
      <div className="relative overflow-hidden rounded-t-2xl">
        {d.images && d.images[0] ? (
          <img
            src={d.images[0]}
            alt={d.title || '分镜画面'}
            className="h-40 w-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="relative flex h-40 w-full flex-col items-center justify-center gap-2 bg-bg-2">
            <ImageIcon className="size-10 text-text-3" />
            <NodeGenerateCta nodeId={id} label="生成画面" compact />
          </div>
        )}
      </div>

      {/* 标题行 */}
      <div className="px-3 pb-1.5 pt-3">
        <div className="flex items-center gap-2">
          {d.shotIndex !== undefined && (
            <span className="shrink-0 font-mono text-xs text-text-3">#{d.shotIndex}</span>
          )}
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-text-0">
            {d.title || '未命名分镜'}
          </h3>
          {hasAudio && (
            <Volume2 className="size-3.5 shrink-0 text-accent" aria-label="此分镜有配音" />
          )}
        </div>

        {/* 景别 / 运镜徽章 */}
        {(d.shotType || d.cameraMove) && (
          <div className="mt-1.5 flex items-center gap-1">
            {d.shotType && <Badge>{d.shotType}</Badge>}
            {d.cameraMove && <Badge>{d.cameraMove}</Badge>}
          </div>
        )}

        {/* 描述 */}
        {d.shotDescription && (
          <p className="mt-1.5 line-clamp-2 text-xs text-text-2">{d.shotDescription}</p>
        )}
      </div>

      {/* 底部时长条 */}
      {duration !== undefined && (
        <div className="flex items-center gap-2 border-t border-border/50 px-3 py-1.5">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-bg-3">
            <div
              className="h-full rounded-full bg-accent/70"
              style={{
                width: `${Math.min(100, Math.max(5, (duration / 10) * 100))}%`,
              }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] text-text-3">{duration}s</span>
        </div>
      )}

      {/* 折角标记 */}
      {isConfirmed && (
        <svg
          viewBox="0 0 12 12"
          className="absolute bottom-0 right-0 size-3 text-accent"
          aria-label="已确认"
        >
          <path d="M0 12 L12 12 L12 0 Z" fill="currentColor" />
        </svg>
      )}
    </NodeBase>
  )
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-bg-2 px-1.5 py-0.5 text-[10px] text-text-1">
      {children}
    </span>
  )
}

export const StoryboardNode = memo(StoryboardNodeComponent)
