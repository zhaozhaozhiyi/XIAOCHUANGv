'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'

type SaveIndicator = 'saving' | 'pending' | 'saved' | 'error' | null

type Props = {
  title: string
  saveIndicator: SaveIndicator
  titleSaving?: boolean
  onTitleSave: (title: string) => void | Promise<void>
}

function SaveStatus({ indicator }: { indicator: SaveIndicator }) {
  if (indicator == null) return null
  if (indicator === 'saving') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-text-3">
        <Loader2 className="size-3.5 animate-spin" />
        保存中…
      </span>
    )
  }
  if (indicator === 'pending') {
    return (
      <span className="flex items-center gap-1.5 text-xs text-text-3">
        <span className="size-1.5 rounded-full bg-amber-500" />
        待自动保存
      </span>
    )
  }
  if (indicator === 'error') {
    return <span className="text-xs text-error">保存失败，请重试</span>
  }
  return (
    <span className="flex items-center gap-1.5 text-xs text-text-3">
      <Check className="size-3.5 text-success" />
      已保存
    </span>
  )
}

export function WritingStudioTopbar({
  title,
  saveIndicator,
  titleSaving = false,
  onTitleSave,
}: Props) {
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState(title)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingTitle) return
    const task = window.setTimeout(() => {
      setDraftTitle(title)
    }, 0)
    return () => {
      window.clearTimeout(task)
    }
  }, [editingTitle, title])

  useEffect(() => {
    if (editingTitle) inputRef.current?.focus()
  }, [editingTitle])

  const commitTitle = useCallback(async () => {
    const trimmed = draftTitle.trim()
    setEditingTitle(false)
    if (!trimmed || trimmed === title) {
      setDraftTitle(title)
      return
    }
    await onTitleSave(trimmed)
  }, [draftTitle, onTitleSave, title])

  const cancelTitle = useCallback(() => {
    setDraftTitle(title)
    setEditingTitle(false)
  }, [title])

  return (
    <header className="flex h-[54px] min-h-[54px] shrink-0 items-center justify-between gap-3 border-b border-border bg-bg-0/95 px-3 backdrop-blur">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link
          href="/writing"
          className="inline-flex h-7 min-w-[86px] items-center justify-center gap-[7px] rounded-[var(--radius-pill)] border border-[var(--color-border)] bg-[var(--color-bg-0)] pl-[9px] pr-[11px] text-xs font-bold text-[var(--color-text-1)] shadow-[0_1px_2px_rgba(38,30,24,0.08),0_2px_8px_rgba(38,30,24,0.04)] transition-[background,border-color,color,box-shadow] duration-150 hover:border-[var(--color-border-strong)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-0)]"
        >
          <ArrowLeft size={15} /> 返回
        </Link>
        <div className="flex min-w-0 flex-1 items-center">
          {editingTitle ? (
            <Input
              ref={inputRef}
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={() => void commitTitle()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void commitTitle()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelTitle()
                }
              }}
              disabled={titleSaving}
              className="h-7 min-w-[12rem] flex-1 max-w-2xl border-border bg-bg-0 px-2 text-xs font-semibold shadow-none"
              aria-label="作品名称"
            />
          ) : (
            <button
              type="button"
              className={cn(
                'min-w-0 max-w-2xl flex-1 truncate text-left text-xs font-semibold leading-none text-text-0',
                'rounded px-1 py-0.5 transition hover:bg-bg-hover hover:text-primary',
                titleSaving && 'opacity-60',
              )}
              onClick={() => setEditingTitle(true)}
              title="点击编辑作品名"
            >
              {title}
            </button>
          )}
        </div>
      </div>
      <SaveStatus indicator={saveIndicator} />
    </header>
  )
}
