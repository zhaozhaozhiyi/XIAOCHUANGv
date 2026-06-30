'use client'

import Link from 'next/link'
import { startTransition, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, BookOpen, FileText, Loader2, Plus, Search } from 'lucide-react'

import { writingAPI } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { WritingKind, WritingListItem } from '@/types/api'

const KIND_LABEL: Record<WritingKind, string> = {
  novel: '小说',
  screenplay: '文学剧本',
  outline: '大纲',
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  active: '进行中',
  archived: '归档',
}

function buildBriefJson(input: {
  worldview: string
  background: string
  mainPlot: string
  mainCharacters: string
}) {
  const brief = {
    worldview: input.worldview.trim(),
    background: input.background.trim(),
    main_plot: input.mainPlot.trim(),
    main_characters: input.mainCharacters.trim(),
    completion_state: [input.worldview, input.background, input.mainPlot, input.mainCharacters].filter((value) => value.trim()).length,
  }
  return Object.values(brief).some(Boolean) ? JSON.stringify(brief) : null
}

export default function WritingListPage() {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<WritingListItem[]>([])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newKind, setNewKind] = useState<WritingKind>('novel')
  const [newSynopsis, setNewSynopsis] = useState('')
  const [newWorldview, setNewWorldview] = useState('')
  const [newBackground, setNewBackground] = useState('')
  const [newMainPlot, setNewMainPlot] = useState('')
  const [newMainCharacters, setNewMainCharacters] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const res = await writingAPI.list({ page: 1, page_size: 50, sort: 'updated_at', q: q.trim() || undefined })
      startTransition(() => {
        setItems(res.items)
        setLoading(false)
      })
    } catch (e) {
      toast.error((e as Error).message)
      startTransition(() => setLoading(false))
    }
  }, [q])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  const totalDocuments = useMemo(() => items.reduce((sum, item) => sum + item.document_count, 0), [items])

  async function handleCreate() {
    if (!newTitle.trim()) {
      toast.error('请填写作品标题')
      return
    }
    try {
      setCreating(true)
      const { writing_id } = await writingAPI.create({
        title: newTitle.trim(),
        kind: newKind,
        synopsis: newSynopsis.trim() || null,
        brief_json: buildBriefJson({
          worldview: newWorldview,
          background: newBackground,
          mainPlot: newMainPlot,
          mainCharacters: newMainCharacters,
        }),
      })
      toast.success('已创建作品')
      setOpen(false)
      setNewTitle('')
      setNewSynopsis('')
      setNewWorldview('')
      setNewBackground('')
      setNewMainPlot('')
      setNewMainCharacters('')
      setNewKind('novel')
      window.location.href = `/writing/${writing_id}`
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page-shell animate-fade-up">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex max-w-3xl flex-col gap-3">
            <div className="flex flex-col gap-2">
              <h1 className="page-title">小说剧本</h1>
            </div>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="h-11 gap-2">
                <Plus className="size-4" />
                新建作品
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>新建作品</DialogTitle>
              </DialogHeader>
              <div className="grid max-h-[70vh] gap-4 overflow-y-auto py-2 sm:grid-cols-2">
                <div className="flex flex-col gap-2 sm:col-span-2">
                  <label className="text-sm font-medium text-text-1" htmlFor="w-title">标题</label>
                  <Input id="w-title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="例如：雨夜邮局" className="h-11" />
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-text-1" htmlFor="w-kind">类型</label>
                  <select
                    id="w-kind"
                    value={newKind}
                    onChange={(e) => setNewKind(e.target.value as WritingKind)}
                    className="h-11 rounded-[var(--radius-md)] border border-border bg-bg-0 px-3 text-sm text-text-0"
                  >
                    <option value="novel">小说</option>
                    <option value="screenplay">文学剧本</option>
                    <option value="outline">大纲 / 设定</option>
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-text-1" htmlFor="w-syn">一句话梗概</label>
                  <Input id="w-syn" value={newSynopsis} onChange={(e) => setNewSynopsis(e.target.value)} placeholder="主角、目标、阻力" className="h-11" />
                </div>
                <div className="sm:col-span-2 rounded-[var(--radius-md)] border border-border bg-bg-2 p-3 text-xs leading-5 text-text-2">
                  创作准备可先跳过，后续在工作台补全；长篇、系列文、强设定题材建议尽早填写。
                </div>
                <Textarea value={newWorldview} onChange={(e) => setNewWorldview(e.target.value)} placeholder="世界观 / 规则（可选）" className="min-h-24" />
                <Textarea value={newBackground} onChange={(e) => setNewBackground(e.target.value)} placeholder="故事背景（可选）" className="min-h-24" />
                <Textarea value={newMainPlot} onChange={(e) => setNewMainPlot(e.target.value)} placeholder="主线 / 核心冲突（建议填）" className="min-h-24" />
                <Textarea value={newMainCharacters} onChange={(e) => setNewMainCharacters(e.target.value)} placeholder="主要人物 / 关系（建议填）" className="min-h-24" />
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} type="button">取消</Button>
                <Button onClick={() => void handleCreate()} disabled={creating} type="button">
                  {creating ? <Loader2 className="size-4 animate-spin" /> : '创建并进入工作台'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[var(--radius-md)] border border-border bg-bg-0 p-4">
            <p className="text-xs text-text-3">作品</p>
            <p className="mt-1 text-2xl font-semibold text-text-0">{items.length}</p>
          </div>
          <div className="rounded-[var(--radius-md)] border border-border bg-bg-0 p-4">
            <p className="text-xs text-text-3">文档</p>
            <p className="mt-1 text-2xl font-semibold text-text-0">{totalDocuments}</p>
          </div>
        </div>

        <div className="section-card flex flex-col gap-5">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题或摘要…" className="h-11 pl-10" />
          </div>

          {loading ? (
            <div className="flex min-h-[320px] items-center justify-center text-text-3"><Loader2 className="size-8 animate-spin" /></div>
          ) : items.length === 0 ? (
            <div className="flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-[var(--radius-md)] border border-dashed border-border bg-bg-2 px-6 text-center">
              <BookOpen className="size-10 text-accent" />
              <div>
                <p className="font-medium text-text-0">暂无作品</p>
                <p className="mt-1 text-sm text-text-2">点击「新建作品」开始；世界观和主线可以稍后再补。</p>
              </div>
              <Button onClick={() => setOpen(true)} type="button">新建作品</Button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {items.map((w) => (
                <Link
                  key={w.id}
                  href={`/writing/${w.id}`}
                  className="group flex min-h-[220px] flex-col justify-between rounded-[var(--radius-lg)] border border-border bg-bg-0 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
                >
                  <div className="flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-bg-2 text-accent">
                        <FileText className="size-5" />
                      </div>
                      <Badge variant="secondary">{STATUS_LABEL[w.status] ?? w.status}</Badge>
                    </div>
                    <div>
                      <h2 className="line-clamp-2 text-lg font-semibold text-text-0 group-hover:text-accent">{w.title}</h2>
                      <p className="mt-2 line-clamp-3 min-h-[60px] text-sm leading-5 text-text-2">
                        {w.synopsis || '还没有一句话梗概。进入工作台后可补充创作准备、章节和大纲。'}
                      </p>
                    </div>
                  </div>
                  <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-text-3">
                    <span>{KIND_LABEL[w.kind]}</span>
                    <span>{w.document_count} 文档</span>
                    <span>{formatDate(w.updated_at)}</span>
                    <ArrowRight className="size-4 transition group-hover:translate-x-0.5 group-hover:text-accent" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}