'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { toast } from 'sonner'
import { Clock3, FileText, FileUp, Home, ImageIcon, LayoutGrid, Loader2, LogIn, Mic2, Mountain, Play, Plus, Settings2, Sparkles, UserRound, Video } from 'lucide-react'
import { aiConfigAPI, dramaAPI, episodeAPI, imageAPI, uploadAPI, voicesAPI } from '@/lib/api'
import { dramaStyleLabel } from '@/lib/drama-style'
import { buildDramaMetadataWithProjectDefaults, getProjectDefaults } from '@/lib/drama-metadata'
import { redirectToLoginFromCurrentLocation } from '@/lib/login-redirect'
import { staticUrl } from '@/lib/utils'
import { useAppSession } from '@/components/shared/app-session-provider'
import { Dialog, DialogActions, DialogContent, DialogHeaderBar, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { BaseSelect } from '@/components/shared/base-select'
import type { AIServiceConfig, AIVoice, Drama, Episode, ImageGeneration } from '@/types/api'

function hasScript(ep: Episode) {
  return !!(ep.script_content)
}

function formatEpisodeDuration(duration: number | null) {
  if (!duration) return '0 分钟'
  if (duration < 60) return `${duration} 秒`
  return `${Math.ceil(duration / 60)} 分钟`
}

function normalizePromptText(value: string | null | undefined) {
  return String(value || '')
    .replace(/[#*_`>\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncatePromptText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength)}...`
}

function buildNovelSummaryReference(drama: Drama) {
  const episodeSummary = (drama.episodes || [])
    .slice(0, 3)
    .map((episode) => normalizePromptText(episode.script_content || episode.content || episode.description))
    .filter(Boolean)
    .join(' ')

  const characterSummary = (drama.characters || [])
    .slice(0, 6)
    .map((character) => {
      const detail = normalizePromptText(character.description || character.appearance || character.personality)
      return detail ? `${character.name}：${detail}` : character.name
    })
    .filter(Boolean)
    .join('；')

  const sceneSummary = (drama.scenes || [])
    .slice(0, 6)
    .map((scene) => {
      const detail = normalizePromptText(scene.prompt)
      return detail ? `${scene.location || '场景'}：${detail}` : scene.location
    })
    .filter(Boolean)
    .join('；')

  return [
    drama.description ? `小说/项目总结：${normalizePromptText(drama.description)}` : '',
    episodeSummary ? `正文内容参考：${truncatePromptText(episodeSummary, 1200)}` : '',
    characterSummary ? `主要角色参考：${truncatePromptText(characterSummary, 500)}` : '',
    sceneSummary ? `关键场景参考：${truncatePromptText(sceneSummary, 500)}` : '',
  ].filter(Boolean).join('。')
}

function buildCoverPrompt(drama: Drama) {
  const summaryReference = buildNovelSummaryReference(drama)
  const details = [
    `短剧项目《${drama.title}》`,
    drama.genre ? `题材：${drama.genre}` : '',
    drama.style ? `视觉风格：${dramaStyleLabel(drama.style)}` : '',
    summaryReference,
  ].filter(Boolean).join('。')
  return `${details}。请严格参考以上小说内容、角色关系、关键场景和情绪基调生成封面，不要生成与故事无关的通用风景。生成一张 16:9 横版短剧封面图，电影级构图，主体明确，适合作为项目头图和海报背景，画面中不要出现文字、字幕、Logo、水印。`
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function episodePreviewText(ep: Episode) {
  return String(ep.script_content || ep.content || ep.description || '').trim()
}

export default function DramaDetailPage() {
  const router = useRouter()
  const params = useParams()
  const { authenticated } = useAppSession()
  const dramaId = Number(params.id)
  const coverInputRef = useRef<HTMLInputElement | null>(null)
  const redirectedForeignDramaRef = useRef(false)

  const [drama, setDrama] = useState<Drama | null>(null)
  const [loading, setLoading] = useState(true)
  const [addDialog, setAddDialog] = useState(false)
  const [splitDialog, setSplitDialog] = useState(false)
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)
  const [previewVideoTitle, setPreviewVideoTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const [splitting, setSplitting] = useState(false)
  const [projectDefaultsDialogOpen, setProjectDefaultsDialogOpen] = useState(false)
  const [coverGenerating, setCoverGenerating] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [splitContent, setSplitContent] = useState('')
  const [activeTab, setActiveTab] = useState<'episodes' | 'characters' | 'scenes'>('episodes')
  const [previewScriptEpisode, setPreviewScriptEpisode] = useState<Episode | null>(null)
  const [aiConfigs, setAiConfigs] = useState<AIServiceConfig[]>([])
  const [voices, setVoices] = useState<AIVoice[]>([])
  const [defaultsSaving, setDefaultsSaving] = useState(false)
  const [projectDefaults, setProjectDefaults] = useState({
    image_config_id: '',
    video_config_id: '',
    audio_config_id: '',
    lead_character_name: '',
    lead_character_description: '',
    lead_voice_id: '',
    voice_notes: '',
  })

  const episodes = useMemo(() => drama?.episodes || [], [drama?.episodes])
  const imageConfigOptions = useMemo(
    () => [{ label: '跟随系统默认', value: '' }, ...aiConfigs.filter((item) => item.service_type === 'image').map((item) => ({ label: item.name, value: String(item.id) }))],
    [aiConfigs],
  )
  const videoConfigOptions = useMemo(
    () => [{ label: '跟随系统默认', value: '' }, ...aiConfigs.filter((item) => item.service_type === 'video').map((item) => ({ label: item.name, value: String(item.id) }))],
    [aiConfigs],
  )
  const audioConfigOptions = useMemo(
    () => [{ label: '跟随系统默认', value: '' }, ...aiConfigs.filter((item) => item.service_type === 'audio').map((item) => ({ label: item.name, value: String(item.id) }))],
    [aiConfigs],
  )
  const voiceOptions = useMemo(
    () => [{ label: '不固定音色', value: '' }, ...voices.map((item) => ({ label: item.voice_name, value: item.voice_id }))],
    [voices],
  )
  const readOnly = useMemo(
    () => Boolean(drama?.read_only) || !authenticated,
    [authenticated, drama?.read_only],
  )

  const openLoginNextHere = useCallback(() => {
    redirectToLoginFromCurrentLocation()
  }, [])
  const nextEpisode = useMemo(
    () => episodes.find((episode) => !hasScript(episode)) ?? episodes[0] ?? null,
    [episodes],
  )
  const coverBusy = coverGenerating || coverUploading

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const d = await dramaAPI.get(dramaId, { redirectOnUnauthorized: false }) as unknown as Drama
      setDrama(d)
      const defaults = getProjectDefaults(d)
      setProjectDefaults({
        image_config_id: defaults.image_config_id ? String(defaults.image_config_id) : '',
        video_config_id: defaults.video_config_id ? String(defaults.video_config_id) : '',
        audio_config_id: defaults.audio_config_id ? String(defaults.audio_config_id) : '',
        lead_character_name: defaults.lead_character_name,
        lead_character_description: defaults.lead_character_description,
        lead_voice_id: defaults.lead_voice_id,
        voice_notes: defaults.voice_notes,
      })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [dramaId])

  useEffect(() => {
    redirectedForeignDramaRef.current = false
    let cancelled = false
    async function init() {
      const authed = authenticated
      try {
        if (!cancelled) setLoading(true)
        const [d, configRows, voiceRows] = await Promise.all([
          dramaAPI.get(dramaId, { redirectOnUnauthorized: false }) as Promise<Drama>,
          aiConfigAPI.list(),
          voicesAPI.list(),
        ])
        if (!cancelled && authed && d.read_only) {
          if (!redirectedForeignDramaRef.current) {
            redirectedForeignDramaRef.current = true
            toast.info('这是其他用户的项目，无法在站内编辑，已为你返回首页')
          }
          router.replace('/')
        } else if (!cancelled) {
          setDrama(d)
          setAiConfigs(Array.isArray(configRows) ? configRows : [])
          setVoices(Array.isArray(voiceRows) ? voiceRows : [])
          const defaults = getProjectDefaults(d)
          setProjectDefaults({
            image_config_id: defaults.image_config_id ? String(defaults.image_config_id) : '',
            video_config_id: defaults.video_config_id ? String(defaults.video_config_id) : '',
            audio_config_id: defaults.audio_config_id ? String(defaults.audio_config_id) : '',
            lead_character_name: defaults.lead_character_name,
            lead_character_description: defaults.lead_character_description,
            lead_voice_id: defaults.lead_voice_id,
            voice_notes: defaults.voice_notes,
          })
        }
      } catch (e: unknown) {
        if (!cancelled) toast.error((e as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void init()
    return () => {
      cancelled = true
    }
  }, [authenticated, dramaId, router])

  async function addEpisode() {
    try {
      setCreating(true)
      const created = await episodeAPI.create({
        drama_id: dramaId,
        title: newTitle || undefined,
      }) as Episode
      toast.success('已添加新集')
      setAddDialog(false)
      window.location.href = `/drama/${dramaId}/episode/${created.episode_number}`
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setCreating(false)
    }
  }

  async function splitEpisodes() {
    const content = splitContent.trim()
    const replaceExisting = !content && episodes.length === 1
    if (!content && !replaceExisting) {
      toast.warning('请输入剧本内容')
      return
    }
    try {
      setSplitting(true)
      const result = await dramaAPI.splitEpisodes(dramaId, {
        content: content || undefined,
        replace_existing: replaceExisting,
      })
      toast.success(`已自动创建 ${result.count} 集`)
      setSplitDialog(false)
      setSplitContent('')
      await load()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setSplitting(false)
    }
  }

  async function generateCover() {
    if (!drama || coverBusy) return
    try {
      setCoverGenerating(true)
      const record = await imageAPI.generate({
        drama_id: drama.id,
        prompt: buildCoverPrompt(drama),
        size: '1920x1080',
        frame_type: 'drama_cover',
      }) as ImageGeneration
      const generationId = record.id
      toast.success('已开始生成封面')
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await sleep(2000)
        const latest = await imageAPI.get(generationId)
        if (latest.status === 'completed') {
          const thumbnail = latest.image_url || null
          if (thumbnail) {
            setDrama((current) => current ? { ...current, thumbnail } : current)
            await load()
            toast.success('封面已生成')
            return
          }
        }
        if (latest.status === 'failed') {
          throw new Error(latest.error_msg || '封面生成失败')
        }
      }
      toast.warning('封面仍在生成中，稍后刷新页面查看')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setCoverGenerating(false)
    }
  }

  async function uploadCover(file: File | undefined) {
    if (!file || coverBusy) return
    try {
      setCoverUploading(true)
      const uploaded = await uploadAPI.image(file)
      await dramaAPI.update(dramaId, { thumbnail: uploaded.url })
      setDrama((current) => current ? { ...current, thumbnail: uploaded.url } : current)
      toast.success('封面已上传')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setCoverUploading(false)
      if (coverInputRef.current) coverInputRef.current.value = ''
    }
  }

  async function saveProjectDefaults() {
    if (!drama) return
    try {
      setDefaultsSaving(true)
      const metadata = buildDramaMetadataWithProjectDefaults(drama.metadata, {
        image_config_id: projectDefaults.image_config_id ? Number(projectDefaults.image_config_id) : null,
        video_config_id: projectDefaults.video_config_id ? Number(projectDefaults.video_config_id) : null,
        audio_config_id: projectDefaults.audio_config_id ? Number(projectDefaults.audio_config_id) : null,
        lead_character_name: projectDefaults.lead_character_name.trim(),
        lead_character_description: projectDefaults.lead_character_description.trim(),
        lead_voice_id: projectDefaults.lead_voice_id,
        voice_notes: projectDefaults.voice_notes.trim(),
      })
      await dramaAPI.update(drama.id, { metadata })
      setDrama((current) => current ? { ...current, metadata: JSON.stringify(metadata) } : current)
      toast.success('项目默认设定已保存')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setDefaultsSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="page-shell bg-bg-base text-text-0 animate-fade-up">
        <div className="mx-auto w-full">
          <section className="relative min-h-[320px] overflow-hidden rounded-[10px] border border-border bg-bg-0 shadow-shadow-sm">
            <div
              className="absolute inset-0 opacity-[0.18]"
              style={{
                backgroundImage: 'linear-gradient(color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px)',
                backgroundSize: '51px 51px',
              }}
              aria-hidden
            />
            <div className="relative flex min-h-[320px] flex-col justify-between p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex size-10 animate-pulse items-center justify-center rounded-[10px] border border-border bg-bg-surface">
                  <div className="size-5 rounded-[5px] bg-bg-2" />
                </div>
                <div className="mr-[7%] flex w-full max-w-[360px] flex-col items-start gap-4 pt-7">
                  <div className="h-9 w-40 animate-pulse rounded-[var(--radius-sm)] bg-bg-2" />
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="h-8 w-16 animate-pulse rounded-full bg-bg-2" />
                    <div className="h-8 w-14 animate-pulse rounded-full bg-bg-2" />
                    <div className="h-8 w-14 animate-pulse rounded-full bg-bg-2" />
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[136px] w-[120px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-[14px] border border-dashed border-border bg-bg-panel md:flex md:flex-col md:items-center md:justify-center md:gap-3">
                <div className="size-9 rounded-[10px] bg-bg-2" />
                <div className="h-4 w-14 rounded-full bg-bg-2" />
              </div>

              <div className="flex items-end justify-end gap-3">
                <div className="flex h-11 w-[106px] animate-pulse items-center justify-center gap-2 rounded-[10px] bg-accent-bg">
                  <div className="size-4 rounded-[4px] bg-accent-glow" />
                  <div className="h-4 w-14 rounded-full bg-accent-glow" />
                </div>
                <div className="flex size-11 animate-pulse items-center justify-center rounded-[8px] border border-border bg-bg-surface">
                  <div className="size-4 rounded-[4px] bg-bg-2" />
                </div>
              </div>
            </div>
          </section>

          <section className="mt-5">
            <div className="h-8 w-28 animate-pulse rounded-[var(--radius-sm)] bg-bg-2" />
            <div className="mt-5 flex h-[42px] w-full max-w-[500px] animate-pulse items-center gap-1 rounded-[9px] border border-border bg-bg-2 p-1">
              {[0, 1, 2].map((item) => (
                <div key={item} className={`flex h-8 flex-1 items-center justify-center gap-2 rounded-[8px] ${item === 0 ? 'bg-bg-0' : ''}`}>
                  <div className="size-4 rounded-[4px] bg-bg-3" />
                  <div className="h-4 w-14 rounded-full bg-bg-3" />
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
              <div className="flex min-h-[308px] animate-pulse flex-col items-center justify-center rounded-[12px] border border-dashed border-accent-glow bg-accent-bg px-6 py-10 text-center">
                <div className="size-[54px] rounded-[14px] bg-accent-glow" />
                <div className="mt-6 h-7 w-48 rounded-[var(--radius-sm)] bg-accent-glow" />
                <div className="mt-3 h-5 w-72 max-w-full rounded-full bg-accent-glow" />
                <div className="mt-7 h-10 w-[104px] rounded-[11px] bg-accent-glow" />
              </div>
              <div className="flex min-h-[308px] animate-pulse flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-10 text-center">
                <div className="size-11 rounded-[12px] bg-bg-2" />
                <div className="mt-5 h-5 w-28 rounded-full bg-bg-2" />
                <div className="mt-3 h-5 w-44 rounded-full bg-bg-2" />
              </div>
            </div>
          </section>
        </div>
      </div>
    )
  }

  if (!drama) return null

  const tabs = [
    { key: 'episodes' as const, label: '分集列表', icon: LayoutGrid, count: episodes.length },
    { key: 'characters' as const, label: '角色', icon: UserRound, count: drama.characters?.length || 0 },
    { key: 'scenes' as const, label: '场景', icon: Mountain, count: drama.scenes?.length || 0 },
  ]
  const coverUrl = staticUrl(drama.thumbnail)

  return (
    <div className="page-shell bg-bg-base text-text-0 animate-fade-up">
      <div className="mx-auto w-full">
      {readOnly ? (
        <div className="mb-5 flex flex-col gap-3 rounded-[14px] border border-border bg-bg-0 px-4 py-3.5 shadow-shadow-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p className="text-sm leading-6 text-text-2">
            当前为<strong className="font-semibold text-text-0">只读浏览</strong>：可查看项目与分集信息；创作、分集、生成与进入制作页需登录且为项目作者。
          </p>
          <Button type="button" variant="outline" size="sm" className="h-9 shrink-0 gap-2 rounded-[10px]" onClick={openLoginNextHere}>
            <LogIn size={15} />
            登录后创作
          </Button>
        </div>
      ) : null}
      <section className="relative min-h-[320px] overflow-hidden rounded-[10px] border border-border bg-bg-0 shadow-shadow-sm">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: coverUrl
              ? `linear-gradient(90deg, color-mix(in srgb, var(--color-bg-0) 76%, transparent) 0%, color-mix(in srgb, var(--color-bg-0) 62%, transparent) 48%, var(--color-bg-0) 100%), url(${coverUrl})`
              : 'linear-gradient(105deg, var(--color-bg-2) 0%, var(--color-bg-0) 50%, var(--color-bg-surface) 100%)',
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage: 'linear-gradient(color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px)',
            backgroundSize: '51px 51px',
          }}
          aria-hidden
        />
        <div className="relative flex min-h-[320px] flex-col justify-between p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <button
              className="flex size-10 items-center justify-center rounded-[10px] border border-border bg-bg-surface text-text-1 shadow-shadow-xs transition-colors hover:bg-bg-hover hover:text-text-0"
              onClick={() => router.push('/drama')}
              aria-label="返回项目列表"
              title="返回项目列表"
            >
              <Home size={18} />
            </button>
            <div className="mr-[7%] flex max-w-[360px] flex-col items-start gap-4 pt-7 text-left">
              <h1 className="font-body text-[30px] font-black leading-tight tracking-normal text-text-0 sm:text-[34px]">
                {drama.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-8 items-center rounded-full border border-accent-glow bg-accent-bg px-3 text-sm font-medium text-accent-text">
                  {drama.style ? dramaStyleLabel(drama.style) : '通用'}
                </span>
                <span className="inline-flex h-8 items-center rounded-full border border-border bg-bg-2 px-3 text-sm text-text-2">16:9</span>
                <span className="inline-flex h-8 items-center rounded-full border border-border bg-bg-2 px-3 text-sm text-text-2">{episodes.length} 集</span>
              </div>
            </div>
          </div>

          {!coverUrl && !readOnly ? (
            <button
              type="button"
              onClick={generateCover}
              disabled={coverBusy}
              className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed border-border bg-bg-panel px-9 py-8 text-text-3 transition-colors hover:border-accent hover:bg-bg-hover hover:text-text-0 disabled:cursor-not-allowed disabled:opacity-70 md:flex"
              aria-label="AI 生成项目封面"
              title="AI 生成项目封面"
            >
              {coverGenerating ? <Loader2 size={44} className="animate-spin" /> : <Sparkles size={44} fill="currentColor" strokeWidth={0} />}
              <span className="text-sm font-semibold">{coverGenerating ? '生成中' : 'AI 生成'}</span>
            </button>
          ) : null}

          <div className="flex flex-wrap items-end justify-end gap-3">
            {!readOnly ? (
              <>
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="rounded-[8px] border border-border bg-bg-surface text-text-1 hover:bg-bg-hover hover:text-text-0"
                  aria-label="上传项目封面"
                  title="上传项目封面"
                  disabled={coverBusy}
                  onClick={() => coverInputRef.current?.click()}
                >
                  {coverUploading ? <Loader2 size={17} className="animate-spin" /> : <ImageIcon size={17} />}
                </Button>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    void uploadCover(event.target.files?.[0])
                  }}
                />
              </>
            ) : (
              <Button type="button" variant="default" className="h-11 rounded-[10px] px-5 text-sm font-bold" onClick={openLoginNextHere}>
                <LogIn size={16} />
                登录后编辑
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="mt-5">
        <h2 className="font-body text-2xl font-black tracking-normal text-text-0">项目内容</h2>

        {!readOnly ? (
          <div className="mt-5 rounded-[14px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                  <Settings2 size={16} />
                  项目默认设定
                </div>
                <p className="mt-1 text-sm leading-6 text-text-2">
                  在这里固定本项目常用的模型和主角/声音设定。后续新建分集、自动分集和单集制作会优先继承这些设置。
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-[10px] px-5"
                onClick={() => setProjectDefaultsDialogOpen(true)}
              >
                <Settings2 size={15} />
                配置项目默认设定
              </Button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-text-2">
              <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">图片模型</span>
              <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">视频模型</span>
              <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">配音模型</span>
              <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">主角与音色</span>
              <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">设定说明</span>
            </div>
          </div>
        ) : null}

        <div className="mt-5 flex w-full max-w-[500px] rounded-[9px] border border-border bg-bg-2 p-1">
          {tabs.map(({ key, label, icon: Icon, count }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-bold transition-colors ${
                activeTab === key ? 'bg-bg-0 text-text-0 shadow-shadow-xs' : 'text-text-1 hover:bg-bg-hover'
              }`}
            >
              <Icon size={15} />
              <span className="truncate">{label}</span>
              {count > 0 ? (
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent text-xs text-on-accent">
                  {count}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {activeTab === 'episodes' ? (
          <div className="mt-5">
            {episodes.length === 0 ? (
              readOnly ? (
                <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-12 text-center">
                  <FileText size={40} className="text-text-3" strokeWidth={1.5} />
                  <p className="mt-4 max-w-md text-sm leading-7 text-text-2">暂无公开分集内容，或作者尚未发布。登录后可创建自己的项目。</p>
                  <Button type="button" variant="outline" className="mt-6 h-10 rounded-[11px]" onClick={openLoginNextHere}>
                    <LogIn size={15} />
                    登录
                  </Button>
                </div>
              ) : (
              <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
                <div className="flex min-h-[308px] flex-col items-center justify-center rounded-[12px] border border-dashed border-accent-glow bg-accent-bg px-6 py-10 text-center">
                  <FileUp size={54} className="text-accent" strokeWidth={1.9} />
                  <h3 className="mt-6 font-body text-[22px] font-black tracking-normal text-text-0">上传剧本，自动分集</h3>
                  <p className="mt-3 text-sm text-text-2">上传带有集数或章节标记的完整剧本，系统将自动拆分为多个分集</p>
                  <Button
                    className="mt-7 h-10 rounded-[11px] px-5 text-sm font-bold"
                    onClick={() => {
                      setSplitContent('')
                      setSplitDialog(true)
                    }}
                  >
                    <FileUp size={15} />
                    开始分集
                  </Button>
                </div>

                <button
                  type="button"
                  onClick={() => { setNewTitle(''); setAddDialog(true) }}
                  className="flex min-h-[308px] flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-10 text-center transition-colors hover:border-accent hover:bg-bg-hover"
                >
                  <Plus size={44} className="text-text-3" strokeWidth={1.7} />
                  <h3 className="mt-5 font-body text-base font-black tracking-normal text-text-0">手动新增一集</h3>
                  <p className="mt-3 text-sm text-text-2">从零开始创作你的短剧故事</p>
                </button>
              </div>
              )
            ) : (
              <div className="space-y-4">
                {!readOnly && episodes.length === 1 && (episodes[0]?.content || '').trim().length > 1200 ? (
                  <div className="flex flex-col gap-3 rounded-[14px] border border-accent-glow bg-accent-bg px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-text-0">当前只有 1 集，可以重新按标记分集</div>
                      <p className="mt-1 text-sm leading-6 text-text-2">
                        系统会读取当前第 1 集的原始内容，按“第1集”“第一章”等明确标记重新拆成多集。
                      </p>
                    </div>
                    <Button
                      className="h-9 rounded-[var(--radius-sm)] px-4"
                      disabled={splitting}
                      onClick={() => {
                        setSplitContent('')
                        void splitEpisodes()
                      }}
                    >
                      {splitting ? '分集中...' : '重新分集'}
                    </Button>
                  </div>
                ) : null}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {episodes.map((ep: Episode, i: number) => {
                  const preview = episodePreviewText(ep)
                  return (
                  <article
                    key={ep.id}
                    className={`group flex min-h-[200px] flex-col rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs transition-colors ${
                      readOnly
                        ? preview
                          ? 'cursor-pointer hover:border-accent hover:bg-bg-hover'
                          : ''
                        : 'cursor-pointer hover:border-accent hover:bg-bg-hover'
                    }`}
                    style={{ animationDelay: `${i * 0.05}s` }}
                    onClick={() => {
                      if (readOnly) {
                        if (preview) setPreviewScriptEpisode(ep)
                        else toast.info('本集暂无公开正文')
                        return
                      }
                      router.push(`/drama/${drama.id}/episode/${ep.episode_number}`)
                    }}
                  >
                    <div className="w-fit rounded-[4px] border border-accent-glow bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-text">
                      第 {ep.episode_number} 集
                    </div>
                    <h3 className="mt-4 font-body text-lg font-black tracking-normal text-text-0">
                      {ep.title || `第${ep.episode_number}集`}
                    </h3>
                    <div className="mt-3 flex items-center gap-1.5 text-sm text-text-2">
                      <Clock3 size={14} />
                      {formatEpisodeDuration(ep.duration)}
                    </div>

                    <div className="mt-auto border-t border-border pt-3">
                      {ep.video_url ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="mb-2 h-8 rounded-[8px]"
                          onClick={(event) => {
                            event.stopPropagation()
                            setPreviewVideoUrl(staticUrl(ep.video_url))
                            setPreviewVideoTitle(ep.title || `第 ${ep.episode_number} 集`)
                          }}
                        >
                          预览视频
                        </Button>
                      ) : null}
                      {readOnly ? (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="ml-auto flex h-8 rounded-[7px] px-4 text-sm font-bold"
                          disabled={!preview}
                          onClick={(event) => {
                            event.stopPropagation()
                            if (preview) setPreviewScriptEpisode(ep)
                            else toast.info('本集暂无公开正文')
                          }}
                        >
                          <FileText size={14} />
                          {preview ? '预览原文' : '暂无正文'}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="ml-auto flex h-8 rounded-[7px] px-4 text-sm font-bold"
                          onClick={(event) => {
                            event.stopPropagation()
                            router.push(`/drama/${drama.id}/episode/${ep.episode_number}`)
                          }}
                        >
                          <Play size={14} fill="currentColor" strokeWidth={0} />
                          进入制作
                        </Button>
                      )}
                    </div>
                  </article>
                  )
                })}

                {!readOnly ? (
                <button
                  type="button"
                  onClick={() => { setNewTitle(''); setAddDialog(true) }}
                  className="flex min-h-[200px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 p-5 text-center transition-colors hover:border-accent hover:bg-bg-hover"
                >
                  <Plus size={42} className="text-text-3" strokeWidth={1.7} />
                  <span className="mt-5 font-body text-base font-black tracking-normal text-text-0">新增一集</span>
                  <span className="mt-3 text-sm text-text-2">继续创作你的短剧故事</span>
                </button>
                ) : null}
              </div>
              </div>
            )}
          </div>
        ) : activeTab === 'characters' ? (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(drama.characters || []).map((character) => (
              <article key={character.id} className="min-h-[150px] rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-[8px] bg-accent-bg text-accent">
                    <UserRound size={19} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-body text-base font-black tracking-normal text-text-0">{character.name}</h3>
                    <p className="text-sm text-text-2">{character.role || '角色'}</p>
                  </div>
                </div>
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-text-2">
                  {character.description || character.appearance || character.personality || '暂无角色描述'}
                </p>
              </article>
            ))}
            {(!drama.characters || drama.characters.length === 0) ? (
              <div className="col-span-full flex min-h-[220px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 text-center">
                <UserRound size={36} className="text-text-3" />
                <p className="mt-4 text-sm text-text-2">暂无角色，进入分集制作后可从剧本提取。</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {(drama.scenes || []).map((scene) => (
              <article key={scene.id} className="min-h-[150px] rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-[8px] bg-accent-bg text-accent">
                    <Mountain size={19} />
                  </div>
                  <div className="min-w-0">
                    <h3 className="truncate font-body text-base font-black tracking-normal text-text-0">{scene.location || '未命名场景'}</h3>
                    <p className="text-sm text-text-2">{scene.time || '场景'}</p>
                  </div>
                </div>
                <p className="mt-4 line-clamp-3 text-sm leading-6 text-text-2">
                  {scene.prompt || '暂无场景描述'}
                </p>
              </article>
            ))}
            {(!drama.scenes || drama.scenes.length === 0) ? (
              <div className="col-span-full flex min-h-[220px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 text-center">
                <Mountain size={36} className="text-text-3" />
                <p className="mt-4 text-sm text-text-2">暂无场景，进入分集制作后可从剧本提取。</p>
              </div>
            ) : null}
          </div>
        )}

      </section>

      {/* Add Episode Dialog */}
      </div>

      <Dialog open={projectDefaultsDialogOpen} onOpenChange={setProjectDefaultsDialogOpen}>
        <DialogContent layout="panel" size="large" className="animate-scale-in">
          <DialogHeaderBar className="border-0 bg-transparent">
            <div className="flex gap-3.5">
              <div
                className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-accent-glow bg-accent-bg text-accent shadow-shadow-xs"
                aria-hidden
              >
                <Settings2 className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 pr-7">
                <DialogTitle className="font-display text-xl font-bold tracking-tight text-text-0 sm:text-[22px]">
                  项目默认设定
                </DialogTitle>
                <p className="mt-2 text-sm leading-6 text-text-2">
                  固定本项目常用的模型和主角/声音设定，后续新建分集、自动分集和单集制作会优先继承这些设置。
                </p>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 overflow-y-auto border-t border-border/70">
            <div className="grid gap-4 xl:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认图片模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.image_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, image_config_id: String(v) }))}
                  options={imageConfigOptions}
                  placeholder="选择图片模型"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认视频模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.video_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, video_config_id: String(v) }))}
                  options={videoConfigOptions}
                  placeholder="选择视频模型"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认配音模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.audio_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, audio_config_id: String(v) }))}
                  options={audioConfigOptions}
                  placeholder="选择配音模型"
                />
              </label>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">主角名称</span>
                <Input
                  value={projectDefaults.lead_character_name}
                  onChange={(event) => setProjectDefaults((prev) => ({ ...prev, lead_character_name: event.target.value }))}
                  placeholder="例如：林晚"
                  className="h-11 text-sm"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">主角默认音色</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.lead_voice_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, lead_voice_id: String(v) }))}
                  options={voiceOptions}
                  placeholder="选择音色"
                />
              </label>
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">主角设定说明</span>
                <Textarea
                  value={projectDefaults.lead_character_description}
                  onChange={(event) => setProjectDefaults((prev) => ({ ...prev, lead_character_description: event.target.value }))}
                  placeholder="写主角的形象、性格、关系定位，方便后续保持一致。"
                  rows={4}
                  className="text-sm"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">声音备注</span>
                <Textarea
                  value={projectDefaults.voice_notes}
                  onChange={(event) => setProjectDefaults((prev) => ({ ...prev, voice_notes: event.target.value }))}
                  placeholder="例如：主角偏年轻冷感，旁白统一成熟男声。"
                  rows={4}
                  className="text-sm"
                />
              </label>
            </div>
          </DialogMain>

          <DialogActions>
            <Button
              type="button"
              variant="ghost"
              className="h-10 w-full sm:w-auto sm:min-w-[88px]"
              onClick={() => setProjectDefaultsDialogOpen(false)}
              disabled={defaultsSaving}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-full px-6 sm:w-auto sm:min-w-[132px]"
              disabled={defaultsSaving}
              onClick={async () => {
                await saveProjectDefaults()
                setProjectDefaultsDialogOpen(false)
              }}
            >
              {defaultsSaving ? <Loader2 size={15} className="animate-spin" /> : <Settings2 size={15} />}
              保存设定
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={splitDialog} onOpenChange={setSplitDialog}>
        <DialogContent className="flex max-h-[min(90dvh,820px)] w-[calc(100vw-2rem)] max-w-[920px] flex-col gap-0 overflow-hidden rounded-[22px] border-border bg-bg-surface p-0 shadow-shadow-elevated sm:max-w-[920px] lg:w-[min(920px,calc(100vw-2rem))]">
          <DialogTitle className="sr-only">上传剧本并自动分集</DialogTitle>
          <DialogHeaderBar className="border-b-0 bg-transparent px-7 pb-3 pt-7 sm:px-8 sm:pt-8">
            <div className="flex items-start gap-4 pr-12">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent-glow bg-accent-bg text-accent">
                <FileUp size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[22px] font-bold leading-tight tracking-[-0.018em] text-text-0">上传剧本并自动分集</div>
                <p className="mt-2 text-sm leading-6 text-text-2">
                  粘贴完整剧本，系统会按“第1集”“第一集”“第1章”“第一章”等明确标记拆分，并保存到每集原始内容。
                </p>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 gap-4 overflow-hidden px-7 pb-5 pt-2 sm:px-8">
            <div className="rounded-[16px] border border-accent-glow bg-accent-bg px-4 py-3">
              <div className="text-xs font-semibold text-accent-text">推荐格式</div>
              <p className="mt-1 text-[13px] leading-6 text-text-2">
                在剧本中使用“第1集”“第一集”“第1章”“第一章”等明确标记；未识别到标记时不会自动按剧情或长度拆分。
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex h-9 items-center gap-2 rounded-full border border-border bg-bg-2 px-4 text-sm font-semibold text-text-1">
                <FileText size={15} />
                文本输入
              </div>
              <span className="text-xs text-text-3">将写入每集原始内容</span>
            </div>

            <label className="relative block">
              <textarea
                value={splitContent}
                onChange={(event) => setSplitContent(event.target.value)}
                placeholder="请输入或粘贴剧本内容..."
                className="h-[clamp(260px,38dvh,330px)] w-full resize-none rounded-[18px] border border-border bg-bg-input px-4 py-3.5 text-sm leading-7 text-text-0 shadow-inset outline-none transition-[border-color,box-shadow] placeholder:text-text-3 focus:border-border-focus focus:ring-[3px] focus:ring-accent-glow"
              />
              <span className="absolute bottom-3 right-4 text-xs text-text-3">{splitContent.length}</span>
            </label>
          </DialogMain>

          <DialogActions className="items-center justify-between gap-3 border-t border-border bg-bg-0/70 px-7 py-5 sm:flex-row sm:px-8">
            <p className="text-xs leading-5 text-text-3">
              创建后可在分集卡片进入制作页继续改写剧本。
            </p>
            <div className="flex shrink-0 justify-end gap-3">
              <Button type="button" variant="ghost" className="h-9 rounded-[var(--radius-sm)] px-4" onClick={() => setSplitDialog(false)} disabled={splitting}>
                取消
              </Button>
              <Button
                type="button"
                className="h-9 rounded-[var(--radius-sm)] px-5"
                disabled={splitting || !splitContent.trim()}
                onClick={splitEpisodes}
              >
                {splitting ? '分集中...' : '开始分集'}
              </Button>
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent className="flex max-h-[min(760px,calc(100dvh-2rem))] w-[min(620px,calc(100%-2rem))] max-w-[620px] flex-col gap-0 overflow-hidden rounded-[28px] border-border/70 bg-bg-surface p-0 shadow-shadow-elevated sm:p-0">
          <DialogTitle className="sr-only">创建新集</DialogTitle>
          <DialogHeaderBar className="border-b-0 bg-transparent px-0 sm:pb-3">
            <div className="text-[1.55rem] font-semibold tracking-[-0.018em] text-text-0">添加新集</div>
            <p className="mt-1 text-sm text-text-2">设置本集标题，创建后可直接进入单集制作。</p>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 gap-4 overflow-y-auto p-0">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-1">集标题（可选）</span>
              <Input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="例如：渔业幽梦 · 第 2 集（留空自动命名）"
                className="h-11 rounded-xl text-sm"
              />
            </label>
          </DialogMain>

          <DialogActions className="flex-col items-stretch gap-3 px-10 sm:px-10">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-text-3">项目默认配置和模型可在后续制作时继承或覆盖。</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-10 rounded-full px-5" onClick={() => setAddDialog(false)} disabled={creating}>
                取消
              </Button>
              <Button
                className="h-10 shrink-0 rounded-full px-6"
                disabled={creating}
                onClick={addEpisode}
              >
                {creating ? '创建中...' : '创建并进入制作页'}
              </Button>
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewScriptEpisode} onOpenChange={(open) => { if (!open) setPreviewScriptEpisode(null) }}>
        <DialogContent className="flex max-h-[min(88dvh,820px)] w-[min(720px,calc(100%-2rem))] max-w-[720px] flex-col gap-0 overflow-hidden rounded-[var(--radius-xl)] border-border bg-bg-surface p-0 shadow-shadow-elevated">
          <DialogTitle className="sr-only">分集正文预览</DialogTitle>
          <DialogHeaderBar className="sm:pb-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-3">Read only</div>
            <div className="mt-2 text-lg font-bold text-text-0">
              {previewScriptEpisode ? `${previewScriptEpisode.title || `第 ${previewScriptEpisode.episode_number} 集`} · 正文` : ''}
            </div>
          </DialogHeaderBar>
          <DialogMain className="min-h-0 flex-1 overflow-y-auto pt-0">
            {previewScriptEpisode ? (
              <pre className="whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-border bg-bg-2 p-4 text-sm leading-7 text-text-1">
                {episodePreviewText(previewScriptEpisode) || '（无内容）'}
              </pre>
            ) : null}
          </DialogMain>
          <DialogActions className="border-t border-border px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" className="h-9 rounded-[10px]" onClick={() => setPreviewScriptEpisode(null)}>
              关闭
            </Button>
            <Button type="button" className="h-9 rounded-[10px]" onClick={openLoginNextHere}>
              <LogIn size={15} />
              登录后创作
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewVideoUrl} onOpenChange={(open) => { if (!open) setPreviewVideoUrl(null) }}>
        <DialogContent className="w-[min(960px,calc(100%-2rem))] max-w-[960px] rounded-[var(--radius-xl)] border-border bg-bg-surface p-0 shadow-shadow-elevated">
          <DialogTitle className="sr-only">视频预览</DialogTitle>
          <DialogHeaderBar className="sm:pb-5">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-3">Video Preview</div>
            <div className="mt-2 text-lg font-bold text-text-0">{previewVideoTitle || '视频预览'}</div>
          </DialogHeaderBar>
          <DialogMain className="pt-0">
            {previewVideoUrl ? (
              <video src={previewVideoUrl} controls className="aspect-video w-full rounded-[var(--radius-md)] bg-bg-2" />
            ) : null}
          </DialogMain>
        </DialogContent>
      </Dialog>
    </div>
  )
}
