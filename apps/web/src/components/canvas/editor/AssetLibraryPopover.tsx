'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { Film, Headphones, Image as ImageIcon, Loader2, MapPin, Search, User } from 'lucide-react'
import { toast } from 'sonner'

import { assetAPI, dramaAPI } from '@/lib/api'
import { staticUrl } from '@/lib/utils'
import type { AssetRecord, Character, Drama, Scene } from '@/types/api'
import { useCanvasStore, useHistoryStore, useNodesStore, useUiStore, type FlowNode } from '@/lib/canvas/store'
import { cryptoRandomId, findFreePosition } from './_utils'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

type AssetTab = 'characters' | 'scenes' | 'images' | 'videos' | 'audios'

const TABS: Array<{ id: AssetTab; label: string }> = [
  { id: 'characters', label: '角色' },
  { id: 'scenes', label: '场景' },
  { id: 'images', label: '图片' },
  { id: 'videos', label: '视频' },
  { id: 'audios', label: '音频' },
]

export function AssetLibraryPopover({ onInserted }: { onInserted?: () => void }) {
  const reactFlow = useReactFlow()
  const addNode = useNodesStore((s) => s.addNode)
  const markEditing = useCanvasStore((s) => s.markEditing)
  const historyPush = useHistoryStore((s) => s.push)
  const setSelectedNodeId = useUiStore((s) => s.setSelectedNodeId)

  const [tab, setTab] = useState<AssetTab>('characters')
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [assets, setAssets] = useState<AssetRecord[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [dramaMap, setDramaMap] = useState<Record<number, string>>({})

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const [assetPayload, dramasPayload] = await Promise.all([
        assetAPI.list(),
        dramaAPI.list({ include_details: true }, { redirectOnUnauthorized: false }),
      ]) as [
        { items: AssetRecord[]; total: number },
        { items: Drama[] },
      ]

      const dramas = dramasPayload.items || []
      setAssets(assetPayload.items || [])
      setCharacters(dramas.flatMap((drama) => drama.characters || []))
      setScenes(dramas.flatMap((drama) => drama.scenes || []))
      setDramaMap(Object.fromEntries(dramas.map((drama) => [drama.id, drama.title])))
    } catch (error) {
      toast.error((error as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const task = window.setTimeout(() => {
      void load()
    }, 0)
    return () => {
      window.clearTimeout(task)
    }
  }, [load])

  const q = query.trim().toLowerCase()

  const filteredCharacters = useMemo(
    () =>
      characters.filter((item) =>
        !q
          || item.name.toLowerCase().includes(q)
          || String(item.role || '').toLowerCase().includes(q)
          || String(item.description || '').toLowerCase().includes(q),
      ),
    [characters, q],
  )

  const filteredScenes = useMemo(
    () =>
      scenes.filter((item) =>
        !q
          || String(item.location || '').toLowerCase().includes(q)
          || String(item.time || '').toLowerCase().includes(q)
          || String(item.prompt || '').toLowerCase().includes(q),
      ),
    [q, scenes],
  )

  const filteredAssets = useMemo(
    () =>
      assets.filter((item) => {
        if (tab === 'images' && item.kind !== 'image') return false
        if (tab === 'videos' && item.kind !== 'video') return false
        if (tab === 'audios' && item.kind !== 'audio') return false
        if (!q) return true
        return (
          item.title.toLowerCase().includes(q)
          || String(item.provider || '').toLowerCase().includes(q)
          || String(item.source_type || '').toLowerCase().includes(q)
        )
      }),
    [assets, q, tab],
  )

  const insertNode = useCallback((node: FlowNode) => {
    historyPush()
    addNode(node)
    markEditing()
    setSelectedNodeId(node.id)
    onInserted?.()
  }, [addNode, historyPush, markEditing, onInserted, setSelectedNodeId])

  const nextPosition = useCallback(() => {
    const center = reactFlow.screenToFlowPosition({
      x: typeof window !== 'undefined' ? window.innerWidth / 2 : 600,
      y: typeof window !== 'undefined' ? window.innerHeight / 2 : 400,
    })
    return findFreePosition({ x: center.x - 110, y: center.y - 84 }, useNodesStore.getState().nodes)
  }, [reactFlow])

  const insertCharacter = useCallback((character: Character) => {
    const imageUrl = staticUrl(character.image_url || character.reference_images || '')
    insertNode({
      id: `node_${cryptoRandomId()}`,
      type: 'character',
      position: nextPosition(),
      data: {
        name: character.name,
        label: character.name,
        description: character.description || character.appearance || '',
        images: imageUrl ? [imageUrl] : [],
        characterId: String(character.id),
      },
    })
  }, [insertNode, nextPosition])

  const insertScene = useCallback((scene: Scene) => {
    const imageUrl = staticUrl(scene.image_url || '')
    insertNode({
      id: `node_${cryptoRandomId()}`,
      type: 'scene',
      position: nextPosition(),
      data: {
        name: scene.location || '未命名场景',
        label: scene.location || '未命名场景',
        description: [scene.time, scene.prompt].filter(Boolean).join(' · '),
        images: imageUrl ? [imageUrl] : [],
        sceneId: String(scene.id),
      },
    })
  }, [insertNode, nextPosition])

  const insertAsset = useCallback((asset: AssetRecord) => {
    const previewUrl = staticUrl(asset.url || '')
    if (asset.kind === 'audio') {
      insertNode({
        id: `node_${cryptoRandomId()}`,
        type: 'audio',
        position: nextPosition(),
        data: {
          title: asset.title,
          label: asset.title,
          url: previewUrl,
          provider: asset.provider || '',
          assetId: String(asset.id),
        },
      })
      return
    }

    if (asset.kind === 'video') {
      insertNode({
        id: `node_${cryptoRandomId()}`,
        type: 'video-asset',
        position: nextPosition(),
        data: {
          title: asset.title,
          label: asset.title,
          videoUrl: previewUrl,
          thumbnailUrl: staticUrl(asset.thumbnail_url || ''),
          provider: asset.provider || '',
          assetId: String(asset.id),
        },
      })
      return
    }

    insertNode({
      id: `node_${cryptoRandomId()}`,
      type: 'image',
      position: nextPosition(),
      data: {
        label: asset.title,
        images: previewUrl ? [previewUrl] : [],
        assetId: String(asset.id),
        text: '图片资产引用',
      },
    })
  }, [insertNode, nextPosition])

  const renderCharacterList = () => (
    <div className="grid gap-2">
      {filteredCharacters.map((character) => {
        const imageUrl = staticUrl(character.image_url || character.reference_images || '')
        return (
          <button
            key={character.id}
            type="button"
            onClick={() => insertCharacter(character)}
            className="flex items-center gap-3 rounded-xl border border-border bg-bg-0 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
          >
            <div className="flex size-11 items-center justify-center overflow-hidden rounded-full bg-bg-2">
              {imageUrl ? (
                <img src={imageUrl} alt={character.name} className="size-full object-cover" />
              ) : (
                <User className="size-5 text-text-3" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-0">{character.name}</p>
              <p className="truncate text-xs text-text-3">{dramaMap[character.drama_id] || '角色资产'}</p>
            </div>
          </button>
        )
      })}
    </div>
  )

  const renderSceneList = () => (
    <div className="grid gap-2">
      {filteredScenes.map((scene) => (
        <button
          key={scene.id}
          type="button"
          onClick={() => insertScene(scene)}
          className="flex items-center gap-3 rounded-xl border border-border bg-bg-0 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
        >
          <div className="flex size-11 items-center justify-center rounded-xl bg-bg-2">
            <MapPin className="size-5 text-text-3" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-0">{scene.location || '未命名场景'}</p>
            <p className="truncate text-xs text-text-3">{dramaMap[scene.drama_id] || scene.time || '场景资产'}</p>
          </div>
        </button>
      ))}
    </div>
  )

  const renderAssetList = () => (
    <div className="grid gap-2">
      {filteredAssets.map((asset) => {
        const Icon = asset.kind === 'audio' ? Headphones : asset.kind === 'video' ? Film : ImageIcon
        return (
          <button
            key={asset.id}
            type="button"
            onClick={() => insertAsset(asset)}
            className="flex items-center gap-3 rounded-xl border border-border bg-bg-0 px-3 py-2 text-left transition-colors hover:bg-bg-hover"
          >
            <div className="flex size-11 items-center justify-center rounded-xl bg-bg-2">
              <Icon className="size-5 text-text-3" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-text-0">{asset.title}</p>
              <p className="truncate text-xs text-text-3">{asset.provider || asset.source_type}</p>
            </div>
          </button>
        )
      })}
    </div>
  )

  const emptyText = tab === 'characters'
    ? '没有可引用的角色资产'
    : tab === 'scenes'
      ? '没有可引用的场景资产'
      : tab === 'videos'
        ? '没有可引用的视频资产'
        : tab === 'audios'
          ? '没有可引用的音频资产'
          : '没有可引用的图片资产'

  const contentCount =
    tab === 'characters'
      ? filteredCharacters.length
      : tab === 'scenes'
        ? filteredScenes.length
        : filteredAssets.length

  return (
    <div className="flex max-h-[560px] w-[360px] flex-col gap-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-text-0">引用资产</h3>
        <p className="text-xs text-text-3">把已有角色、场景、图片、视频、音频加入当前画布。</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <Button
            key={item.id}
            type="button"
            size="sm"
            variant={tab === item.id ? 'default' : 'outline'}
            onClick={() => setTab(item.id)}
            className="h-8 rounded-full px-3 text-xs"
          >
            {item.label}
          </Button>
        ))}
      </div>

      <label className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索名称、描述或来源"
          className="h-10 pl-9"
        />
      </label>

      <div className="flex items-center justify-between text-xs text-text-3">
        <span>共 {contentCount} 项</span>
        <button type="button" className="text-accent hover:underline" onClick={() => void load()}>
          刷新
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl border border-border bg-bg-1 p-2">
        {loading ? (
          <div className="flex h-full items-center justify-center text-text-3">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : contentCount === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-text-3">
            {emptyText}
          </div>
        ) : tab === 'characters' ? (
          renderCharacterList()
        ) : tab === 'scenes' ? (
          renderSceneList()
        ) : (
          renderAssetList()
        )}
      </div>
    </div>
  )
}
