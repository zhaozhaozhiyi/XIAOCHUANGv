'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Send, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/cn'
import { aiRuntimeAPI } from '@/lib/api'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ActionItem {
  type: string
  label?: string
  content?: string
  title?: string
  document_id?: number
  structured?: {
    summary?: string
    reasons?: string[]
    risks?: string[]
    expected_effects?: string[]
    issues?: Array<{ title?: string; severity?: 'low' | 'medium' | 'high' | null }>
  } | null
}

function formatStructuredActionSummary(action: ActionItem) {
  const structured = action.structured
  if (!structured) return null
  const lines: string[] = []
  if (structured.summary) lines.push(`摘要：${structured.summary}`)
  if (structured.reasons?.length) lines.push(`原因：${structured.reasons.slice(0, 2).join('；')}`)
  if (structured.risks?.length) lines.push(`风险：${structured.risks.slice(0, 2).join('；')}`)
  if (structured.expected_effects?.length) lines.push(`影响：${structured.expected_effects.slice(0, 2).join('；')}`)
  if (structured.issues?.length) lines.push(`问题：${structured.issues.slice(0, 2).map((item) => item.title || '未命名问题').join('；')}`)
  return lines.length ? lines.join('｜') : null
}

interface WritingChatPanelProps {
  writingId: number
  documentId: number | null
  documentTitle: string
  documentContent: string
  onInsertContent: (content: string) => void
  getSelection?: () => string
  onReloadRequested?: () => void
  onBriefStructuredApplied?: (structured: Record<string, unknown> | null) => void
  onOutlineStructuredApplied?: (structured: Record<string, unknown> | null) => void
  className?: string
}

const MODE_OPTIONS = [
  { key: 'chapter_write', label: '续写' },
  { key: 'polish', label: '润色' },
  { key: 'summarize', label: '摘要' },
  { key: 'outline', label: '大纲' },
  { key: 'consistency_check', label: '一致性' },
] as const

type WritingMode = 'chapter_write' | 'polish' | 'summarize' | 'outline' | 'briefing' | 'consistency_check'

function inferModeFromContent(title: string, content: string): WritingMode {
  if (title.includes('????')) return 'briefing'
  if (title.includes('????')) return 'summarize'
  if (title.includes('????')) return 'outline'
  if (!content.trim()) return 'chapter_write'
  return 'polish'
}

interface StreamChunk {
  type: 'delta' | 'status' | 'done' | 'error' | 'reference' | 'result'
  text?: string
  message?: string
  kind?: string
  title?: string
  actions?: ActionItem[]
  references?: Array<{ kind?: string; title?: string }>
}

function normalizeActions(value: unknown): ActionItem[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is ActionItem => !!item && typeof item === 'object' && typeof (item as ActionItem).type === 'string')
}

function parseSSEMessage(data: string): StreamChunk | null {
  try {
    return JSON.parse(data) as StreamChunk
  } catch {
    return null
  }
}

export function WritingChatPanel({
  writingId,
  documentId,
  documentTitle,
  documentContent,
  onInsertContent,
  getSelection,
  onReloadRequested,
  onBriefStructuredApplied,
  onOutlineStructuredApplied,
  className,
}: WritingChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')
  const [statusText, setStatusText] = useState('')
  const [references, setReferences] = useState<string[]>([])
  const [mode, setMode] = useState<WritingMode>('chapter_write')
  const [runs, setRuns] = useState<Array<{ id: number; actions: ActionItem[] }>>([])
  const autoMode = useMemo(() => inferModeFromContent(documentTitle, documentContent), [documentContent, documentTitle])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const history = await aiRuntimeAPI.listRuns('writing', writingId)
      setMessages(history.flatMap((run: { id: number; user_message?: string | null; assistant_message?: string | null; created_at: string }) => {
        const items: Message[] = []
        if (run.user_message) items.push({ id: `u-${run.id}`, role: 'user', content: run.user_message, timestamp: new Date(run.created_at) })
        if (run.assistant_message) items.push({ id: `a-${run.id}`, role: 'assistant', content: run.assistant_message, timestamp: new Date(run.created_at) })
        return items
      }))
      setRuns(history.map((run: { id: number; actions?: unknown }) => ({ id: run.id, actions: normalizeActions(run.actions) })))
    } catch {
      // ignore history load failures for now
    }
  }, [writingId])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamContent, scrollToBottom])

  const handleApplyAction = useCallback(async (runId: number, actionIndex: number) => {
    try {
      const result = await aiRuntimeAPI.applyAction(runId, actionIndex)
      if (result.type === 'append_document') {
        const run = runs.find((item) => item.id === runId)
        const action = run?.actions[actionIndex]
        if (action?.content) onInsertContent(action.content)
      }
      if (result.type === 'update_brief') {
        onBriefStructuredApplied?.(result.structured ?? null)
      }
      if (result.type === 'write_outline') {
        onOutlineStructuredApplied?.(result.structured ?? null)
      }
      if (result.type === 'create_document_draft' || result.type === 'write_summary' || result.type === 'write_outline' || result.type === 'update_brief' || result.type === 'replace_selection' || result.type === 'create_proposal') {
        onReloadRequested?.()
      }
      toast.success('AI 结果已应用')
      await loadHistory()
    } catch (error) {
      toast.error((error as Error).message)
    }
  }, [loadHistory, onBriefStructuredApplied, onInsertContent, onOutlineStructuredApplied, onReloadRequested, runs])

  const handleSubmit = useCallback(async () => {
    if (!input.trim() || streaming) return

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setStreaming(true)
    setStreamContent('')
    setStatusText('正在思考...')
    setReferences([])

    const assistantMessageId = `assistant-${Date.now()}`

    try {
      abortControllerRef.current = new AbortController()
      const response = await fetch('/api/v1/ai/runs?stream=1', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          skill_id: 'writing_copilot',
          mode: mode || autoMode,
          scene: 'writing_workspace',
          target: { type: 'writing', writing_id: writingId, document_id: documentId ?? undefined },
          input: { message: input.trim(), selection: getSelection ? getSelection() : null },
          options: { stream: true },
        }),
        signal: abortControllerRef.current.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(await response.text() || 'AI 请求失败')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let assistantContent = ''
      let completed = false

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\n\n/)
        buffer = blocks.pop() || ''

        for (const block of blocks) {
          const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n')
            .trim()

          if (!data) continue
          const chunk = parseSSEMessage(data)
          if (!chunk) continue

          if (chunk.type === 'status') {
            setStatusText(chunk.text || '处理中...')
          } else if (chunk.type === 'reference') {
            const title = chunk.title || chunk.kind || '引用上下文'
            setReferences((prev) => (prev.includes(title) ? prev : [...prev, title]))
          } else if (chunk.type === 'result') {
            assistantContent = chunk.text || assistantContent
            setStreamContent(assistantContent)
            if (Array.isArray(chunk.references) && chunk.references.length > 0) {
              setReferences((prev) => {
                const merged = [...prev]
                for (const item of chunk.references || []) {
                  const title = item.title || item.kind || '引用上下文'
                  if (!merged.includes(title)) merged.push(title)
                }
                return merged
              })
            }
          } else if (chunk.type === 'delta') {
            assistantContent += chunk.text || ''
            setStreamContent(assistantContent)
          } else if (chunk.type === 'done') {
            completed = true
            setMessages((prev) => [...prev, { id: assistantMessageId, role: 'assistant', content: assistantContent, timestamp: new Date() }])
            setStreamContent('')
            setStatusText('')
          } else if (chunk.type === 'error') {
            throw new Error(chunk.message || 'AI 生成失败')
          }
        }
      }

      if (!completed && assistantContent.trim()) {
        setMessages((prev) => [...prev, { id: assistantMessageId, role: 'assistant', content: assistantContent, timestamp: new Date() }])
        setStreamContent('')
      }
      await loadHistory()
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setStreamContent('')
      } else {
        toast.error((error as Error).message)
        setMessages((prev) => prev.slice(0, -1))
      }
    } finally {
      setStreaming(false)
      setStatusText('')
      abortControllerRef.current = null
    }
  }, [autoMode, documentId, getSelection, input, loadHistory, mode, streaming, writingId])

  const handleStop = useCallback(() => {
    abortControllerRef.current?.abort()
    setStreaming(false)
    setStatusText('')
  }, [])

  return (
    <aside className={cn('flex min-h-0 flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-0', className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <Sparkles size={16} className="text-accent" />
        <span className="text-sm font-semibold text-text-0">AI 写作助手</span>
      </div>

      {references.length > 0 && <div className="shrink-0 border-b border-border px-4 py-2 text-xs text-text-3">参考：{references.join('、')}</div>}

      <ScrollArea className="min-h-0 flex-1 p-4">
        <div className="flex flex-col gap-3">
          {messages.length === 0 && !streaming && (
            <div className="rounded-[var(--radius-md)] border border-dashed border-border bg-bg-2 p-4 text-center text-xs text-text-3">
              当前文档：{documentTitle || '未命名文档'}。当前模式：{MODE_OPTIONS.find((item) => item.key === mode)?.label}。输入你的写作需求，AI 会结合项目上下文协作生成内容。
            </div>
          )}

          {messages.map((message) => (
            <div key={message.id} className={cn('flex flex-col gap-1', message.role === 'user' ? 'items-end' : 'items-start')}>
              <div className={cn('max-w-[90%] rounded-[var(--radius-md)] px-3 py-2 text-sm', message.role === 'user' ? 'bg-accent-bg text-on-accent' : 'bg-bg-2 text-text-0')}>
                {message.content}
              </div>
            </div>
          ))}

                    {runs.map((run) => run.actions.length > 0 ? (
            <div key={`actions-${run.id}`} className="space-y-2 rounded-[var(--radius-md)] border border-border bg-bg-1/40 p-3">
              <div className="text-[11px] font-medium text-text-2">AI 结果动作</div>
              <div className="flex flex-wrap gap-2">
                {run.actions.map((action, index) => (
                  <Button key={`${run.id}-${index}`} variant="outline" size="sm" onClick={() => void handleApplyAction(run.id, index)}>
                    {action.label || action.type}
                  </Button>
                ))}
              </div>
              <div className="space-y-2">
                {run.actions.map((action, index) => {
                  const structuredSummary = formatStructuredActionSummary(action)
                  if (!structuredSummary && !action.title && !action.content) return null
                  return (
                    <div key={`summary-${run.id}-${index}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-0 px-3 py-2 text-xs text-text-3">
                      <div className="font-medium text-text-1">{action.label || action.type}</div>
                      {action.title ? <div className="mt-1">标题：{action.title}</div> : null}
                      {structuredSummary ? <div className="mt-1">{structuredSummary}</div> : null}
                      {!structuredSummary && action.content ? <div className="mt-1 line-clamp-4 whitespace-pre-wrap">{action.content}</div> : null}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null)}

          {streaming && (
            <div className="flex flex-col gap-1 items-start">
              {streamContent && <div className="max-w-[90%] whitespace-pre-wrap rounded-[var(--radius-md)] bg-bg-2 px-3 py-2 text-sm text-text-0">{streamContent}</div>}
              {statusText && <div className="flex items-center gap-1 text-xs text-text-3"><Loader2 size={12} className="animate-spin" />{statusText}</div>}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      <div className="flex shrink-0 flex-wrap gap-1 px-3 py-2">
        {MODE_OPTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setMode(item.key)}
            className={cn(
              'rounded-full px-2.5 py-1 text-[11px] transition',
              (mode || autoMode) === item.key ? 'bg-accent text-on-accent' : 'bg-bg-2 text-text-2 hover:bg-bg-hover',
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="shrink-0 border-t border-border p-3">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`围绕《${documentTitle || '当前文档'}》描述你的写作需求...`}
            className="min-h-[60px] max-h-[120px] resize-none rounded-none border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            disabled={streaming}
          />
        </div>
        <div className="mt-2 flex justify-end gap-2">
          {streaming ? (
            <Button variant="outline" size="sm" onClick={handleStop} className="h-8">停止</Button>
          ) : (
            <Button size="sm" onClick={handleSubmit} disabled={!input.trim()} className="h-8 gap-1.5">
              <Send size={14} />发送
            </Button>
          )}
        </div>
      </div>
    </aside>
  )
}





