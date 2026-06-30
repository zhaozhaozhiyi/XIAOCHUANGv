'use client'

/**
 * DurationPopover — 设镜头时长（v0.2.0 PR3 业务动作 5，PRD §9.2 storyboard）
 *
 * 由 NodeContextMenu "设镜头时长"打开；屏幕坐标固定定位。
 * 范围 1~60s（PRD §10.2 分镜卡）；回车 / 失焦确认。
 * 不调后端，仅 nodesStore.updateNodeData → markEditing → 3s 防抖保存。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Clock } from 'lucide-react'

import { useCanvasStore, useNodesStore, useUiStore } from '@/lib/canvas/store'
import type { StoryboardData } from '@/lib/canvas/types'

const MIN_S = 1
const MAX_S = 60

export function DurationPopover() {
  const pos = useUiStore((s) => s.durationPopover)
  const close = useUiStore((s) => s.closeDurationPopover)
  const node = useNodesStore((s) =>
    pos ? s.nodes.find((n) => n.id === pos.nodeId) : undefined,
  )
  const updateNodeData = useNodesStore((s) => s.updateNodeData)
  const markEditing = useCanvasStore((s) => s.markEditing)

  const current =
    node && ((node.data as StoryboardData)?.duration ?? 5)
  const [value, setValue] = useState<number>(current ?? 5)
  const ref = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // 打开时聚焦输入框 + 全选
  useEffect(() => {
    if (!pos) return
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [pos])

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!pos) return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onKey)
    }
  }, [pos, close])

  const commit = useCallback(() => {
    if (!pos) return
    const clamped = Math.max(MIN_S, Math.min(MAX_S, Number(value) || 5))
    updateNodeData(pos.nodeId, { duration: clamped })
    markEditing()
    close()
  }, [close, markEditing, pos, updateNodeData, value])

  if (!pos || !node) return null

  return (
    <div
      ref={ref}
      className="pointer-events-auto fixed z-50 flex items-center gap-2 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-default"
      style={{
        left: Math.min(pos.x, typeof window !== 'undefined' ? window.innerWidth - 240 : pos.x),
        top: Math.min(pos.y, typeof window !== 'undefined' ? window.innerHeight - 80 : pos.y),
      }}
    >
      <Clock className="size-4 text-text-2" />
      <span className="text-xs text-text-2">时长</span>
      <input
        ref={inputRef}
        type="number"
        min={MIN_S}
        max={MAX_S}
        step="0.5"
        value={value}
        onChange={(e) => setValue(Number(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commit()
          }
        }}
        className="w-16 rounded-md border border-border bg-bg-input px-2 py-1 text-center text-sm text-text-0 focus:border-border-focus focus:outline-none"
      />
      <span className="text-xs text-text-3">秒</span>
      <button
        type="button"
        onClick={commit}
        className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-on-accent hover:bg-accent-dark"
      >
        确定
      </button>
    </div>
  )
}
