'use client'

/**
 * TopBarSkeleton — 编辑器顶栏（v0.2.0 PR1.6 token → PR3 🎬 占位 → PR4 完整接入）
 *
 * 左侧：返回 + 画布标题 + SaveIndicator（保存状态，紧跟标题后）
 * 右侧：RunProgressIndicator（运行中显示）/ 🎬 生成成片按钮（idle 时显示）
 *
 * PR4：🎬 按钮触发 GenerateMovieDialog（onOpenGenerate prop 由 CanvasEditor 传）
 *      取消按钮触发 onCancelRun（也由 CanvasEditor 传）
 */

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FileEdit,
  Film,
  Loader2,
} from 'lucide-react'
import { toast } from 'sonner'

import { cn } from '@/lib/cn'
import { canvasApi } from '@/lib/canvas/api/canvas'
import { useCanvasStore, useRuntimeStore } from '@/lib/canvas/store'
import type { SaveStatus } from '@/lib/canvas/store'

import { RunProgressIndicator } from './RunProgressIndicator'

interface Props {
  onOpenGenerate: () => void
  onCancelRun: () => void
}

export function TopBarSkeleton({ onOpenGenerate, onCancelRun }: Props) {
  const saveStatus = useCanvasStore((s) => s.saveStatus)
  const runState = useRuntimeStore((s) => s.runState)

  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-canvas-surface px-3 backdrop-blur-md">
      <Link
        href="/canvas"
        aria-label="返回画布列表"
        className="flex size-8 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-bg-hover hover:text-text-0"
      >
        <ArrowLeft size={16} />
      </Link>

      {/* 标题（点击可内联重命名）+ 保存状态成组靠左 */}
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <EditableTitle />
        <SaveIndicator status={saveStatus} />
      </div>

      {/* 运行中显示进度；idle 时显示生成成片按钮 */}
      {runState === 'running' ? (
        <RunProgressIndicator onCancel={onCancelRun} />
      ) : (
        <button
          type="button"
          onClick={onOpenGenerate}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-xs font-medium text-on-accent shadow-primary-glow transition-colors hover:bg-accent-dark"
        >
          <Film className="size-3.5" />
          <span>生成成片</span>
        </button>
      )}
    </header>
  )
}

/**
 * EditableTitle — 画布标题，点击即可内联重命名。
 *
 * 提交（Enter / 失焦）→ 写入 store + 调 updateMeta 持久化（标题不走 graph 防抖保存）。
 * 取消（Esc）→ 还原，不保存。Enter / Esc 都统一走 blur，由 modeRef 决定行为，
 * 避免"setEditing(false) 卸载 input → blur 再触发一次提交"的重复提交。
 */
function EditableTitle() {
  const title = useCanvasStore((s) => s.title)
  const canvasId = useCanvasStore((s) => s.canvasId)
  const setTitle = useCanvasStore((s) => s.setTitle)
  const setSaveStatus = useCanvasStore((s) => s.setSaveStatus)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)
  const modeRef = useRef<'commit' | 'cancel'>('commit')

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const startEdit = () => {
    setDraft(title)
    modeRef.current = 'commit'
    setEditing(true)
  }

  const persist = async (next: string) => {
    if (!canvasId) return
    try {
      setSaveStatus('saving')
      await canvasApi.updateMeta(canvasId, { title: next })
      setSaveStatus('saved', new Date().toISOString())
    } catch (err) {
      setSaveStatus('error')
      toast.error('标题保存失败', { description: (err as Error)?.message })
    }
  }

  const handleBlur = () => {
    const mode = modeRef.current
    modeRef.current = 'commit'
    setEditing(false)

    if (mode === 'cancel') {
      setDraft(title)
      return
    }
    const next = draft.trim()
    if (!next || next === title) {
      setDraft(title)
      return
    }
    setTitle(next)
    void persist(next)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      modeRef.current = 'commit'
      inputRef.current?.blur()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      modeRef.current = 'cancel'
      inputRef.current?.blur()
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        maxLength={80}
        className="min-w-0 max-w-[280px] rounded-md border border-border-focus bg-bg-input px-2 py-0.5 text-sm font-medium text-text-0 focus:outline-none"
      />
    )
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      title="点击重命名"
      className="min-w-0 truncate rounded-md px-2 py-0.5 text-sm font-medium text-text-0 transition-colors hover:bg-bg-hover"
    >
      {title || '未命名画布'}
    </button>
  )
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { icon: React.ElementType; text: string; tone: string }> = {
    idle: { icon: FileEdit, text: '准备中', tone: 'text-text-3' },
    editing: { icon: FileEdit, text: '编辑中…', tone: 'text-warning' },
    saving: { icon: Loader2, text: '保存中', tone: 'text-text-2' },
    saved: { icon: CheckCircle2, text: '已保存', tone: 'text-success' },
    error: { icon: AlertCircle, text: '保存失败', tone: 'text-error' },
  }
  const { icon: Icon, text, tone } = map[status]
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs">
      <Icon size={14} className={cn(tone, status === 'saving' && 'animate-spin')} />
      <span className={cn('hidden sm:inline', tone)}>{text}</span>
    </div>
  )
}
