'use client'

import Link from 'next/link'
import { startTransition, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, BookOpen, Loader2, Plus, Search } from 'lucide-react'

import { writingAPI } from '@/lib/api'
import { formatDate, staticUrl } from '@/lib/utils'
import {
  ContentGridSkeleton,
  ContentPageHeader,
  ContentSurface,
} from '@/components/shared/content-kit'
import { EmptyState } from '@/components/shared/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogHeaderBar,
  DialogMain,
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

function WritingCover({ item }: { item: WritingListItem }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const coverSrc = staticUrl(item.cover_url)
  const hasCover = Boolean(coverSrc && failedSrc !== coverSrc)

  return (
    <div className="relative aspect-[16/9] overflow-hidden bg-bg-2">
      {hasCover ? (
        <img
          src={coverSrc}
          alt={`${item.title} 封面`}
          className="size-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.025]"
          onError={() => setFailedSrc(coverSrc)}
        />
      ) : (
        <div className="relative flex size-full items-center justify-center overflow-hidden bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_9%,transparent),color-mix(in_srgb,var(--color-bg-2)_82%,var(--color-bg-0)))]">
          <div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--color-bg-0)_44%,transparent)_0_1px,transparent_1px_64px),linear-gradient(0deg,color-mix(in_srgb,var(--color-bg-0)_38%,transparent)_0_1px,transparent_1px_64px)] opacity-45" />
          <div className="relative flex size-12 items-center justify-center bg-bg-0/70 text-text-3 backdrop-blur-[2px]">
            <BookOpen className="size-6" />
          </div>
        </div>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-bg-0/90 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <Badge className="content-glass-badge absolute right-3 top-3 text-[11px]" variant="secondary">
        {STATUS_LABEL[item.status] ?? item.status}
      </Badge>
    </div>
  )
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
        <Dialog open={open} onOpenChange={setOpen}>
          <ContentPageHeader
            title="小说"
            description="集中查看作品封面、简介、文档数和最近编辑时间。"
            actions={(
              <DialogTrigger asChild>
                <Button className="h-11 gap-2">
                  <Plus className="size-4" />
                  新建作品
                </Button>
              </DialogTrigger>
            )}
          />
          <DialogContent variant="form" size="large">
            <DialogHeaderBar variant="form">
              <DialogTitle>新建作品</DialogTitle>
            </DialogHeaderBar>
            <DialogMain variant="form" className="grid gap-4 sm:grid-cols-2">
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
            </DialogMain>
            <DialogActions variant="form">
              <Button variant="outline" onClick={() => setOpen(false)} type="button">取消</Button>
              <Button onClick={() => void handleCreate()} disabled={creating} type="button">
                {creating ? <Loader2 className="size-4 animate-spin" /> : '创建并进入工作台'}
              </Button>
            </DialogActions>
          </DialogContent>
        </Dialog>

        <ContentSurface>
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索标题或摘要…" className="h-11 pl-10" />
          </div>

          {loading ? (
            <ContentGridSkeleton
              count={6}
              className="md:grid-cols-2 xl:grid-cols-3"
              itemClassName="min-h-[280px] aspect-auto"
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title="暂无作品"
              description="点击「新建作品」开始；世界观和主线可以稍后再补。"
              className="min-h-[320px] justify-center border-0 bg-bg-0/70"
              actionLabel="新建作品"
              onAction={() => setOpen(true)}
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {items.map((w) => (
                <Link
                  key={w.id}
                  href={`/writing/${w.id}`}
                  className="content-card group min-h-[280px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-page"
                >
                  <WritingCover item={w} />
                  <div className="flex flex-1 flex-col justify-between px-4 pb-4 pt-3">
                    <div>
                      <h2 className="line-clamp-2 text-lg font-semibold text-text-0 group-hover:text-accent">{w.title}</h2>
                      <p className="mt-2 line-clamp-3 min-h-[60px] text-sm leading-5 text-text-2">
                        {w.synopsis || '还没有一句话梗概。进入工作台后可补充创作准备、章节和大纲。'}
                      </p>
                    </div>
                    <div className="mt-5 flex items-center justify-between gap-2 text-xs text-text-3">
                      <span>{KIND_LABEL[w.kind]}</span>
                      <span>{w.document_count} 文档</span>
                      <span>{formatDate(w.updated_at)}</span>
                      <ArrowRight className="size-4 transition group-hover:translate-x-0.5 group-hover:text-accent" />
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </ContentSurface>
      </div>
    </div>
  )
}
