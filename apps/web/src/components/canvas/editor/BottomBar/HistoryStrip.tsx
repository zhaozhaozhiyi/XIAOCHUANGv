'use client'

/**
 * HistoryStrip — 节点生成历史（v0.2.0 PR3，PRD §12.6 每节点最多 20 条）
 *
 * 横向滚动缩略图条；点击切换 → 把对应 url 替换到 images[0]，prompt 同步回写。
 * PR3 仅显示 + 切换；局部重绘 / 扩图 / 历史排序 留给 v0.2.1。
 */

import { useCallback, useMemo } from 'react'
import { History } from 'lucide-react'

import { cn } from '@/lib/cn'
import { useCanvasStore, useNodesStore } from '@/lib/canvas/store'
import type { StoryboardData } from '@/lib/canvas/types'

interface HistoryItem {
  url: string
  prompt?: string
  style?: string
  timestamp: string
}

interface Props {
  nodeId: string
}

export function HistoryStrip({ nodeId }: Props) {
  const node = useNodesStore((s) => s.nodes.find((n) => n.id === nodeId))
  const updateNodeData = useNodesStore((s) => s.updateNodeData)
  const markEditing = useCanvasStore((s) => s.markEditing)

  const history: HistoryItem[] = useMemo(
    () => (node?.data as StoryboardData | undefined)?.historyImages ?? [],
    [node?.data],
  )
  const currentUrl = (node?.data as StoryboardData | undefined)?.images?.[0]

  const handleUse = useCallback(
    (item: HistoryItem) => {
      // 把当前图也存进历史（位置头部），再把选中项设为 current
      const old = currentUrl
      const oldPrompt = (node?.data as StoryboardData | undefined)?.prompt
      const restHistory = history.filter((h) => h.url !== item.url)
      const newHistory: HistoryItem[] = old
        ? [
            { url: old, prompt: oldPrompt, timestamp: new Date().toISOString() },
            ...restHistory,
          ].slice(0, 20)
        : restHistory
      updateNodeData(nodeId, {
        images: [item.url],
        prompt: item.prompt ?? oldPrompt,
        historyImages: newHistory,
      })
      markEditing()
    },
    [currentUrl, history, markEditing, node?.data, nodeId, updateNodeData],
  )

  if (history.length === 0) return null

  return (
    <div className="border-t border-border px-4 py-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-text-3">
        <History className="size-3" />
        <span>生成历史</span>
        <span className="ml-auto text-text-3">{history.length}/20</span>
      </div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {history.map((item, i) => {
          const isCurrent = item.url === currentUrl
          return (
            <button
              key={`${item.timestamp}-${i}`}
              type="button"
              onClick={() => handleUse(item)}
              title={item.prompt || '历史画面'}
              className={cn(
                'relative shrink-0 overflow-hidden rounded-md border-2 transition-colors',
                isCurrent
                  ? 'border-accent shadow-accent-glow'
                  : 'border-border hover:border-border-strong',
              )}
            >
              <img
                src={item.url}
                alt={item.prompt || `历史 ${i + 1}`}
                className="h-14 w-20 object-cover"
                loading="lazy"
              />
              {isCurrent && (
                <div className="absolute inset-x-0 bottom-0 bg-accent/85 py-0.5 text-center text-[9px] font-medium text-on-accent">
                  当前
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
