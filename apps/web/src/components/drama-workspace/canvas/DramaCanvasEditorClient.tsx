'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AudioLines, Boxes, ChevronLeft, ChevronRight, FolderHeart, ImageIcon, Loader2, Network, RefreshCw, Video } from 'lucide-react'
import { toast } from 'sonner'
import { CanvasEditor } from '@/components/canvas/editor/CanvasEditor'
import { useCanvas } from '@/lib/canvas/hooks/useCanvas'
import { useCanvasStore, useHistoryStore, useNodesStore, useUiStore } from '@/lib/canvas/store'
import { usePipelineStore } from '@/lib/canvas/store/pipelineStore'
import { dramaWorkspaceAPI, type DramaCanvasSummary, type DramaProjectAsset } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { CanvasNodeResult } from '@/lib/canvas/types'
import { staticUrl } from '@/lib/utils'
import { findFreePosition } from '@/components/canvas/editor/_utils'
import { getEpisodeWorkbenchHref } from '../episodes/episode-route'
import { getDramaCanvasContext, getDramaCanvasHref } from './canvas-route'
import { useDramaWorkspace } from '../use-drama-workspace'
import {
  DRAMACLAW_ASSET_DRAG_MIME,
  createDramaClawNodeFromAsset,
  serializeDramaClawAssetDrag,
} from '@/components/canvas/dramaclaw'

function numberFromData(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function resolveAssetTarget(nodeType: string, nodeData: Record<string, unknown>) {
  const storyboardId = numberFromData(nodeData.storyboardId)
  if (nodeType === 'character' && numberFromData(nodeData.characterId)) {
    return {
      asset_scope: 'project' as const,
      asset_role: 'character_portrait',
      target_type: 'character' as const,
      target_id: String(numberFromData(nodeData.characterId)),
      target_field: 'image',
      storyboard_id: undefined,
    }
  }
  if (nodeType === 'scene' && numberFromData(nodeData.sceneId)) {
    return {
      asset_scope: 'episode' as const,
      asset_role: 'scene_image',
      target_type: 'scene' as const,
      target_id: String(numberFromData(nodeData.sceneId)),
      target_field: 'image',
      storyboard_id: undefined,
    }
  }
  if (storyboardId && nodeType === 'text-to-speech') {
    return {
      asset_scope: 'storyboard' as const,
      asset_role: 'voiceover',
      target_type: 'storyboard' as const,
      target_id: String(storyboardId),
      target_field: 'voiceover',
      storyboard_id: storyboardId,
    }
  }
  if (storyboardId && nodeType === 'image-to-video') {
    return {
      asset_scope: 'storyboard' as const,
      asset_role: 'shot_video',
      target_type: 'storyboard' as const,
      target_id: String(storyboardId),
      target_field: 'shot_video',
      storyboard_id: storyboardId,
    }
  }
  if (storyboardId && nodeType === 'text-to-image') {
    return {
      asset_scope: 'storyboard' as const,
      asset_role: 'first_frame',
      target_type: 'storyboard' as const,
      target_id: String(storyboardId),
      target_field: 'first_frame',
      storyboard_id: storyboardId,
    }
  }
  if (storyboardId) {
    return {
      asset_scope: 'storyboard' as const,
      asset_role: 'reference',
      target_type: 'storyboard' as const,
      target_id: String(storyboardId),
      target_field: 'first_frame',
      storyboard_id: storyboardId,
    }
  }
  return {
    asset_scope: 'project' as const,
    asset_role: 'reference',
    target_type: undefined,
    target_id: undefined,
    target_field: undefined,
    storyboard_id: undefined,
  }
}

function SaveProjectAssetMenuItem({
  dramaId,
  canvasId,
  nodeId,
  nodeType,
  nodeData,
  currentResult,
  close,
}: {
  dramaId: number
  canvasId: string
  nodeId: string
  nodeType: string
  nodeData: Record<string, unknown>
  currentResult?: CanvasNodeResult | null
  close: () => void
}) {
  const updateNodeData = useNodesStore((s) => s.updateNodeData)
  const target = resolveAssetTarget(nodeType, nodeData)
  const disabled = !currentResult?.id || !currentResult?.url || Boolean(currentResult.asset_id)

  const save = async () => {
    if (disabled) return
    try {
      const item = await dramaWorkspaceAPI.saveCanvasResultToProjectAssets(dramaId, {
        canvas_id: canvasId,
        node_id: nodeId,
        result_id: currentResult?.id,
        asset_scope: target.asset_scope,
        asset_role: target.asset_role,
        episode_id: numberFromData(nodeData.episodeId),
        storyboard_id: target.storyboard_id,
        target_type: target.target_type,
        target_id: target.target_id,
        target_field: target.target_field,
        title: currentResult?.title || String(nodeData.title || nodeData.label || '画布产物'),
      })
      const results = Array.isArray(nodeData.results) ? nodeData.results : []
      updateNodeData(nodeId, {
        results: results.map((result) => (
          result && typeof result === 'object' && 'id' in result && result.id === currentResult?.id
            ? { ...result, asset_id: item.asset_id }
            : result
        )),
      })
      toast.success('已保存到素材')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存到素材失败')
    } finally {
      close()
    }
  }

  return (
    <button
      type="button"
      onClick={() => void save()}
      disabled={disabled}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-text-0 transition-colors hover:bg-bg-hover focus:bg-bg-hover focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
    >
      <FolderHeart className="size-4 shrink-0 text-text-2" />
      <span className="flex-1">{currentResult?.asset_id ? '已保存到素材' : '保存到素材'}</span>
    </button>
  )
}

function CanvasDockAssetPreview({ asset }: { asset: DramaProjectAsset }) {
  const preview = staticUrl(asset.thumbnail_url || asset.url || '')
  if (!preview || asset.kind === 'audio') {
    return (
      <span className="drama-canvas-dock-thumb is-empty">
        {asset.kind === 'video' ? <Video size={14} /> : asset.kind === 'audio' ? <AudioLines size={14} /> : <ImageIcon size={14} />}
      </span>
    )
  }
  if (asset.kind === 'video') {
    return <video src={preview} className="drama-canvas-dock-thumb" muted playsInline preload="metadata" />
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={preview} alt={asset.title} className="drama-canvas-dock-thumb" />
}

function DramaCanvasAssetDock({ dramaId }: { dramaId: number }) {
  const [collapsed, setCollapsed] = useState(true)
  const [tab, setTab] = useState<'assets' | 'canvases'>('assets')
  const [assets, setAssets] = useState<DramaProjectAsset[]>([])
  const [canvases, setCanvases] = useState<DramaCanvasSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const addNode = useNodesStore((s) => s.addNode)
  const historyPush = useHistoryStore((s) => s.push)
  const markEditing = useCanvasStore((s) => s.markEditing)
  const setSelectedNodeId = useUiStore((s) => s.setSelectedNodeId)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [assetRes, canvasRes] = await Promise.all([
        dramaWorkspaceAPI.listProjectAssets(dramaId, { page_size: 36 }, { bypassCache: true }),
        dramaWorkspaceAPI.listCanvases(dramaId, undefined, { bypassCache: true }),
      ])
      setAssets(assetRes.items)
      setCanvases(canvasRes.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [dramaId])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  const insertAsset = useCallback((asset: DramaProjectAsset) => {
    const viewport = useCanvasStore.getState().viewport
    const flowRoot = document.querySelector('.react-flow') as HTMLElement | null
    const rect = flowRoot?.getBoundingClientRect()
    const viewportWidth = rect?.width || window.innerWidth
    const viewportHeight = rect?.height || window.innerHeight
    const zoom = viewport.zoom || 1
    const position = findFreePosition(
      {
        x: (viewportWidth / 2 - viewport.x) / zoom - 160,
        y: (viewportHeight / 2 - viewport.y) / zoom - 140,
      },
      useNodesStore.getState().nodes,
    )
    const node = createDramaClawNodeFromAsset(asset, position)
    historyPush()
    addNode(node)
    markEditing()
    setSelectedNodeId(node.id)
  }, [addNode, historyPush, markEditing, setSelectedNodeId])

  return (
    <aside className={cn('drama-canvas-asset-dock', collapsed && 'is-collapsed')} aria-label="项目素材侧栏">
      <button
        type="button"
        className="drama-canvas-dock-toggle"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? '展开项目素材侧栏' : '收起项目素材侧栏'}
      >
        {collapsed ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
      </button>

      {!collapsed ? (
        <>
          <div className="drama-canvas-dock-head">
            <strong>项目资源</strong>
            <button type="button" className="drama-canvas-dock-icon" onClick={() => void load()} aria-label="刷新项目资源">
              <RefreshCw size={14} />
            </button>
          </div>
          <div className="drama-canvas-dock-tabs" role="tablist" aria-label="项目资源类型">
            <button type="button" role="tab" aria-selected={tab === 'assets'} data-active={tab === 'assets' || undefined} onClick={() => setTab('assets')}>素材</button>
            <button type="button" role="tab" aria-selected={tab === 'canvases'} data-active={tab === 'canvases' || undefined} onClick={() => setTab('canvases')}>画布</button>
          </div>

          <div className="drama-canvas-dock-body">
            {loading ? <div className="drama-canvas-dock-state"><Loader2 size={15} className="animate-spin" />加载中</div> : null}
            {error ? <div className="drama-canvas-dock-state is-error">{error}</div> : null}
            {!loading && !error && tab === 'assets' ? (
              assets.length ? (
                <div className="drama-canvas-dock-list">
                  {assets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      draggable
                      onClick={() => insertAsset(asset)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(DRAMACLAW_ASSET_DRAG_MIME, serializeDramaClawAssetDrag(asset))
                        event.dataTransfer.effectAllowed = 'copy'
                      }}
                      className="drama-canvas-dock-row"
                    >
                      <CanvasDockAssetPreview asset={asset} />
                      <span><strong>{asset.title}</strong><small>{asset.status} · {asset.role}</small></span>
                    </button>
                  ))}
                </div>
              ) : <div className="drama-canvas-dock-state">暂无项目素材</div>
            ) : null}
            {!loading && !error && tab === 'canvases' ? (
              canvases.length ? (
                <div className="drama-canvas-dock-list">
                  {canvases.map((canvas) => (
                    <Link key={canvas.id} href={`/drama/${dramaId}/canvas/${canvas.id}`} className="drama-canvas-dock-row">
                      <span className="drama-canvas-dock-thumb is-empty"><Network size={14} /></span>
                      <span><strong>{canvas.title}</strong><small>{canvas.profile || canvas.source} · {new Date(canvas.updated_at).toLocaleDateString('zh-CN')}</small></span>
                    </Link>
                  ))}
                </div>
              ) : <div className="drama-canvas-dock-state">暂无项目画布</div>
            ) : null}
          </div>
        </>
      ) : null}
    </aside>
  )
}

export function DramaCanvasEditorClient({
  dramaId,
  canvasId,
}: {
  dramaId: number
  canvasId: string
}) {
  const { loading, error, canvas } = useCanvas(canvasId)
  const searchParams = useSearchParams()
  const { data: workspace } = useDramaWorkspace(dramaId)
  const setChatOpen = usePipelineStore((s) => s.setChatOpen)
  const setRailOpen = usePipelineStore((s) => s.setRailOpen)
  const routeContext = useMemo(() => getDramaCanvasContext(searchParams), [searchParams])
  const sourceEpisodeId = routeContext.episodeId ?? numberFromData(canvas?.source_episode_id)
  const sourceEpisode = workspace?.episodes.find((episode) => episode.id === sourceEpisodeId)
  const returnContext = {
    ...routeContext,
    episodeId: sourceEpisodeId,
    episodeNumber: routeContext.episodeNumber ?? sourceEpisode?.episode_number,
    shot: routeContext.shot ?? numberFromData(canvas?.source_storyboard_id),
  }
  const workbenchHref = returnContext.episodeNumber
    ? getEpisodeWorkbenchHref(dramaId, returnContext.episodeNumber, returnContext.stage ?? 'assets', {
      shot: returnContext.shot,
      origin: 'canvas',
    })
    : null
  const backHref = workbenchHref ?? getDramaCanvasHref(dramaId, undefined, returnContext)

  useEffect(() => {
    setChatOpen(false)
    setRailOpen(false)
  }, [setChatOpen, setRailOpen])

  if (loading) {
    return (
      <div className="drama-workspace-state">
        <Loader2 size={22} className="animate-spin" />
        <span>正在加载画布</span>
      </div>
    )
  }

  if (error || !canvas) {
    throw error ?? new Error('画布不存在')
  }

  return (
    <div className="drama-canvas-editor-shell">
      <CanvasEditor
        runtime={{
          profile: 'drama',
          chrome: 'freezone',
          context: {
            dramaId,
            episodeId: returnContext.episodeId ?? undefined,
            storyboardId: returnContext.shot ?? undefined,
            commitTarget: 'asset_pool',
          },
          backHref,
          backLabel: workbenchHref ? '返回剧集工作台' : '返回画布',
          slots: {
            topbarExtra: (
              <Link href={`/drama/${dramaId}/assets`} className="drama-canvas-topbar-link">
                <Boxes size={14} />
                <span>素材</span>
              </Link>
            ),
            nodeActionsExtra: ({ nodeId, nodeType, nodeData, currentResult, close }) => (
              <SaveProjectAssetMenuItem
                dramaId={dramaId}
                canvasId={canvasId}
                nodeId={nodeId}
                nodeType={nodeType}
                nodeData={nodeData}
                currentResult={currentResult}
                close={close}
              />
            ),
          },
        }}
      />
      <DramaCanvasAssetDock dramaId={dramaId} />
    </div>
  )
}
