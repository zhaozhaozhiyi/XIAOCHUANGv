'use client'

/**
 * CanvasEmptyState — 空画布引导层
 *
 * 仅在画布无任何节点（nodes.length === 0）时覆盖显示，解决"新建空白画布
 * 面对纯点阵不知从何下手"的冷启动问题。
 *
 * 设计约束：
 *   - 纯 overlay 引导，不写入任何节点数据；用户创建第一个节点后自动消失。
 *   - 外层 pointer-events-none，仅引导卡片本身可交互，
 *     这样卡片之外的空白处仍可正常"双击创建"。
 */

import { useState } from 'react'
import { Send, Sparkles } from 'lucide-react'

import { useNodesStore } from '@/lib/canvas/store'
import { useCanvasChat } from '@/lib/canvas/hooks/useCanvasChat'

export function CanvasEmptyState() {
  const isEmpty = useNodesStore((s) => s.nodes.length === 0)
  const { send, running } = useCanvasChat()
  const [draft, setDraft] = useState('')

  if (!isEmpty) return null

  const handleSend = () => {
    const text = draft.trim()
    if (!text || running) return
    setDraft('')
    void send(text)
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
      <div className="canvas-chrome-subtle pointer-events-auto flex w-[440px] max-w-[86vw] flex-col items-center gap-4 rounded-2xl px-8 py-7 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-accent-bg text-accent">
          <Sparkles className="size-6" />
        </div>

        <div className="flex flex-col gap-1.5">
          <h2 className="text-base font-semibold text-text-0">描述创意，生成分镜草稿</h2>
          <p className="text-sm text-text-2">
            先得到一组可编排的分镜，再逐步验证画面和沉淀资产
          </p>
        </div>

        <div className="flex w-full items-end gap-2 rounded-xl border border-border bg-bg-input px-2.5 py-2 focus-within:border-border-focus">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            rows={3}
            placeholder="例如：雨夜便利店里，女孩发现一张来自未来的照片"
            className="max-h-28 min-h-[4rem] flex-1 resize-none bg-transparent text-left text-sm text-text-0 placeholder:text-text-3 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!draft.trim() || running}
            aria-label="生成分镜草稿"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-on-accent transition-colors hover:bg-accent-dark disabled:cursor-not-allowed disabled:bg-bg-2 disabled:text-text-3"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
