'use client'

import { Suspense, startTransition, useState, useMemo, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ArrowUpDown,
  Clapperboard,
  Clock3,
  Film,
  LayoutGrid,
  Loader2,
  Plus,
  Search,
  Trash2,
  Users,
} from 'lucide-react'

import { dramaAPI } from '@/lib/api'
import { dramaStyleLabel, dramaStyleSelectOptions } from '@/lib/drama-style'
import { cn, formatDate, staticUrl } from '@/lib/utils'
import { BaseSelect } from '@/components/shared/base-select'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogHeaderBar,
  DialogMain,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Drama } from '@/types/api'

type SortOption = 'updated_at' | 'created_at' | 'title'

function getEpisodeCount(drama: Drama) {
  return drama.episode_count ?? drama.episodes?.length ?? drama.total_episodes ?? 0
}

function getCharacterCount(drama: Drama) {
  return drama.character_count ?? drama.characters?.length ?? 0
}

function DramaCard({
  drama,
  onOpen,
  onDelete,
}: {
  drama: Drama
  onOpen: () => void
  onDelete: () => void
}) {
  const thumbnail = staticUrl(drama.thumbnail)
  const episodes = getEpisodeCount(drama)
  const characters = getCharacterCount(drama)
  const styleLabel = drama.style ? dramaStyleLabel(drama.style) : null
  const updatedAt = formatDate(drama.updated_at)

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-0 shadow-shadow-xs transition-all duration-200 hover:border-border-strong hover:shadow-shadow-sm">
      {/* Thumbnail */}
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[16/9] w-full overflow-hidden bg-bg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-inset"
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt={drama.title} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <Film size={32} className="text-text-3" />
          </div>
        )}
        {styleLabel && (
          <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white">
            {styleLabel}
          </span>
        )}
      </button>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <button
          type="button"
          onClick={onOpen}
          className="text-left focus-visible:outline-none"
        >
          <h3 className="font-display text-base font-semibold text-text-0 line-clamp-2 hover:text-accent">
            {drama.title}
          </h3>
        </button>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2">
          <span className="inline-flex items-center gap-1">
            <LayoutGrid size={13} aria-hidden />
            {episodes} 集
          </span>
          <span className="inline-flex items-center gap-1">
            <Users size={13} aria-hidden />
            {characters} 角色
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 size={13} aria-hidden />
            {updatedAt}
          </span>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <div className="flex gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onOpen}
              className="h-8"
            >
              打开项目
            </Button>
          </div>
          <button
            type="button"
            onClick={onDelete}
            className="flex size-8 items-center justify-center rounded-full border border-border text-text-2 opacity-0 transition-all hover:bg-bg-hover hover:text-text-0 group-hover:opacity-100 focus-visible:opacity-100"
            title="删除项目"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  )
}

function DramaListPageContent() {
  const router = useRouter()
  const [dramas, setDramas] = useState<Drama[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>('updated_at')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({
    title: '',
    style: '',
  })
  const [creating, setCreating] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Drama | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const load = useMemo(() => async () => {
    setLoading(true)
    try {
      const res = await dramaAPI.list({ include_details: false }, { redirectOnUnauthorized: false })
      startTransition(() => {
        setDramas((res.items || []) as unknown as Drama[])
        setLoading(false)
      })
    } catch (e) {
      toast.error((e as Error).message)
      startTransition(() => setLoading(false))
    }
  }, [])

  // Load on mount
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const filteredDramas = useMemo(() => {
    let result = [...dramas]

    // Filter by query
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      result = result.filter((d) => d.title.toLowerCase().includes(q))
    }

    // Filter by style
    if (styleFilter) {
      result = result.filter((d) => d.style === styleFilter)
    }

    // Sort
    result.sort((a, b) => {
      if (sortBy === 'updated_at') {
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }
      if (sortBy === 'created_at') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
      return a.title.localeCompare(b.title)
    })

    return result
  }, [dramas, query, styleFilter, sortBy])

  async function handleCreate() {
    if (!form.title?.trim()) return
    try {
      setCreating(true)
      const drama = await dramaAPI.create({
        title: form.title,
        style: form.style,
      }) as unknown as Drama
      setShowCreate(false)
      setForm({
        title: '',
        style: '',
      })
      router.push(`/drama/${drama.id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      setDeleteLoading(true)
      await dramaAPI.del(deleteTarget.id)
      toast.success('已删除')
      setDeleteTarget(null)
      void load()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto w-full">
        {/* Header */}
        <div className="mb-7 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="page-title">短剧项目</h1>
          </div>
          <Button
            type="button"
            onClick={() => {
              setShowCreate(true)
            }}
            className="h-10 gap-2"
          >
            <Plus size={16} />
            新建短剧
          </Button>
        </div>

        <div className="section-card flex flex-col gap-5">
          {/* Filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative flex flex-1 items-center sm:max-w-xl">
              <Search className="pointer-events-none absolute left-3 size-4 text-text-3" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索标题..."
                className="h-11 pl-10"
              />
            </label>
            <div className="flex gap-2">
              <BaseSelect
                className="[&_button]:h-11 [&_button]:w-[120px]"
                value={styleFilter}
                onValueChange={(v) => setStyleFilter(String(v))}
                options={[{ label: '全部风格', value: '' }, ...dramaStyleSelectOptions]}
                placeholder="风格筛选"
              />
              <BaseSelect
                className="[&_button]:h-11 [&_button]:w-[140px]"
                value={sortBy}
                onValueChange={(v) => setSortBy(v as SortOption)}
                options={[
                  { label: '最近更新', value: 'updated_at' },
                  { label: '最近创建', value: 'created_at' },
                  { label: '标题 A-Z', value: 'title' },
                ]}
              />
            </div>
          </div>

          {/* Stats */}
          <p className="text-xs text-text-3">
            共 {filteredDramas.length} 个项目
            {query.trim() || styleFilter ? '（已筛选）' : ''}
          </p>

          {/* Grid */}
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[16/9] rounded-[var(--radius-md)] bg-gradient-to-r from-bg-2 via-bg-hover to-bg-2 bg-[length:200%_100%] animate-shimmer"
                />
              ))}
            </div>
          ) : filteredDramas.length === 0 ? (
            <EmptyState
              icon={Clapperboard}
              className="min-h-[320px] justify-center border-dashed bg-bg-2"
              description={query.trim() || styleFilter ? '没有符合筛选条件的项目' : '还没有短剧项目'}
              actionLabel="新建短剧"
              onAction={() => setShowCreate(true)}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredDramas.map((drama) => (
              <DramaCard
                key={drama.id}
                drama={drama}
                onOpen={() => router.push(`/drama/${drama.id}`)}
                onDelete={() => setDeleteTarget(drama)}
              />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent layout="panel" size="compact" className="animate-scale-in">
          <DialogHeaderBar density="compact" className="border-0 bg-transparent">
            <div className="flex gap-3 sm:gap-3.5">
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-accent-glow bg-accent-bg text-accent shadow-shadow-xs sm:size-10">
                <Plus className="size-[18px] sm:size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 pr-6 sm:pr-7">
                <DialogTitle className="font-display text-xl font-bold tracking-tight text-text-0 sm:text-[22px]">
                  新建短剧项目
                </DialogTitle>
              </div>
            </div>
          </DialogHeaderBar>

          <form
            onSubmit={(e) => {
              e.preventDefault()
              void handleCreate()
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogMain density="compact" className="min-h-0 flex-1 border-t border-border/70">
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-text-1">
                    项目名称 <span className="text-error">*</span>
                  </span>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                    placeholder="例如：都市情感短剧《时光邮局》"
                    required
                    autoFocus
                    className="h-11 text-sm"
                  />
                </label>
              </div>

              <div>
                <label className="flex min-w-0 flex-col gap-2">
                  <span className="text-xs font-medium text-text-2">视觉风格</span>
                  <BaseSelect
                    className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                    value={form.style}
                    onValueChange={(v) => setForm((f) => ({ ...f, style: String(v) }))}
                    options={dramaStyleSelectOptions}
                    placeholder="选择风格"
                  />
                </label>
              </div>
            </DialogMain>

            <DialogActions density="compact" className="sm:items-center sm:justify-end">
              <Button
                type="button"
                variant="ghost"
                className="h-10 w-full sm:w-auto sm:min-w-[88px]"
                onClick={() => setShowCreate(false)}
              >
                取消
              </Button>
              <Button
                type="submit"
                disabled={!form.title?.trim() || creating}
                className="h-10 w-full rounded-full px-6 shadow-primary-glow sm:w-auto sm:min-w-[148px]"
              >
                {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
                创建项目
              </Button>
            </DialogActions>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="删除项目"
        description={
          deleteTarget
            ? `确定删除「${deleteTarget.title}」？此操作不可恢复。`
            : ''
        }
        confirmLabel="删除"
        loading={deleteLoading}
        onConfirm={handleDelete}
      />
    </div>
  )
}

function DramaListPageFallback() {
  return (
    <div className="page-shell">
      <div className="mx-auto w-full">
        <div className="mb-7 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="h-8 w-36 animate-shimmer rounded-lg bg-bg-2" />
            <div className="h-4 w-64 animate-shimmer rounded bg-bg-2" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[16/9] animate-shimmer rounded-[var(--radius-md)] bg-bg-2" />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function DramaListPage() {
  return (
    <Suspense fallback={<DramaListPageFallback />}>
      <DramaListPageContent />
    </Suspense>
  )
}
