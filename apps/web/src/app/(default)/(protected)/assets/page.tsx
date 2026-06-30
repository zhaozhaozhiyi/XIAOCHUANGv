'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Headphones,
  Download,
  ExternalLink,
  ImageIcon,
  Layers,
  Loader2,
  MapPin,
  RefreshCw,
  Search,
  User,
  Video,
} from 'lucide-react'

import { assetAPI, dramaAPI } from '@/lib/api'
import { cn, formatDate, staticUrl } from '@/lib/utils'
import { EmptyState } from '@/components/shared/empty-state'
import { ImageViewer } from '@/components/shared/image-viewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AssetRecord, Character, Drama, Scene } from '@/types/api'

type LibraryTab = 'characters' | 'scenes' | 'media'
type MediaTab = 'all' | 'video' | 'image' | 'audio'

function getAssetPreviewUrl(asset: AssetRecord) {
  return staticUrl(asset.url || '')
}

function getAssetSourceHref(asset: AssetRecord): string | null {
  if (asset.drama_id) return `/drama/${asset.drama_id}`
  if (asset.source_type === 'writing' && asset.source_path) return asset.source_path
  if (asset.source_type === 'quick_video' || asset.source_type === 'quick_image') return '/create/video'
  if (asset.source_type === 'drama_video' && asset.source_path) return asset.source_path
  if (asset.source_path) return asset.source_path
  return null
}

function getAssetSourceLabel(asset: AssetRecord) {
  if (asset.source_type === 'quick_video' || asset.source_type === 'quick_image') return '快速成片'
  if (asset.source_type === 'writing') return '小说剧本'
  if (asset.source_type === 'drama_video') return '短剧任务'
  if (asset.source_type === 'legacy_asset') return '历史资产'
  return '任务来源'
}

function getAssetSourceDescription(asset: AssetRecord, dramaTitle?: string) {
  if (dramaTitle) return `来源项目：${dramaTitle}`
  if (asset.source_type === 'writing') return '来源：小说剧本导出或改编链路'
  if (asset.source_type === 'quick_video' || asset.source_type === 'quick_image' || asset.source_type === 'quick_audio') return '来源：快速成片'
  if (asset.source_type === 'legacy_asset') return '来源：历史回填资产'
  return '来源：独立任务'
}

function getAssetSourceActionLabel(asset: AssetRecord) {
  if (asset.drama_id) return '打开项目'
  if (asset.source_type === 'writing') return '打开文稿'
  if (asset.source_type === 'quick_video' || asset.source_type === 'quick_image' || asset.source_type === 'quick_audio') return '打开快速成片'
  return '打开来源'
}

interface CharacterCardProps {
  character: Character
  dramaTitle?: string
  onOpen?: () => void
}

function CharacterCard({ character, dramaTitle, onOpen }: CharacterCardProps) {
  const imageUrl = staticUrl(character.image_url || character.reference_images || '')

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-0 shadow-shadow-xs transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-shadow-sm"
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-square w-full overflow-hidden bg-bg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-inset"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={character.name} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <User size={40} className="text-text-3" />
          </div>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 border-t border-border p-4">
        <div>
          <h3 className="font-display text-base font-semibold text-text-0 line-clamp-1">
            {character.name}
          </h3>
          {character.role && (
            <p className="mt-0.5 text-xs text-accent">{character.role}</p>
          )}
        </div>

        {character.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-text-2">
            {character.description}
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2">
          {dramaTitle && (
            <Badge variant="outline" className="text-[11px]">
              {dramaTitle}
            </Badge>
          )}
          {character.voice_style && (
            <Badge variant="secondary" className="text-[11px]">
              {character.voice_style}
            </Badge>
          )}
        </div>
      </div>
    </article>
  )
}

interface SceneCardProps {
  scene: Scene
  dramaTitle?: string
  onOpen?: () => void
}

function SceneCard({ scene, dramaTitle, onOpen }: SceneCardProps) {
  const imageUrl = staticUrl(scene.image_url || '')

  return (
    <article
      className="group flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-0 shadow-shadow-xs transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-shadow-sm"
    >
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[16/9] w-full overflow-hidden bg-bg-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-inset"
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={scene.location || '场景'} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <MapPin size={32} className="text-text-3" />
          </div>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 border-t border-border p-4">
        <div>
          <h3 className="font-display text-base font-semibold text-text-0 line-clamp-1">
            {scene.location || '未命名场景'}
          </h3>
          {scene.time && (
            <p className="mt-0.5 text-xs text-text-2">{scene.time}</p>
          )}
        </div>

        {scene.prompt && (
          <p className="line-clamp-2 text-xs leading-relaxed text-text-2">
            {scene.prompt}
          </p>
        )}

        <div className="mt-auto flex flex-wrap gap-2">
          {dramaTitle && (
            <Badge variant="outline" className="text-[11px]">
              {dramaTitle}
            </Badge>
          )}
          {scene.storyboard_count > 0 && (
            <Badge variant="secondary" className="text-[11px]">
              {scene.storyboard_count} 分镜
            </Badge>
          )}
        </div>
      </div>
    </article>
  )
}

function AssetsPageContent() {
  const [libraryTab, setLibraryTab] = useState<LibraryTab>('media')
  const [mediaTab, setMediaTab] = useState<MediaTab>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsLoaded, setDetailsLoaded] = useState(false)
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [dramaMap, setDramaMap] = useState<Record<number, string>>({})
  const [viewerUrl, setViewerUrl] = useState('')

  const load = useMemo(() => async () => {
    try {
      setLoading(true)
      const [assetPayload, dramas] = await Promise.all([
        assetAPI.list(),
        dramaAPI.list({ include_details: false }),
      ]) as [
        { items: AssetRecord[]; total: number },
        { items: Drama[] },
      ]

      setAssets(assetPayload.items)
      setDramaMap(
        Object.fromEntries(
          (dramas.items || []).map((drama) => [drama.id, drama.title]),
        ),
      )
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadDramaDetails = useMemo(() => async () => {
    try {
      setDetailsLoading(true)
      const dramas = await dramaAPI.list({ include_details: true }) as { items: Drama[] }
      setCharacters((dramas.items || []).flatMap((drama) => drama.characters || []))
      setScenes((dramas.items || []).flatMap((drama) => drama.scenes || []))
      setDramaMap(
        Object.fromEntries(
          (dramas.items || []).map((drama) => [drama.id, drama.title]),
        ),
      )
      setDetailsLoaded(true)
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setDetailsLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  async function handleRefresh() {
    await load()
    if (libraryTab !== 'media') {
      setDetailsLoaded(false)
      await loadDramaDetails()
    }
  }

  function handleLibraryTabChange(value: string) {
    const next = value as LibraryTab
    setLibraryTab(next)
    if (next !== 'media' && !detailsLoaded && !detailsLoading) {
      void loadDramaDetails()
    }
  }

  const filteredCharacters = useMemo(() => {
    let result = [...characters]
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          String(c.role || '').toLowerCase().includes(q) ||
          String(c.description || '').toLowerCase().includes(q),
      )
    }
    return result
  }, [characters, query])

  const filteredScenes = useMemo(() => {
    let result = [...scenes]
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      result = result.filter(
        (s) =>
          String(s.location || '').toLowerCase().includes(q) ||
          String(s.time || '').toLowerCase().includes(q) ||
          String(s.prompt || '').toLowerCase().includes(q),
      )
    }
    return result
  }, [scenes, query])

  const filteredAssets = useMemo(() => {
    return assets.filter((item) => {
      if (mediaTab !== 'all' && item.kind !== mediaTab) return false
      if (!query.trim()) return true
      const q = query.trim().toLowerCase()
      return (
        item.title.toLowerCase().includes(q) ||
        String(item.provider || '').toLowerCase().includes(q) ||
        String(item.source_type || '').toLowerCase().includes(q) ||
        (item.drama_id ? dramaMap[item.drama_id]?.toLowerCase().includes(q) : false)
      )
    })
  }, [assets, dramaMap, query, mediaTab])

  const inventory = useMemo(() => {
    const image = assets.filter((a) => a.kind === 'image').length
    const video = assets.filter((a) => a.kind === 'video').length
    const audio = assets.filter((a) => a.kind === 'audio').length
    return { total: assets.length, image, video, audio }
  }, [assets])

  const renderTabContent = () => {
    if (libraryTab === 'characters') {
      if (loading || detailsLoading) {
        return (
          <div className="flex flex-1 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-strong bg-bg-0 text-text-3">
            <Loader2 className="animate-spin" />
          </div>
        )
      }
      if (filteredCharacters.length === 0) {
        return (
          <EmptyState
            icon={User}
            description={query.trim() ? '没有符合搜索条件的角色' : '还没有收录角色，请从短剧详情中收录'}
            className="flex-1"
          />
        )
      }
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
          {filteredCharacters.map((character) => (
            <CharacterCard
              key={character.id}
              character={character}
              dramaTitle={dramaMap[character.drama_id]}
            />
          ))}
        </div>
      )
    }

    if (libraryTab === 'scenes') {
      if (loading || detailsLoading) {
        return (
          <div className="flex flex-1 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-strong bg-bg-0 text-text-3">
            <Loader2 className="animate-spin" />
          </div>
        )
      }
      if (filteredScenes.length === 0) {
        return (
          <EmptyState
            icon={MapPin}
            description={query.trim() ? '没有符合搜索条件的场景' : '还没有收录场景，请从短剧详情中收录'}
            className="flex-1"
          />
        )
      }
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
          {filteredScenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              dramaTitle={dramaMap[scene.drama_id]}
            />
          ))}
        </div>
      )
    }

    if (loading) {
      return (
        <div className="flex flex-1 items-center justify-center rounded-[var(--radius-md)] border border-dashed border-border-strong bg-bg-0 text-text-3">
          <Loader2 className="animate-spin" />
        </div>
      )
    }
    if (filteredAssets.length === 0) {
      return (
        <EmptyState
          icon={Layers}
          description="当前筛选条件下还没有可展示的资产。可先快速成片，再把结果沉淀到资产。"
          actionLabel="前往快速成片"
          onAction={() => {
            window.location.href = '/create/video'
          }}
          className="flex-1"
        />
      )
    }
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {filteredAssets.map((asset) => {
          const dramaTitle = asset.drama_id ? dramaMap[asset.drama_id] : ''
          const previewUrl = getAssetPreviewUrl(asset)
          const sourceHref = getAssetSourceHref(asset)

          return (
            <article
              key={asset.id}
              className="flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-border bg-bg-0 shadow-shadow-xs transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-shadow-sm"
            >
              <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden bg-bg-2">
                {asset.kind === 'image' && previewUrl ? (
                  <button
                    type="button"
                    className="h-full w-full"
                    onClick={() => setViewerUrl(previewUrl)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt={asset.title} className="h-full w-full object-cover" />
                  </button>
                ) : asset.kind === 'audio' ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[radial-gradient(circle_at_top,rgba(238,120,72,0.18),transparent_52%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(0,0,0,0.04))] px-6 text-center">
                    <div className="flex size-14 items-center justify-center rounded-full bg-accent-bg text-accent">
                      <Headphones className="size-7" aria-hidden />
                    </div>
                    <div className="space-y-1">
                      <p className="line-clamp-2 text-sm font-medium text-text-0">{asset.title}</p>
                      <p className="text-xs text-text-3">音频资产</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-accent-bg to-bg-2">
                    <Video className="size-10 text-accent" aria-hidden />
                  </div>
                )}
                <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                  <Badge variant="secondary">
                    {asset.kind === 'video' ? '视频' : asset.kind === 'audio' ? '音频' : '图片'}
                  </Badge>
                  <Badge variant="outline">{getAssetSourceLabel(asset)}</Badge>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-3 border-t border-border p-4">
                <div className="min-h-0">
                  <h2 className="line-clamp-2 text-sm font-semibold text-text-0">
                    {asset.title}
                  </h2>
                  <p className="mt-1 text-xs text-text-3">
                    {asset.provider || 'unknown'} · {formatDate(asset.created_at)}
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-text-2">
                    {getAssetSourceDescription(asset, dramaTitle)}
                  </p>
                </div>

                {asset.kind === 'audio' && previewUrl ? (
                  <div className="rounded-[var(--radius-sm)] border border-border bg-bg-1 px-3 py-2">
                    <audio src={previewUrl} controls className="w-full" preload="metadata" />
                  </div>
                ) : null}

                <div className="mt-auto flex flex-wrap gap-2">
                  {previewUrl ? (
                    <Button asChild variant="outline" size="sm">
                      <a href={previewUrl} target="_blank" rel="noreferrer">
                        <Download />
                        下载
                      </a>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled>
                      <Download />
                      下载
                    </Button>
                  )}
                  {sourceHref ? (
                    <Button asChild variant="outline" size="sm">
                      <Link href={sourceHref}>
                        <ExternalLink />
                        {getAssetSourceActionLabel(asset)}
                      </Link>
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" disabled title="无法解析来源路径">
                      <ExternalLink />
                      来源不可用
                    </Button>
                  )}
                  {asset.kind === 'image' && previewUrl ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setViewerUrl(previewUrl)}
                    >
                      <ImageIcon />
                      预览
                    </Button>
                  ) : null}
                </div>
              </div>
            </article>
          )
        })}
      </div>
    )
  }

  const totalItems =
    libraryTab === 'characters'
      ? filteredCharacters.length
      : libraryTab === 'scenes'
        ? filteredScenes.length
        : filteredAssets.length

  return (
    <div className="page-shell animate-fade-up">
      <div className="mx-auto w-full">
        <div className="mb-7 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="page-title">资产库</h1>
            <p className="page-subtitle">
              统一查看角色、场景、图片、视频、音频资产，并追踪来源
            </p>
          </div>
        </div>

        <Tabs value={libraryTab} onValueChange={handleLibraryTabChange}>
          <TabsList className="mb-6 flex h-auto w-max max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-[var(--radius-pill)] border border-border bg-bg-2 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger
              value="characters"
              className="flex-none !h-9 rounded-[var(--radius-pill)] px-4 text-[13px] font-medium leading-none data-[state=inactive]:text-text-3"
            >
              <User size={14} className="mr-1.5 inline" />
              角色库
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {characters.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="scenes"
              className="flex-none !h-9 rounded-[var(--radius-pill)] px-4 text-[13px] font-medium leading-none data-[state=inactive]:text-text-3"
            >
              <MapPin size={14} className="mr-1.5 inline" />
              场景库
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {scenes.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="media"
              className="flex-none !h-9 rounded-[var(--radius-pill)] px-4 text-[13px] font-medium leading-none data-[state=inactive]:text-text-3"
            >
              <Layers size={14} className="mr-1.5 inline" />
              媒体库
              <Badge variant="secondary" className="ml-2 text-[10px]">
                {inventory.total}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <section className="section-card flex min-h-[680px] flex-col gap-5">
            <div className="flex flex-col gap-4">
              {libraryTab === 'media' && (
                <div className="min-w-0 w-full">
                  <Tabs value={mediaTab} onValueChange={(v) => setMediaTab(v as MediaTab)}>
                    <TabsList className="flex h-auto w-max max-w-full flex-nowrap items-center gap-0.5 overflow-x-auto overscroll-x-contain rounded-[var(--radius-pill)] border border-border bg-bg-2 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <TabsTrigger
                        value="all"
                        className="flex-none !h-9 rounded-[var(--radius-pill)] px-3.5 text-[13px] font-medium leading-none data-[state=inactive]:text-text-3 sm:px-4"
                      >
                        全部
                      </TabsTrigger>
                      <TabsTrigger
                        value="video"
                        className="flex-none !h-9 rounded-[var(--radius-pill)] px-3.5 text-[13px] font-medium leading-none data-[state=inactive]:text-text-3 sm:px-4"
                      >
                        视频
                      </TabsTrigger>
                      <TabsTrigger
                        value="image"
                        className="flex-none !h-9 rounded-[var(--radius-pill)] px-3.5 text-[13px] font-medium leading-none data-[state=inactive]:text-text-3 sm:px-4"
                      >
                        图片
                      </TabsTrigger>
                      <TabsTrigger
                        value="audio"
                        className="flex-none !h-9 rounded-[var(--radius-pill)] px-3.5 text-[13px] font-medium leading-none data-[state=inactive]:text-text-3 sm:px-4"
                      >
                        音频
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              )}

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
                <label className="relative flex items-center">
                  <Search className="pointer-events-none absolute left-3 size-4 text-text-3" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={
                      libraryTab === 'characters'
                        ? '搜索角色名称、身份或描述'
                        : libraryTab === 'scenes'
                          ? '搜索场景、地点或氛围'
                          : '搜索标题、Provider、来源类型或项目名'
                    }
                    className="h-11 pl-10 text-sm"
                  />
                </label>
                <Button
                  variant="outline"
                  className="h-11 shrink-0"
                  onClick={() => void handleRefresh()}
                >
                  <RefreshCw />
                  刷新
                </Button>
              </div>

              {!loading ? (
                <p className="text-xs text-text-3">
                  {libraryTab === 'characters'
                    ? `共 ${characters.length} 个角色，当前列表展示 ${filteredCharacters.length} 个`
                    : libraryTab === 'scenes'
                      ? `共 ${scenes.length} 个场景，当前列表展示 ${filteredScenes.length} 个`
                      : `共 ${assets.length} 条资产，当前列表展示 ${filteredAssets.length} 条${
                          mediaTab !== 'all'
                            ? `（已筛选：${
                                mediaTab === 'video'
                                  ? '视频'
                                  : mediaTab === 'image'
                                    ? '图片'
                                    : '音频'
                              }）`
                            : ''
                        }`}
                  {query.trim() ? '（已应用搜索）' : ''}
                </p>
              ) : null}
            </div>

            {renderTabContent()}
          </section>
        </Tabs>

        <ImageViewer open={!!viewerUrl} src={viewerUrl} onClose={() => setViewerUrl('')} />
      </div>
    </div>
  )
}

function AssetsPageFallback() {
  return (
    <div className="page-shell">
      <div className="mx-auto w-full">
        <div className="mb-7 flex flex-col gap-3">
          <div className="h-8 w-36 animate-shimmer rounded-lg bg-bg-2" />
          <div className="h-4 w-80 animate-shimmer rounded bg-bg-2" />
        </div>
        <div className="flex min-h-[680px] animate-shimmer rounded-[var(--radius-lg)] bg-bg-2" />
      </div>
    </div>
  )
}

export default function AssetsPage() {
  return (
    <Suspense fallback={<AssetsPageFallback />}>
      <AssetsPageContent />
    </Suspense>
  )
}
