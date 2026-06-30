'use client'

/**
 * ChatDock — 左侧悬浮对话栏（v2.2 PR-A）
 *
 * 对齐 Oii「对话驱动」：用户在这里描述故事，工种 Agent 接力把分镜落到真实画布。
 * - 悬浮 overlay（pointer-events-none 外壳 + auto 内层），不占布局、可收起
 * - 仅在「智能画布」模式（canvasMode === 'chat'）显示；导演模式隐藏
 * - 收起态为一颗悬浮按钮，展开态为 360px 面板
 *
 * 数据来自 canvas chat；0.23.0 只开放 create_nodes / update_node / add_to_context。
 */

import { useEffect, useRef, useState } from 'react'
import { MessageSquare, Send, X } from 'lucide-react'

import { cn } from '@/lib/cn'
import { usePipelineStore } from '@/lib/canvas/store/pipelineStore'
import { useCanvasChat } from '@/lib/canvas/hooks/useCanvasChat'
import type { CanvasChatMessage } from '@/lib/canvas/store'
import { ChatPlanPreview } from './ChatPlanPreview'
import { ChatSkillStatus } from './ChatSkillStatus'

export function ChatDock() {
  const chatOpen = usePipelineStore((s) => s.chatOpen)
  const toggleChat = usePipelineStore((s) => s.toggleChat)
  const { messages, pendingPlan, running, send, confirmPlan, cancelPlan } = useCanvasChat()

  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const text = draft.trim()
    if (!text || running) return
    setDraft('')
    void send(text)
  }

  if (!chatOpen) {
    return (
      <div className="pointer-events-none absolute bottom-3 left-3 z-30">
        <button
          type="button"
          onClick={toggleChat}
          className="pointer-events-auto flex items-center gap-2 rounded-full border border-border bg-accent px-4 py-2.5 text-sm font-medium text-on-accent shadow-primary-glow transition-colors hover:bg-accent-dark"
        >
          <MessageSquare className="size-4" />
          对话创作
        </button>
      </div>
    )
  }

  return (
    <div className="pointer-events-none absolute bottom-3 left-3 top-4 z-30 flex w-[360px] max-w-[calc(100%-1.5rem)]">
      <div className="pointer-events-auto flex w-full flex-col overflow-hidden rounded-2xl canvas-chrome">
        {/* 头部 */}
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-accent/15 text-base">
            ✦
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text-0">创作助手</div>
            <div className="truncate text-[11px] text-text-3">分镜编排 · 生成验证 · 资产沉淀</div>
          </div>
          <button
            type="button"
            onClick={toggleChat}
            aria-label="收起对话栏"
            className="flex size-7 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-bg-hover hover:text-text-0"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* 消息流 */}
        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
          {messages.map((m) => (
            <MessageBubble key={m.id} message={m} />
          ))}
          {pendingPlan && (
            <ChatPlanPreview
              plan={pendingPlan}
              onConfirm={() => void confirmPlan()}
              onCancel={cancelPlan}
              disabled={running}
            />
          )}
          <ChatSkillStatus running={running} />
        </div>

        {/* 输入区 */}
        <div className="shrink-0 border-t border-border p-2.5">
          <div className="flex items-end gap-2 rounded-xl border border-border bg-bg-input px-2.5 py-2 focus-within:border-border-focus">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              rows={2}
              placeholder="描述创意，生成分镜草稿…"
              className="max-h-28 min-h-[2.5rem] flex-1 resize-none bg-transparent text-sm text-text-0 placeholder:text-text-3 focus:outline-none"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={!draft.trim() || running}
              aria-label="发送"
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                !draft.trim() || running
                  ? 'cursor-not-allowed bg-bg-2 text-text-3'
                  : 'bg-accent text-on-accent hover:bg-accent-dark',
              )}
            >
              <Send className="size-4" />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-text-3">Enter 发送 · Shift+Enter 换行</p>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: CanvasChatMessage }) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-on-accent">
          {message.text}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-2">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-bg-2 text-base">
        ✦
      </span>
      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-sm bg-bg-2 px-3 py-2 text-sm text-text-0">
          {message.text}
        </div>
      </div>
    </div>
  )
}
