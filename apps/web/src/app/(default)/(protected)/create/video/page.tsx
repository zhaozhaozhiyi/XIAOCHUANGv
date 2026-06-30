'use client'

import { Suspense, type ReactNode } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  BookmarkPlus,
  Clock3,
  Download,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Music2,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Sparkles,
  Video,
} from 'lucide-react'

import { assetAPI, audioAPI, imageAPI, quickVideoAPI, taskAPI } from '@/lib/api'
import { staticUrl } from '@/lib/utils'
import { takeQuickCreatePending } from '@/components/create/quick-create-pending'
import type { ComposerPrefill, ComposerSubmitPayload } from '@/components/create/input-composer-types'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { AssetRecord, ImageGeneration, TaskRecord } from '@/types/api'

type RecentItem =
  | { key: string; kind: 'video'; updated_at: string; task: TaskRecord }
  | { key: string; kind: 'image'; updated_at: string; image: ImageGeneration }
  | { key: string; kind: 'audio'; updated_at: string; asset: AssetRecord }

// 懒加载输入框：该组件体积较大，且首页已加载过同一 chunk，
// 在本页按需加载可减小路由 chunk、加快进入对话页的速度。
const InputComposer = dynamic(
  () => import('@/components/create/input-composer').then((mod) => ({ default: mod.InputComposer })),
  {
    ssr: false,
    loading: () => <div className="h-[188px] animate-pulse rounded-[20px] border border-border bg-bg-0" />,
  },
)

function statusMeta(status: string) {
  switch (status) {
    case 'completed':
      return { label: '已完成', variant: 'default' as const }
    case 'failed':
      return { label: '失败', variant: 'destructive' as const }
    case 'running':
    case 'processing':
      return { label: '生成中', variant: 'secondary' as const }
    case 'canceled':
      return { label: '已取消', variant: 'outline' as const }
    default:
      return { label: '排队中', variant: 'secondary' as const }
  }
}

function statusGroup(status: string): 'completed' | 'processing' | 'failed' | 'canceled' {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'canceled') return 'canceled'
  return 'processing'
}

function imageRatioToSize(aspectRatio: string) {
  const ratio = String(aspectRatio || '').trim()
  if (!ratio || ratio === 'auto') return '2048x2048'
  const [wRaw, hRaw] = ratio.split(':').map((item) => Number(item))
  const wRatio = Number.isFinite(wRaw) && wRaw > 0 ? wRaw : 1
  const hRatio = Number.isFinite(hRaw) && hRaw > 0 ? hRaw : 1
  const side = 2048
  if (wRatio === hRatio) return `${side}x${side}`
  if (wRatio > hRatio) {
    const height = Math.max(256, Math.round((side * hRatio) / wRatio / 2) * 2)
    return `${side}x${height}`
  }
  const width = Math.max(256, Math.round((side * wRatio) / hRatio / 2) * 2)
  return `${width}x${side}`
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function sizeToRatioLabel(size: string | null): string {
  const [w, h] = String(size || '').split('x').map((item) => Number(item))
  if (!Number.isFinite(w) || !Number.isFinite(h) || !w || !h) return ''
  const divisor = gcd(w, h) || 1
  return `${w / divisor}:${h / divisor}`
}

function sizeToResolutionLabel(size: string | null): string {
  const [w, h] = String(size || '').split('x').map((item) => Number(item))
  if (!Number.isFinite(w) || !Number.isFinite(h)) return ''
  return Math.max(w, h) >= 3000 ? '4K' : '2K'
}

function normalizeImageRecord(raw: Record<string, unknown>): ImageGeneration {
  return {
    id: Number(raw.id || 0),
    storyboard_id: Number(raw.storyboard_id ?? raw.storyboardId ?? 0) || null,
    drama_id: Number(raw.drama_id ?? raw.dramaId ?? 0) || null,
    scene_id: Number(raw.scene_id ?? raw.sceneId ?? 0) || null,
    character_id: Number(raw.character_id ?? raw.characterId ?? 0) || null,
    prop_id: Number(raw.prop_id ?? raw.propId ?? 0) || null,
    image_type: String(raw.image_type ?? raw.imageType ?? '') || null,
    frame_type: String(raw.frame_type ?? raw.frameType ?? '') || null,
    provider: String(raw.provider ?? '') || null,
    prompt: String(raw.prompt ?? '') || null,
    model: String(raw.model ?? '') || null,
    size: String(raw.size ?? '') || null,
    image_url: String(raw.image_url ?? raw.imageUrl ?? '') || null,
    status: String(raw.status ?? ''),
    task_id: String(raw.task_id ?? raw.taskId ?? '') || null,
    error_msg: String(raw.error_msg ?? raw.errorMsg ?? '') || null,
    width: Number(raw.width ?? 0) || null,
    height: Number(raw.height ?? 0) || null,
    created_at: String(raw.created_at ?? raw.createdAt ?? ''),
    updated_at: String(raw.updated_at ?? raw.updatedAt ?? ''),
    completed_at: String(raw.completed_at ?? raw.completedAt ?? '') || null,
  }
}

function resolveImagePreviewUrl(image: ImageGeneration | null): string {
  if (!image) return ''
  return staticUrl(image.image_url || '')
}

function resolveAssetPreviewUrl(asset: AssetRecord | null): string {
  if (!asset) return ''
  return staticUrl(asset.url || '')
}

const MODE_META = {
  video: { label: '视频生成', Icon: Video },
  image: { label: '图片生成', Icon: ImageIcon },
  audio: { label: '音频生成', Icon: Music2 },
} as const

const KIND_FILTERS = [
  { value: 'all', label: '全部模式' },
  { value: 'image', label: '图片生成' },
  { value: 'video', label: '视频生成' },
  { value: 'audio', label: '音频生成' },
] as const

const STATUS_FILTERS = [
  { value: 'all', label: '全部状态' },
  { value: 'completed', label: '已完成' },
  { value: 'processing', label: '生成中' },
  { value: 'failed', label: '失败' },
] as const

const SORT_OPTIONS = [
  { value: 'asc', label: '最早在上' },
  { value: 'desc', label: '最新在上' },
] as const

type KindFilter = (typeof KIND_FILTERS)[number]['value']
type StatusFilter = (typeof STATUS_FILTERS)[number]['value']
type SortOrder = (typeof SORT_OPTIONS)[number]['value']

interface ChatTurn {
  key: string
  kind: 'video' | 'image' | 'audio'
  userText: string
  status: string
  updatedAt: string
  previewUrl: string
  error: string | null
  metaChips: string[]
  prefill: ComposerPrefill
  task: TaskRecord | null
  image: ImageGeneration | null
  asset: AssetRecord | null
}

function toChatTurn(item: RecentItem): ChatTurn {
  if (item.kind === 'video') {
    const payload = (item.task.payload ?? {}) as Record<string, unknown>
    const promptFromPayload = typeof payload.prompt === 'string' ? (payload.prompt as string) : ''
    const userText = promptFromPayload || item.task.title || `视频任务 #${item.task.id}`
    const model = typeof payload.model === 'string' ? (payload.model as string) : ''
    const ratio = typeof payload.aspect_ratio === 'string' ? (payload.aspect_ratio as string) : ''
    const duration = Number(payload.duration ?? 0)
    return {
      key: item.key,
      kind: 'video',
      userText,
      status: item.task.status,
      updatedAt: item.task.updated_at,
      previewUrl: staticUrl(item.task.result_summary?.video_url || ''),
      error: item.task.error_message,
      metaChips: [model, ratio, duration ? `${duration}s` : ''].filter(Boolean),
      prefill: { nonce: 0, prompt: userText, toolbar_mode: 'video', aspect_ratio: ratio || undefined, video_model: model || undefined },
      task: item.task,
      image: null,
      asset: null,
    }
  }
  if (item.kind === 'audio') {
    const userText = item.asset.title || `音频任务 #${item.asset.id}`
    return {
      key: item.key,
      kind: 'audio',
      userText,
      status: 'completed',
      updatedAt: item.asset.updated_at,
      previewUrl: resolveAssetPreviewUrl(item.asset),
      error: null,
      metaChips: ['音频'],
      prefill: { nonce: 0, prompt: userText, toolbar_mode: 'audio' },
      task: null,
      image: null,
      asset: item.asset,
    }
  }
  const userText = item.image.prompt || `图片任务 #${item.image.id}`
  return {
    key: item.key,
    kind: 'image',
    userText,
    status: item.image.status,
    updatedAt: item.image.updated_at,
    previewUrl: resolveImagePreviewUrl(item.image),
    error: item.image.error_msg,
    metaChips: [item.image.model || '', sizeToRatioLabel(item.image.size), sizeToResolutionLabel(item.image.size)].filter(Boolean),
    prefill: { nonce: 0, prompt: userText, toolbar_mode: 'image', image_model: item.image.model || undefined },
    task: null,
    image: item.image,
    asset: null,
  }
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function dayKey(dateStr: string) {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

function dayLabel(dateStr: string) {
  const d = new Date(dateStr)
  const now = new Date()
  if (sameDay(d, now)) return '今天'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (sameDay(d, yesterday)) return '昨天'
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

function CreateVideoPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [submitting, setSubmitting] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(true)
  // 三类列表各自独立，谁先返回谁先渲染，避免被最慢的接口拖住整页。
  const [videoItems, setVideoItems] = useState<RecentItem[]>([])
  const [imageItems, setImageItems] = useState<RecentItem[]>([])
  const [audioItems, setAudioItems] = useState<RecentItem[]>([])
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [regeneratingKey, setRegeneratingKey] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<ComposerPrefill | null>(null)
  const [pendingTurns, setPendingTurns] = useState<ChatTurn[]>([])

  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const prefillNonceRef = useRef(0)

  const prefilledPrompt = searchParams.get('prompt') || ''

  const recentItems = useMemo(
    () =>
      [...videoItems, ...imageItems, ...audioItems]
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 12),
    [videoItems, imageItems, audioItems],
  )

  const conversation = useMemo(
    () => [...recentItems].sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()).map(toChatTurn),
    [recentItems],
  )

  const allTurns = useMemo(
    () => (pendingTurns.length ? [...conversation, ...pendingTurns] : conversation),
    [conversation, pendingTurns],
  )

  const groups = useMemo(() => {
    const filtered = allTurns.filter((turn) => {
      if (kindFilter !== 'all' && turn.kind !== kindFilter) return false
      if (statusFilter !== 'all' && statusGroup(turn.status) !== statusFilter) return false
      return true
    })
    const ordered = sortOrder === 'asc' ? filtered : [...filtered].reverse()
    const result: Array<{ key: string; label: string; turns: ChatTurn[] }> = []
    for (const turn of ordered) {
      const key = dayKey(turn.updatedAt)
      const last = result[result.length - 1]
      if (last && last.key === key) last.turns.push(turn)
      else result.push({ key, label: dayLabel(turn.updatedAt), turns: [turn] })
    }
    return result
  }, [allTurns, kindFilter, statusFilter, sortOrder])

  const hasResults = groups.length > 0
  const stickEnabled = sortOrder === 'asc'

async function loadTasks(options?: { silent?: boolean }) {
    const silent = options?.silent === true
    if (!silent) setLoadingTasks(true)

    // 视频是“快速成片”的主产物：它一返回就先渲染并关掉首屏 spinner，
    // 图片 / 音频列表稍后到达再增量补齐，互不阻塞。
    const videoTask = taskAPI
      .list({ source_type: 'quick_video', page_size: 8, sort: 'updated_at' })
      .then((videoPayload) => {
        setVideoItems(
          (videoPayload.items || []).map((task) => ({
            key: `video-${task.id}`,
            kind: 'video' as const,
            updated_at: task.updated_at,
            task,
          })),
        )
      })
      .catch((error) => {
        if (!silent) toast.error((error as Error).message)
      })
      .finally(() => {
        if (!silent) setLoadingTasks(false)
      })

    const imageTask = imageAPI
      .list()
      .then((imageItemsRaw) => {
        const images = (imageItemsRaw || []).map((item) => normalizeImageRecord(item as unknown as Record<string, unknown>))
        setImageItems(
          images.map((image) => ({
            key: `image-${image.id}`,
            kind: 'image' as const,
            updated_at: image.updated_at,
            image,
          })),
        )
      })
      .catch(() => {})

    const audioTask = assetAPI
      .list({ kind: 'audio', source_type: 'quick_video' })
      .then((audioAssets) => {
        setAudioItems(
          (audioAssets.items || []).map((asset) => ({
            key: `audio-${asset.id}`,
            kind: 'audio' as const,
            updated_at: asset.updated_at,
            asset,
          })),
        )
      })
      .catch(() => {})

    await Promise.allSettled([videoTask, imageTask, audioTask])
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTasks()
    const timer = window.setInterval(() => {
      void loadTasks({ silent: true })
    }, 8000)

    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    // 首页发送后跳转到此：取出待生成参数并立即发起生成，让创作立刻出现在对话中。
    const pending = takeQuickCreatePending()
    if (!pending) return
    // 同步首页所选模式与参数到底部输入框（prompt 留空，仅保留模式/模型/比例）。
    prefillNonceRef.current += 1
    setPrefill({
      nonce: prefillNonceRef.current,
      prompt: '',
      toolbar_mode: pending.toolbar_mode,
      aspect_ratio: pending.aspect_ratio,
      video_model: pending.toolbar_mode === 'video' ? pending.video_model : undefined,
      image_model: pending.toolbar_mode === 'image' ? pending.video_model : undefined,
      audio_config_id: pending.toolbar_mode === 'audio' ? pending.audio_config_id : undefined,
    })
    void runGeneration(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!stickEnabled || !stickToBottomRef.current) return
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [groups, loadingTasks, stickEnabled])

  function handleConversationScroll() {
    const el = scrollRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
  }

  async function runGeneration(payload: ComposerSubmitPayload) {
    // 立即插入一条“生成中”的乐观占位卡片，让用户提交后马上看到反馈，
    // 不必等待创建接口与列表刷新返回（接口返回后由 loadTasks 用真实数据替换）。
    const optimisticKey = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const optimisticTurn: ChatTurn = {
      key: optimisticKey,
      kind: payload.toolbar_mode,
      userText: payload.prompt,
      status: 'processing',
      updatedAt: new Date().toISOString(),
      previewUrl: '',
      error: null,
      metaChips:
        payload.toolbar_mode === 'audio'
          ? ['音频']
          : [
              payload.video_model,
              payload.aspect_ratio,
              payload.toolbar_mode === 'video' && payload.duration ? `${payload.duration}s` : '',
            ].filter(Boolean),
      prefill: { nonce: 0, prompt: payload.prompt, toolbar_mode: payload.toolbar_mode },
      task: null,
      image: null,
      asset: null,
    }
    setPendingTurns((current) => [...current, optimisticTurn])
    try {
      setSubmitting(true)
      stickToBottomRef.current = true
      if (payload.toolbar_mode === 'image') {
        await imageAPI.generate({
          prompt: payload.prompt,
          model: payload.video_model,
          size: imageRatioToSize(payload.aspect_ratio),
          reference_images: payload.reference_image_urls,
        })
        toast.success('图片任务已创建')
      } else if (payload.toolbar_mode === 'audio') {
        const audio = await audioAPI.generate({
          text: payload.prompt,
          config_id: payload.audio_config_id ?? undefined,
          voice_id: payload.voice_id,
          speed: payload.audio_speed,
          emotion: payload.audio_emotion,
        })
        toast.success(audio?.asset_id ? '音频已生成并已进入资产库' : '音频已生成')
      } else {
        await quickVideoAPI.generate({
          prompt: payload.prompt,
          model: payload.video_model,
          reference_mode: payload.video_reference_mode,
          image_url: payload.image_url,
          first_frame_url: payload.first_frame_url,
          last_frame_url: payload.last_frame_url,
          reference_image_urls: payload.reference_image_urls,
          duration: payload.duration,
          aspect_ratio: payload.aspect_ratio,
        })
        toast.success('视频任务已创建')
      }
      await loadTasks()
      return true
    } catch (error) {
      toast.error((error as Error).message)
      return false
    } finally {
      setSubmitting(false)
      setPendingTurns((current) => current.filter((turn) => turn.key !== optimisticKey))
    }
  }

  async function handleRegenerate(turn: ChatTurn) {
    try {
      setRegeneratingKey(turn.key)
      stickToBottomRef.current = true
      if (turn.kind === 'image' && turn.image) {
        await imageAPI.generate({
          prompt: turn.image.prompt || turn.userText,
          model: turn.image.model || undefined,
          size: turn.image.size || undefined,
        })
      } else if (turn.kind === 'video' && turn.task) {
        const payload = (turn.task.payload ?? {}) as Record<string, unknown>
        await quickVideoAPI.generate({
          prompt: (payload.prompt as string) || turn.userText,
          model: payload.model,
          reference_mode: payload.reference_mode,
          image_url: payload.image_url,
          first_frame_url: payload.first_frame_url,
          last_frame_url: payload.last_frame_url,
          reference_image_urls: payload.reference_image_urls,
          duration: payload.duration,
          aspect_ratio: payload.aspect_ratio,
        })
      } else if (turn.kind === 'audio' && turn.asset) {
        await audioAPI.generate({ text: turn.asset.title || turn.userText })
      }
      toast.success('已再次提交生成')
      await loadTasks()
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setRegeneratingKey(null)
    }
  }

  function handleReEdit(turn: ChatTurn) {
    prefillNonceRef.current += 1
    setPrefill({ ...turn.prefill, nonce: prefillNonceRef.current })
    toast.message('已载入到输入框，可修改后再次生成')
  }

  async function handleSaveAsset(turn: ChatTurn) {
    if (turn.task) {
      try {
        setSavingKey(turn.key)
        await assetAPI.fromTask(turn.task.id)
        toast.success('已保存到资产库')
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setSavingKey(null)
      }
      return
    }

    if (!turn.image?.task_id) return
    try {
      setSavingKey(turn.key)
      await assetAPI.fromTask(Number(turn.image.task_id))
      toast.success('已保存到资产库')
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <div className="quick-create-chat flex h-full min-h-0 flex-col">
      <header className="shrink-0 bg-bg-surface/80 px-4 py-2.5 backdrop-blur sm:px-6">
        <div className="mx-auto flex w-full max-w-[1040px] items-center justify-between gap-3">
          <h1 className="shrink-0 text-base font-semibold text-text-0">快速成片</h1>
          <div className="flex shrink-0 items-center gap-1.5">
            <FilterMenu
              label={SORT_OPTIONS.find((item) => item.value === sortOrder)?.label ?? '时间'}
              icon={<Clock3 size={14} />}
              options={SORT_OPTIONS}
              value={sortOrder}
              onSelect={(value) => setSortOrder(value as SortOrder)}
            />
            <FilterMenu
              label={KIND_FILTERS.find((item) => item.value === kindFilter)?.label ?? '生成模式'}
              icon={<Sparkles size={14} />}
              options={KIND_FILTERS}
              value={kindFilter}
              onSelect={(value) => setKindFilter(value as KindFilter)}
            />
            <FilterMenu
              label={STATUS_FILTERS.find((item) => item.value === statusFilter)?.label ?? '操作类型'}
              icon={<RotateCcw size={14} />}
              options={STATUS_FILTERS}
              value={statusFilter}
              onSelect={(value) => setStatusFilter(value as StatusFilter)}
            />
            <button
              type="button"
              onClick={() => router.push('/assets')}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-bg-surface px-2.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-bg-hover"
            >
              <FolderOpen size={14} />
              资产库
            </button>
          </div>
        </div>
      </header>

      <div ref={scrollRef} onScroll={handleConversationScroll} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1040px] flex-col gap-8 px-4 py-6 sm:px-8">
          {loadingTasks && !hasResults ? (
            <div className="flex h-40 items-center justify-center text-text-3">
              <Loader2 className="animate-spin" />
            </div>
          ) : hasResults ? (
            groups.map((group) => (
              <section key={group.key} className="flex flex-col gap-5">
                <div className="flex items-center gap-3">
                  <h2 className="text-lg font-semibold text-text-0">{group.label}</h2>
                  <span className="text-xs text-text-3">{group.turns.length} 条创作</span>
                </div>
                {group.turns.map((turn) => (
                  <CreationBlock
                    key={turn.key}
                    turn={turn}
                    saving={savingKey === turn.key}
                    regenerating={regeneratingKey === turn.key}
                    onRegenerate={handleRegenerate}
                    onReEdit={handleReEdit}
                    onSaveAsset={handleSaveAsset}
                  />
                ))}
              </section>
            ))
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-bg-2 text-text-3">
                <Video size={22} />
              </div>
              <p className="text-sm text-text-2">{conversation.length ? '没有符合筛选条件的记录' : '还没有创作记录'}</p>
              <p className="max-w-[320px] text-xs text-text-3">在下方输入框描述你想生成的图片、视频或音频，结果会出现在这里。</p>
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-bg-surface px-4 pb-2 pt-3 sm:px-6">
        <div className="mx-auto w-full max-w-[1040px] [&>section]:mb-0">
          <InputComposer submitting={submitting} defaultPrompt={prefilledPrompt} prefill={prefill} onSubmit={runGeneration} />
        </div>
      </div>
    </div>
  )
}

function FilterMenu({
  label,
  icon,
  options,
  value,
  onSelect,
}: {
  label: string
  icon: ReactNode
  options: ReadonlyArray<{ value: string; label: string }>
  value: string
  onSelect: (value: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-[8px] border border-border bg-bg-surface px-2.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-bg-hover"
        >
          {icon}
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[140px] rounded-[12px] p-1.5">
        {options.map((option) => (
          <DropdownMenuItem key={option.value} className="rounded-[8px] px-2 py-2 text-sm" onSelect={() => onSelect(option.value)}>
            {option.label}
            {option.value === value ? <span className="ml-auto text-text-2">✓</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const PILL_CLASS =
  'inline-flex items-center gap-1.5 rounded-[8px] bg-bg-2 px-2.5 py-1.5 text-xs text-text-2 transition-colors hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60'

function CreationBlock({
  turn,
  saving,
  regenerating,
  onRegenerate,
  onReEdit,
  onSaveAsset,
}: {
  turn: ChatTurn
  saving: boolean
  regenerating: boolean
  onRegenerate: (turn: ChatTurn) => void
  onReEdit: (turn: ChatTurn) => void
  onSaveAsset: (turn: ChatTurn) => void
}) {
  const meta = statusMeta(turn.status)
  const mode = MODE_META[turn.kind]
  const ModeIcon = mode.Icon
  const isVideo = turn.kind === 'video'
  const isAudio = turn.kind === 'audio'
  const hasPreview = Boolean(turn.previewUrl)
  const isPending = !hasPreview && turn.status !== 'failed'
  const videoCompleted = isVideo && turn.task?.status === 'completed'
  const imageCompleted = turn.kind === 'image' && turn.image?.status === 'completed' && Number(turn.image.task_id || 0) > 0
  const canSaveAsset = videoCompleted || imageCompleted

  return (
    <article className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1 text-text-3">
          <ModeIcon size={14} />
        </span>
        <span className="font-medium text-text-0">{turn.userText}</span>
        {turn.metaChips.map((chip, index) => (
          <span key={`${turn.key}-meta-${index}`} className="flex items-center gap-2 text-text-3">
            <span aria-hidden className="text-border-strong">｜</span>
            {chip}
          </span>
        ))}
        {turn.status !== 'completed' ? <Badge variant={meta.variant}>{meta.label}</Badge> : null}
      </div>

      {turn.error ? (
        <div className="rounded-[var(--radius-sm)] border border-error/25 bg-error-bg px-3 py-2 text-xs text-error">{turn.error}</div>
      ) : null}

      <div>
        {hasPreview && isVideo ? (
          <video src={turn.previewUrl} controls className="aspect-video w-full max-w-[640px] rounded-[var(--radius-md)] border border-border bg-black object-contain" />
        ) : hasPreview && isAudio ? (
          <div className="flex max-w-[560px] items-center rounded-[var(--radius-md)] border border-border bg-bg-1 px-4 py-3">
            <audio src={turn.previewUrl} controls className="w-full" />
          </div>
        ) : hasPreview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={turn.previewUrl} alt={turn.userText} className="max-h-[440px] max-w-full rounded-[var(--radius-md)] border border-border bg-bg-1 object-contain" />
        ) : (
          <div className="flex aspect-video w-full max-w-[640px] items-center justify-center gap-2 rounded-[var(--radius-md)] border border-dashed border-border bg-bg-1 text-sm text-text-3">
            {turn.status === 'failed' ? (
              '任务失败，可修改参数后重试'
            ) : (
              <>
                <Loader2 size={15} className="animate-spin" />
                {meta.label === '排队中' ? '排队中，稍候生成…' : '正在生成，结果完成后显示…'}
              </>
            )}
          </div>
        )}
      </div>

      {!isPending ? (
        <div className="flex flex-wrap items-center gap-2">
          {hasPreview ? (
            <a href={turn.previewUrl} target="_blank" rel="noreferrer" className={PILL_CLASS}>
              <Download size={14} />
              下载
            </a>
          ) : null}
          <button type="button" className={PILL_CLASS} disabled={regenerating} onClick={() => onRegenerate(turn)}>
            {regenerating ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            再次生成
          </button>
          <button type="button" className={PILL_CLASS} onClick={() => onReEdit(turn)}>
            <Pencil size={14} />
            重新编辑
          </button>
          {canSaveAsset ? (
            <button type="button" className={PILL_CLASS} disabled={saving} onClick={() => onSaveAsset(turn)}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <BookmarkPlus size={14} />}
              保存到资产库
            </button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={`${PILL_CLASS} px-2`} aria-label="更多操作">
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[160px] rounded-[12px] p-1.5">
              <DropdownMenuLabel className="px-2 pb-1 pt-1.5 text-xs text-text-3">更多</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="rounded-[8px] px-2 py-2 text-sm" onSelect={() => onReEdit(turn)}>
                <Pencil className="text-text-3" />
                以此为模板编辑
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
    </article>
  )
}

function CreateVideoPageFallback() {
  return (
    <div className="flex h-full items-center justify-center text-text-3">
      <Loader2 className="size-8 animate-spin" />
    </div>
  )
}

export default function CreateVideoPageWrapper() {
  return (
    <Suspense fallback={<CreateVideoPageFallback />}>
      <CreateVideoPageContent />
    </Suspense>
  )
}
