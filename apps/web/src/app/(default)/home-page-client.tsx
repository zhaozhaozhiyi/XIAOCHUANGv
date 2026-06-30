'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Clock3,
  Film,
  LayoutGrid,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'

import { CREATE_HEADER_VARIANTS, type CreateHeaderVariant } from '@/app/(default)/home-page-copy'
import { dramaAPI } from '@/lib/api'
import { cn } from '@/lib/cn'
import { dramaStyleLabel, dramaStyleSelectOptions, dramaStyleWarning } from '@/lib/drama-style'
import { clearHomeCreateDraft, readHomeCreateDraft } from '@/lib/home-create-draft'
import { redirectToLogin } from '@/lib/login-redirect'
import { formatDate, staticUrl } from '@/lib/utils'
import { HomeInputComposer } from '@/components/create/home-input-composer'
import { BaseSelect } from '@/components/shared/base-select'
import { EmptyState } from '@/components/shared/empty-state'
import { useAppSession } from '@/components/shared/app-session-provider'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogHeaderBar,
  DialogMain,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { ModelSelectOption } from '@/components/create/input-composer-types'
import type { Drama } from '@/types/api'

const CREATE_PROJECT_PATH = '/?create=1'

type CreateEntry = {
  id: string
  title: string
  subtitle: string
  iconSrc: string
  iconAlt: string
  actionText: string
  action: 'route' | 'dialog'
  href?: string
}

const CREATE_ENTRIES: CreateEntry[] = [
  {
    id: 'drama',
    title: '新建短剧',
    subtitle: '创建完整短剧工程',
    iconSrc: '/create-drama.png',
    iconAlt: '新建短剧',
    actionText: '立即创建',
    action: 'dialog',
  },
  {
    id: 'writing',
    title: '小说剧本',
    subtitle: '长文创作与叙事整理',
    iconSrc: '/novel-script.png',
    iconAlt: '小说剧本',
    actionText: '去写作',
    action: 'route',
    href: '/writing',
  },
  {
    id: 'canvas',
    title: '智能画布',
    subtitle: '直接进入纯画布，自由整理资产与内容',
    iconSrc: '/canvas-board.png',
    iconAlt: '智能画布',
    actionText: '去画布',
    action: 'route',
    href: '/canvas',
  },
]

function getEpisodeCount(drama: Drama) {
  return drama.episode_count ?? drama.episodes?.length ?? drama.total_episodes ?? 0
}

function getCharacterCount(drama: Drama) {
  return drama.character_count ?? drama.characters?.length ?? 0
}

function getProgress(drama: Drama) {
  if (drama.script_progress_percent != null) return drama.script_progress_percent
  if (!drama.episodes?.length) return 0
  const scripted = drama.episodes.filter((episode) => episode.script_content).length
  return Math.round((scripted / drama.episodes.length) * 100)
}

function CreateEntryCard({
  entry,
  onActivate,
}: {
  entry: CreateEntry
  onActivate: () => void
}) {
  const { title, subtitle, iconSrc, iconAlt, actionText } = entry

  return (
    <button
      type="button"
      onClick={onActivate}
      className={cn(
        'group relative flex h-full min-h-[120px] items-center gap-4 rounded-[18px] border bg-bg-0 px-4 py-4 pr-12 text-left shadow-shadow-xs transition-all duration-200',
        'hover:border-border-strong hover:shadow-shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0',
        'border-border',
      )}
    >
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-[16px] bg-bg-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconSrc}
          alt={iconAlt}
          className="size-full scale-110 object-contain transition-transform duration-300 ease-out group-hover:scale-[1.28] group-focus-visible:scale-[1.28]"
        />
      </div>

      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-semibold leading-tight text-text-0 sm:text-xl">
          {title}
        </h2>
        <p className="mt-1 text-xs leading-snug text-text-2 sm:text-[13px]">
          {subtitle}
        </p>
      </div>

      <span
        className="pointer-events-none absolute right-3 top-1/2 flex size-8 -translate-y-1/2 translate-x-1 items-center justify-center rounded-full bg-accent-bg text-accent opacity-0 shadow-shadow-xs transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
        aria-hidden
      >
        <ArrowRight size={16} />
      </span>
      <span className="sr-only">{actionText}</span>
    </button>
  )
}

function ProjectHistoryCard({
  drama,
  href,
}: {
  drama: Drama
  href: string
}) {
  const progress = getProgress(drama)
  const thumbnail = staticUrl(drama.thumbnail)
  const episodes = getEpisodeCount(drama)
  const styleLabel = drama.style ? dramaStyleLabel(drama.style) : null

  return (
    <Link
      href={href}
      className="group flex cursor-pointer gap-4 rounded-[var(--radius-md)] border border-border bg-bg-0 p-4 shadow-shadow-xs transition-all duration-200 hover:border-border-strong hover:shadow-shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0 sm:items-center"
    >
      <div
        className={cn(
          'relative flex size-[72px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-border bg-bg-zone',
          thumbnail ? 'border-border-strong' : '',
        )}
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbnail} alt="" className="size-full object-cover" />
        ) : (
          <Film size={28} className="text-text-3" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate font-display text-base font-semibold text-text-0 sm:text-lg">{drama.title}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-2 sm:text-sm">
              {styleLabel ? <span>{styleLabel}</span> : null}
              <span className="inline-flex items-center gap-1">
                <LayoutGrid size={13} aria-hidden />
                {episodes} 集
              </span>
              <span className="inline-flex items-center gap-1">
                <Users size={13} aria-hidden />
                {getCharacterCount(drama)} 角色
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock3 size={13} aria-hidden />
                {formatDate(drama.updated_at)}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-bg-3">
            <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-text-2">剧本 {progress}%</span>
          <ArrowRight
            size={16}
            className="hidden shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5 group-hover:text-accent sm:block"
            aria-hidden
          />
        </div>
      </div>
    </Link>
  )
}

export function HomePageClient({
  initialDramas,
  createHeader,
  initialImageModelOptions,
}: {
  initialDramas: Drama[]
  createHeader: CreateHeaderVariant
  initialImageModelOptions: ModelSelectOption[]
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { authenticated, currentUser, refreshSession } = useAppSession()
  const [dramas, setDramas] = useState<Drama[]>(initialDramas)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ title: '', style: '' })
  const [sourceTaskId, setSourceTaskId] = useState<string | null>(null)
  const [entryError, setEntryError] = useState('')
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)

  const openLoginForTarget = useCallback((targetPath: string) => {
    redirectToLogin(targetPath)
  }, [])

  const checkAuthenticated = useCallback(async () => {
    try {
      if (authenticated && currentUser) return true
      const nextSession = await refreshSession()
      return Boolean(nextSession)
    } catch (error: unknown) {
      const message = (error as Error).message || '登录状态校验失败，请稍后重试'
      setEntryError(message)
      toast.error(message)
      return false
    }
  }, [authenticated, currentUser, refreshSession])

  const startCreateProject = useCallback(async () => {
    setEntryError('')
    const isAuthenticated = await checkAuthenticated()
    if (!isAuthenticated) {
      openLoginForTarget(CREATE_PROJECT_PATH)
      return
    }
    setSourceTaskId(null)
    setCreateError('')
    setShowCreate(true)
  }, [checkAuthenticated, openLoginForTarget])

  const enterCreativePage = useCallback(async (targetPath: string) => {
    setEntryError('')
    const isAuthenticated = await checkAuthenticated()
    if (!isAuthenticated) {
      openLoginForTarget(targetPath)
      return
    }
    router.push(targetPath)
  }, [checkAuthenticated, openLoginForTarget, router])

  const handleCreateDialogOpenChange = useCallback((open: boolean) => {
    if (!open) setCreateError('')
    setShowCreate(open)
  }, [])

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      if (!authenticated) return
      const draft = readHomeCreateDraft()
      const prefillTitle = draft?.title ?? searchParams.get('prefill_title')
      const prefillStyle = draft?.style ?? searchParams.get('prefill_style')
      const nextSourceTaskId = draft?.source_task_id ?? searchParams.get('source_task_id')
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm({
        title: prefillTitle ? decodeURIComponent(prefillTitle) : '',
        style: prefillStyle ? decodeURIComponent(prefillStyle) : '',
      })
      setSourceTaskId(nextSourceTaskId)
      setCreateError('')
      setShowCreate(true)
      clearHomeCreateDraft()
      router.replace('/', { scroll: false })
    }
  }, [authenticated, searchParams, router])

  const sortedDramas = useMemo(
    () => [...dramas].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [dramas],
  )

  const handleCreateEntry = useCallback(
    (entry: CreateEntry) => {
      if (entry.action === 'dialog') {
        void startCreateProject()
        return
      }
      if (entry.href) void enterCreativePage(entry.href)
    },
    [enterCreativePage, startCreateProject],
  )

  async function create() {
    const normalizedTitle = form.title.trim()
    if (!normalizedTitle) {
      setCreateError('请输入项目名称后再创建。')
      return
    }
    try {
      setCreating(true)
      setCreateError('')
      const payload: Record<string, unknown> = {
        ...form,
        title: normalizedTitle,
      }
      if (sourceTaskId) {
        payload.metadata = {
          source_task_id: Number(sourceTaskId),
          source_type: 'quick_video',
          upgraded_at: new Date().toISOString(),
        }
      }

      const drama = await dramaAPI.create(payload) as unknown as Drama
      setShowCreate(false)
      setSourceTaskId(null)
      router.push(`/drama/${drama.id}`)
    } catch (error: unknown) {
      const message = (error as Error).message || '创建失败，请稍后重试'
      setCreateError(message)
      toast.error(message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="page-shell page-shell--wide animate-fade-up">
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-7">
        <section aria-labelledby="workbench-create-heading" className="space-y-4">
          <div className="flex min-h-32 w-full flex-col items-center justify-center text-center sm:min-h-36">
            <h2
              id="workbench-create-heading"
              className="font-display !text-4xl font-semibold !leading-tight tracking-tight text-text-0 sm:!text-5xl"
            >
              {createHeader.title}
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-center text-sm leading-7 text-text-2 sm:text-base">
              {createHeader.description}
            </p>
          </div>
          <HomeInputComposer initialImageModelOptions={initialImageModelOptions} />
          <div className="grid gap-4 lg:grid-cols-3 lg:max-w-[1080px]">
            {CREATE_ENTRIES.map((entry) => (
              <CreateEntryCard key={entry.id} entry={entry} onActivate={() => handleCreateEntry(entry)} />
            ))}
          </div>
          {entryError ? (
            <div
              role="alert"
              aria-live="polite"
              className="max-w-[1080px] rounded-[var(--radius-sm)] border border-error/30 bg-error-bg px-4 py-3 text-sm text-error"
            >
              {entryError}
            </div>
          ) : null}
        </section>

        <section id="workbench-history" aria-labelledby="workbench-history-heading" className="space-y-4 scroll-mt-6">
          <div className="flex items-center justify-between">
            <h2 id="workbench-history-heading" className="text-sm font-semibold tracking-wide text-text-1">
              继续创作
            </h2>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 rounded-full px-3 text-text-2"
              onClick={() => {
                void enterCreativePage('/drama')
              }}
            >
              查看全部
              <ArrowRight size={14} className="ml-1" />
            </Button>
          </div>

          {sortedDramas.length ? (
            <div className="grid gap-3">
              {sortedDramas.slice(0, 4).map((drama) => (
                <ProjectHistoryCard
                  key={drama.id}
                  drama={drama}
                  href={`/drama/${drama.id}`}
                />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              description="这里会显示你最近更新的项目。现在还没有内容，可以先创建一个短剧项目开始。"
              actionLabel="新建短剧"
              onAction={() => {
                void startCreateProject()
              }}
            />
          )}
        </section>
      </div>

      <Dialog open={showCreate} onOpenChange={handleCreateDialogOpenChange}>
        <DialogContent layout="panel" size="compact" className="animate-scale-in">
          <DialogHeaderBar density="compact" className="border-0 bg-transparent">
            <div className="flex gap-3 sm:gap-3.5">
              <div
                className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-accent-glow bg-accent-bg text-accent shadow-shadow-xs sm:size-10"
                aria-hidden
              >
                <Plus className="size-[18px] sm:size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 pr-6 sm:pr-7">
                <DialogTitle className="font-display text-xl font-bold tracking-tight text-text-0 sm:text-[22px]">
                  新建短剧项目
                </DialogTitle>
                {sourceTaskId ? (
                  <div className="mt-2.5 inline-flex w-fit max-w-full items-center rounded-full border border-accent-glow bg-accent-bg px-3 py-1 text-[11px] font-medium text-accent-text">
                    来自快速成片任务 #{sourceTaskId} 的升级创建
                  </div>
                ) : null}
              </div>
            </div>
          </DialogHeaderBar>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              create()
            }}
            className="flex min-h-0 flex-1 flex-col"
          >
            <DialogMain density="compact" className="min-h-0 flex-1 border-t border-border/70">
              {createError ? (
                <div
                  role="alert"
                  aria-live="polite"
                  className="rounded-[var(--radius-sm)] border border-error/30 bg-error-bg px-4 py-3 text-sm text-error"
                >
                  {createError}
                </div>
              ) : null}
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-text-1">
                    项目名称 <span className="text-error">*</span>
                  </span>
                  <Input
                    value={form.title}
                    onChange={(event) => {
                      setCreateError('')
                      setForm((current) => ({ ...current, title: event.target.value }))
                    }}
                    placeholder="例如：都市情感短剧《时光邮局》"
                    required
                    autoFocus
                    className="h-11 text-sm"
                  />
                </label>
              </div>

              <div>
                <div className="grid grid-cols-1 gap-4">
                  <label className="flex min-w-0 flex-col gap-2">
                    <span className="text-xs font-medium text-text-2">视觉风格</span>
                    <BaseSelect
                      className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                      value={form.style}
                      onValueChange={(value) => {
                        setCreateError('')
                        setForm((current) => ({ ...current, style: String(value) }))
                      }}
                      options={dramaStyleSelectOptions}
                      placeholder="选择风格"
                    />
                    {dramaStyleWarning(form.style) ? (
                      <span className="text-[11px] leading-snug text-warning">
                        {dramaStyleWarning(form.style)}
                      </span>
                    ) : null}
                  </label>
                </div>
              </div>
            </DialogMain>

            <DialogActions density="compact" className="sm:items-center sm:justify-end">
              <Button type="button" variant="ghost" className="h-10 w-full sm:w-auto sm:min-w-[88px]" onClick={() => handleCreateDialogOpenChange(false)} disabled={creating}>
                取消
              </Button>
              <Button type="submit" className="h-10 w-full rounded-full px-6 shadow-primary-glow sm:w-auto sm:min-w-[148px]" disabled={!form.title.trim() || creating}>
                <Plus size={15} />
                {creating ? '创建中...' : '创建项目'}
              </Button>
            </DialogActions>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function HomePageFallback() {
  return (
    <div className="page-shell page-shell--wide animate-fade-up">
      <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-10">
        <div className="space-y-2">
          <div className="h-8 w-36 animate-shimmer rounded-lg bg-bg-2" />
          <div className="h-4 w-64 animate-shimmer rounded bg-bg-2" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-[168px] animate-shimmer rounded-[var(--radius-md)] bg-bg-2" />
          ))}
        </div>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="h-[88px] animate-shimmer rounded-[var(--radius-md)] bg-bg-2" />
          ))}
        </div>
      </div>
    </div>
  )
}
