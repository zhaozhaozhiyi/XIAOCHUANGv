'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  Headphones,
  Download,
  ExternalLink,
  ImageIcon,
  Layers,
  MapPin,
  RefreshCw,
  Search,
  User,
  Video,
} from 'lucide-react'

import { assetAPI, dramaAPI } from '@/lib/api'
import {
  ContentPageHeader,
  ContentStateBlock,
  ContentSurface,
  ContentSummary,
} from '@/components/shared/content-kit'
import { formatDate, staticUrl } from '@/lib/utils'
import { EmptyState } from '@/components/shared/empty-state'
import { ImageViewer } from '@/components/shared/image-viewer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { AssetRecord, Character, Drama, Scene } from '@/types/api'

type LibraryTab = 'characters' | 'scenes' | 'media'
type MediaTab = 'all' | 'video' | 'image' | 'audio'
type MediaSourceTab = 'all' | 'canvas' | 'quick' | 'drama' | 'writing' | 'legacy'

const CANVAS_SOURCE_TYPES = new Set(['canvas_upload', 'canvas_generation', 'canvas_history', 'canvas_export'])

function getAssetPreviewUrl(asset: AssetRecord) {
  return staticUrl(asset.url || '')
}

function getAssetKindLabel(kind: AssetRecord['kind']) {
  if (kind === 'video') return '视频'
  if (kind === 'audio') return '声音'
  return '图片'
}

function parseAssetMetadata(asset: AssetRecord): Record<string, unknown> {
  if (!asset.metadata_json) return {}
  try {
    const parsed = JSON.parse(asset.metadata_json) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function isCanvasAsset(asset: AssetRecord) {
  return CANVAS_SOURCE_TYPES.has(asset.source_type)
}

function getStringMetadata(asset: AssetRecord, key: string) {
  const value = parseAssetMetadata(asset)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

interface SafeImageProps {
  alt: string
  className?: string
  fallback: ReactNode
  src: string
}

function SafeImage({ alt, className, fallback, src }: SafeImageProps) {
  const [failedSrc, setFailedSrc] = useState('')
  const hasError = failedSrc === src

  if (!src || hasError) return <>{fallback}</>

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailedSrc(src)}
    />
  )
}

function AssetImageFallback() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_5%,transparent),color-mix(in_srgb,var(--color-bg-2)_80%,var(--color-bg-0)))] px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-bg-surface-glass text-text-2 backdrop-blur-md">
        <ImageIcon className="size-7" aria-hidden />
      </div>
      <p className="font-display text-lg font-semibold tracking-tight text-text-0">图片</p>
      <p className="text-xs text-text-3">图片暂不可用</p>
    </div>
  )
}

interface MediaImagePreviewProps {
  alt: string
  isBroken?: boolean
  onBroken: (src: string) => void
  onOpen: () => void
  src: string
}

function MediaImagePreview({ alt, isBroken = false, onBroken, onOpen, src }: MediaImagePreviewProps) {
  const [failedSrc, setFailedSrc] = useState('')
  const hasError = failedSrc === src

  if (!src || isBroken || hasError) return <AssetImageFallback />

  return (
    <button
      type="button"
      className="h-full w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-inset"
      onClick={onOpen}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-[1.025]"
        onError={() => {
          setFailedSrc(src)
          onBroken(src)
        }}
      />
    </button>
  )
}

function getAssetSourceHref(asset: AssetRecord): string | null {
  if (isCanvasAsset(asset)) {
    const canvasId = getStringMetadata(asset, 'canvas_id') || asset.source_ref || ''
    const basePath = asset.source_path || (canvasId ? `/canvas/${canvasId}` : '')
    if (!basePath) return null
    const query = new URLSearchParams()
    const nodeId = getStringMetadata(asset, 'node_id')
    const resultId = getStringMetadata(asset, 'result_id')
    if (nodeId) query.set('node', nodeId)
    if (resultId) query.set('result', resultId)
    return query.size ? `${basePath}?${query.toString()}` : basePath
  }
  if (asset.drama_id) return `/drama/${asset.drama_id}`
  if (asset.source_type === 'writing' && asset.source_path) return asset.source_path
  if (asset.source_type === 'quick_video' || asset.source_type === 'quick_image') return '/create/video'
  if (asset.source_type === 'drama_video' && asset.source_path) return asset.source_path
  if (asset.source_path) return asset.source_path
  return null
}

function getAssetSourceLabel(asset: AssetRecord) {
  if (asset.source_type === 'canvas_upload') return '画布上传'
  if (asset.source_type === 'canvas_generation') return '画布生成'
  if (asset.source_type === 'canvas_history') return '画布历史'
  if (asset.source_type === 'canvas_export') return '画布导出'
  if (asset.source_type === 'quick_video' || asset.source_type === 'quick_image') return '快速成片'
  if (asset.source_type === 'writing') return '小说剧本'
  if (asset.source_type === 'drama_video') return '短剧任务'
  if (asset.source_type === 'legacy_asset') return '历史资产'
  return '任务来源'
}

function getAssetSourceDescription(asset: AssetRecord, dramaTitle?: string) {
  if (dramaTitle) return `来源项目：${dramaTitle}`
  const canvasTitle = getStringMetadata(asset, 'canvas_title')
  if (canvasTitle) return `来源画布：${canvasTitle}`
  if (asset.source_type === 'canvas_upload') return '来源：画布上传素材'
  if (asset.source_type === 'canvas_generation') return '来源：画布生成结果'
  if (asset.source_type === 'canvas_history') return '来源：画布历史结果'
  if (asset.source_type === 'canvas_export') return '来源：画布合成导出'
  if (asset.source_type === 'writing') return '来源：小说剧本导出或改编链路'
  if (asset.source_type === 'quick_video' || asset.source_type === 'quick_image' || asset.source_type === 'quick_audio') return '来源：快速成片'
  if (asset.source_type === 'legacy_asset') return '来源：历史回填资产'
  return '来源：独立任务'
}

function getAssetSourceActionLabel(asset: AssetRecord) {
  if (isCanvasAsset(asset)) return '打开画布'
  if (asset.drama_id) return '打开项目'
  if (asset.source_type === 'writing') return '打开文稿'
  if (asset.source_type === 'quick_video' || asset.source_type === 'quick_image' || asset.source_type === 'quick_audio') return '打开快速成片'
  return '打开来源'
}

function getSourceTabLabel(tab: MediaSourceTab) {
  if (tab === 'canvas') return '画布资产'
  if (tab === 'quick') return '快速成片'
  if (tab === 'drama') return '短剧任务'
  if (tab === 'writing') return '小说剧本'
  if (tab === 'legacy') return '历史资产'
  return ''
}

interface CharacterCardProps {
  character: Character
  dramaTitle?: string
  onOpen?: () => void
}

function CharacterCard({ character, dramaTitle, onOpen }: CharacterCardProps) {
  const imageUrl = staticUrl(character.image_url || character.reference_images || '')

  return (
    <article className="content-card group">
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-square w-full overflow-hidden bg-[color-mix(in_srgb,var(--color-bg-2)_72%,var(--color-bg-0))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-inset"
      >
        <SafeImage
          src={imageUrl}
          alt={character.name}
          className="size-full object-cover"
          fallback={(
            <div className="flex size-full items-center justify-center">
              <User size={40} className="text-text-3" />
            </div>
          )}
        />
      </button>

      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3">
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
    <article className="content-card group">
      <button
        type="button"
        onClick={onOpen}
        className="relative aspect-[16/9] w-full overflow-hidden bg-[color-mix(in_srgb,var(--color-bg-2)_72%,var(--color-bg-0))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 focus-visible:ring-inset"
      >
        <SafeImage
          src={imageUrl}
          alt={scene.location || '场景'}
          className="size-full object-cover"
          fallback={(
            <div className="flex size-full items-center justify-center">
              <MapPin size={32} className="text-text-3" />
            </div>
          )}
        />
      </button>

      <div className="flex flex-1 flex-col gap-2 px-4 pb-4 pt-3">
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
  const [sourceTab, setSourceTab] = useState<MediaSourceTab>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [detailsLoaded, setDetailsLoaded] = useState(false)
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [dramaMap, setDramaMap] = useState<Record<number, string>>({})
  const [brokenImageUrls, setBrokenImageUrls] = useState<Record<string, true>>({})
  const [viewerUrl, setViewerUrl] = useState('')

  const load = useMemo(() => async () => {
    try {
      setLoading(true)
      const [assetPayload, dramas] = await Promise.all([
        assetAPI.list(undefined, { bypassCache: true }),
        dramaAPI.list({ include_details: false }),
      ]) as [
        { items: AssetRecord[]; total: number },
        { items: Drama[] },
      ]

      setAssets(assetPayload.items)
      setBrokenImageUrls({})
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
      if (sourceTab === 'canvas' && !isCanvasAsset(item)) return false
      if (sourceTab === 'quick' && !['quick_video', 'quick_image', 'quick_audio'].includes(item.source_type)) return false
      if (sourceTab === 'drama' && !(item.source_type === 'drama_video' || item.drama_id)) return false
      if (sourceTab === 'writing' && item.source_type !== 'writing') return false
      if (sourceTab === 'legacy' && item.source_type !== 'legacy_asset') return false
      if (!query.trim()) return true
      const q = query.trim().toLowerCase()
      const metadata = parseAssetMetadata(item)
      return (
        item.title.toLowerCase().includes(q) ||
        String(item.provider || '').toLowerCase().includes(q) ||
        String(item.source_type || '').toLowerCase().includes(q) ||
        String(metadata.canvas_title || '').toLowerCase().includes(q) ||
        (item.drama_id ? dramaMap[item.drama_id]?.toLowerCase().includes(q) : false)
      )
    })
  }, [assets, dramaMap, query, mediaTab, sourceTab])

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
          <ContentStateBlock
            title="正在加载角色库"
            description="角色名称、身份和描述会在这里集中展示。"
            busy
            className="flex-1"
          />
        )
      }
      if (filteredCharacters.length === 0) {
        return (
          <EmptyState
            icon={User}
            title={query.trim() ? '没有找到匹配的角色' : '还没有收录角色'}
            description={query.trim() ? '没有符合搜索条件的角色' : '还没有收录角色，请从短剧详情中收录'}
            className="flex-1 border-0 bg-transparent"
          />
        )
      }
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
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
          <ContentStateBlock
            title="正在加载场景库"
            description="场景地点、氛围和分镜信息会在这里统一聚合。"
            busy
            className="flex-1"
          />
        )
      }
      if (filteredScenes.length === 0) {
        return (
          <EmptyState
            icon={MapPin}
            title={query.trim() ? '没有找到匹配的场景' : '还没有收录场景'}
            description={query.trim() ? '没有符合搜索条件的场景' : '还没有收录场景，请从短剧详情中收录'}
            className="flex-1 border-0 bg-transparent"
          />
        )
      }
      return (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
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
        <ContentStateBlock
          title="正在加载媒体资产"
          description="图片、视频和声音会按来源与类型整理在这里。"
          busy
          className="flex-1"
        />
      )
    }
    if (filteredAssets.length === 0) {
      return (
        <EmptyState
          icon={Layers}
          title="当前没有可展示的资产"
          description="当前筛选条件下还没有可展示的资产。可先快速成片，再把结果沉淀到资产。"
          actionLabel="前往快速成片"
          onAction={() => {
            window.location.href = '/create/video'
          }}
          className="flex-1 border-0 bg-transparent"
        />
      )
    }
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
        {filteredAssets.map((asset) => {
          const dramaTitle = asset.drama_id ? dramaMap[asset.drama_id] : ''
          const previewUrl = getAssetPreviewUrl(asset)
          const sourceHref = getAssetSourceHref(asset)
          const imageIsBroken = Boolean(asset.kind === 'image' && previewUrl && brokenImageUrls[previewUrl])
          const previewAvailable = Boolean(previewUrl && !imageIsBroken)

          return (
            <article key={asset.id} className="content-card group">
              <div className="content-media-shell">
                {asset.kind === 'image' ? (
                  <MediaImagePreview
                    src={previewUrl}
                    alt={asset.title}
                    isBroken={imageIsBroken}
                    onOpen={() => setViewerUrl(previewUrl)}
                    onBroken={(url) => {
                      setBrokenImageUrls((current) => (
                        current[url] ? current : { ...current, [url]: true }
                      ))
                    }}
                  />
                ) : asset.kind === 'audio' ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_7%,transparent),color-mix(in_srgb,var(--color-bg-2)_78%,var(--color-bg-0)))] px-6 text-center">
                    <div className="flex size-14 items-center justify-center rounded-full bg-bg-surface-glass text-accent backdrop-blur-md">
                      <Headphones className="size-7" aria-hidden />
                    </div>
                    <p className="font-display text-lg font-semibold tracking-tight text-text-0">声音</p>
                    <p className="text-xs text-text-3">可播放声音资产</p>
                  </div>
                ) : asset.kind === 'video' ? (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_7%,transparent),color-mix(in_srgb,var(--color-bg-2)_78%,var(--color-bg-0)))] px-6 text-center">
                    <div className="flex size-14 items-center justify-center rounded-full bg-bg-surface-glass text-accent backdrop-blur-md">
                      <Video className="size-7" aria-hidden />
                    </div>
                    <p className="font-display text-lg font-semibold tracking-tight text-text-0">视频</p>
                    <p className="text-xs text-text-3">视频资产</p>
                  </div>
                ) : (
                  <AssetImageFallback />
                )}
                <div className="absolute left-3 top-3 flex flex-wrap gap-2">
                  <Badge variant="secondary" className="content-glass-badge text-[11px]">
                    {getAssetKindLabel(asset.kind)}
                  </Badge>
                  <Badge variant="outline" className="content-glass-badge text-[11px]">{getAssetSourceLabel(asset)}</Badge>
                </div>
              </div>

              <div className="flex flex-1 flex-col gap-3 px-4 pb-4 pt-3">
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
                  <div className="rounded-[10px] bg-bg-0/70 px-3 py-2">
                    <audio src={previewUrl} controls className="w-full" preload="metadata" />
                  </div>
                ) : null}

                <div className="mt-auto flex flex-wrap gap-2">
                  {previewAvailable ? (
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
                  {asset.kind === 'image' && previewAvailable ? (
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
        <ContentPageHeader
          title="资产库"
          description="统一查看角色、场景、图片、视频、声音资产，并追踪来源。"
        />

        <Tabs value={libraryTab} onValueChange={handleLibraryTabChange}>
          <TabsList className="content-segmented-list mb-6">
            <TabsTrigger
              value="characters"
              className="content-segmented-trigger"
            >
              <User size={14} className="mr-1.5 inline" />
              角色库
              <Badge variant="secondary" className="ml-2 border-0 bg-bg-2 px-1.5 text-[10px] shadow-none">
                {characters.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="scenes"
              className="content-segmented-trigger"
            >
              <MapPin size={14} className="mr-1.5 inline" />
              场景库
              <Badge variant="secondary" className="ml-2 border-0 bg-bg-2 px-1.5 text-[10px] shadow-none">
                {scenes.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger
              value="media"
              className="content-segmented-trigger"
            >
              <Layers size={14} className="mr-1.5 inline" />
              媒体库
              <Badge variant="secondary" className="ml-2 border-0 bg-bg-2 px-1.5 text-[10px] shadow-none">
                {inventory.total}
              </Badge>
            </TabsTrigger>
          </TabsList>

          <ContentSurface className="min-h-[680px]">
            <div className="flex flex-col gap-4">
              {libraryTab === 'media' && (
                <div className="flex min-w-0 w-full flex-col gap-3">
                  <Tabs value={mediaTab} onValueChange={(v) => setMediaTab(v as MediaTab)}>
                    <TabsList className="content-segmented-list">
                      <TabsTrigger
                        value="all"
                        className="content-segmented-trigger"
                      >
                        全部
                      </TabsTrigger>
                      <TabsTrigger
                        value="video"
                        className="content-segmented-trigger"
                      >
                        视频
                      </TabsTrigger>
                      <TabsTrigger
                        value="image"
                        className="content-segmented-trigger"
                      >
                        图片
                      </TabsTrigger>
                      <TabsTrigger
                        value="audio"
                        className="content-segmented-trigger"
                      >
                        声音
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as MediaSourceTab)}>
                    <TabsList className="content-segmented-list">
                      <TabsTrigger value="all" className="content-segmented-trigger">
                        全部来源
                      </TabsTrigger>
                      <TabsTrigger value="canvas" className="content-segmented-trigger">
                        画布资产
                      </TabsTrigger>
                      <TabsTrigger value="quick" className="content-segmented-trigger">
                        快速成片
                      </TabsTrigger>
                      <TabsTrigger value="drama" className="content-segmented-trigger">
                        短剧任务
                      </TabsTrigger>
                      <TabsTrigger value="writing" className="content-segmented-trigger">
                        小说剧本
                      </TabsTrigger>
                      <TabsTrigger value="legacy" className="content-segmented-trigger">
                        历史资产
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
                    className="h-11 rounded-[11px] border-border/60 pl-10 text-sm shadow-none"
                  />
                </label>
                <Button
                  variant="outline"
                  className="h-11 shrink-0 border-border/60 shadow-none"
                  onClick={() => void handleRefresh()}
                >
                  <RefreshCw />
                  刷新
                </Button>
              </div>

              {!loading ? (
                <ContentSummary>
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
                                    : '声音'
                              }）`
                            : ''
                        }${sourceTab !== 'all' ? `（来源：${getSourceTabLabel(sourceTab)}）` : ''}`}
                  {query.trim() ? '（已应用搜索）' : ''}
                </ContentSummary>
              ) : null}
            </div>

            {renderTabContent()}
          </ContentSurface>
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
