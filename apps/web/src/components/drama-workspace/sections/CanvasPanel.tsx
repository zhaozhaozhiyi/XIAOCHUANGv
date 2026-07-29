'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Clapperboard, Loader2, Network, ArrowUpRight } from 'lucide-react'

import { BaseSelect } from '@/components/shared/base-select'
import { Button } from '@/components/ui/button'
import { dramaWorkspaceAPI, type DramaWorkspacePayload } from '@/lib/api'
import {
  getDramaCanvasContext,
  getDramaCanvasHref,
} from '../canvas/canvas-route'

export function CanvasPanel({ dramaId, data }: { dramaId: number; data: DramaWorkspacePayload }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [creatingCanvas, setCreatingCanvas] = useState(false)
  const routeContext = useMemo(() => getDramaCanvasContext(searchParams), [searchParams])
  const sourceEpisode = data.episodes.find((episode) => episode.id === routeContext.episodeId)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<number | null>(routeContext.episodeId ?? data.episodes[0]?.id ?? null)
  const [actionError, setActionError] = useState<string | null>(null)
  const selectedEpisode = data.episodes.find((episode) => episode.id === selectedEpisodeId)
  const effectiveContext = {
    ...routeContext,
    episodeId: selectedEpisode?.id ?? routeContext.episodeId,
    episodeNumber: selectedEpisode?.episode_number ?? sourceEpisode?.episode_number ?? routeContext.episodeNumber,
  }
  const sortedCanvases = useMemo(() => [...data.canvases].sort((left, right) => (
    new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
  )), [data.canvases])

  const createBlank = async () => {
    setCreatingCanvas(true)
    setActionError(null)
    try {
      const canvas = await dramaWorkspaceAPI.createCanvas(dramaId, {
        title: `${data.project.title || '短剧项目'} · 项目画布`,
        scope: 'project',
        mode: 'blank',
      })
      router.push(getDramaCanvasHref(dramaId, canvas.id))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreatingCanvas(false)
    }
  }

  const createFromEpisode = async () => {
    if (!selectedEpisodeId) return
    setCreatingCanvas(true)
    setActionError(null)
    try {
      const result = await dramaWorkspaceAPI.createCanvasFromEpisode(dramaId, {
        episode_id: selectedEpisodeId,
        sync_mode: 'append_missing',
        include: ['characters', 'scenes', 'storyboards'],
        layout: 'columns',
      })
      router.push(getDramaCanvasHref(dramaId, result.canvas.id, effectiveContext))
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreatingCanvas(false)
    }
  }

  return (
    <section className="drama-canvas-page">
      <div className="drama-canvas-empty-copy">
        <span><Network size={15} /> 画布</span>
        <h2>{sourceEpisode ? `第 ${sourceEpisode.episode_number} 集画布` : '项目画布'}</h2>
        <p>{sourceEpisode ? '从当前剧集或镜头开始创作，完成后可准确回到原位置。' : '把角色、场景和镜头放到同一处，再回填为项目素材。'}</p>
      </div>

      <div className="drama-canvas-empty-actions">
        {data.episodes.length ? (
          <div className="drama-canvas-from-episode">
            <BaseSelect
              className="drama-canvas-episode-select [&_button]:h-10 [&_button]:rounded-[var(--radius-xs)]"
              value={selectedEpisodeId ? String(selectedEpisodeId) : ''}
              onValueChange={(value) => setSelectedEpisodeId(Number(value))}
              options={data.episodes.map((episode) => ({
                label: `第 ${episode.episode_number} 集 · ${episode.title}`,
                value: String(episode.id),
              }))}
            />
            <Button type="button" onClick={() => void createFromEpisode()} disabled={!selectedEpisodeId || creatingCanvas}>
              {creatingCanvas ? <Loader2 size={15} className="animate-spin" /> : <Clapperboard size={15} />}
              {selectedEpisode ? `使用第 ${selectedEpisode.episode_number} 集创建画布` : '使用剧集创建画布'}
            </Button>
          </div>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="drama-canvas-create-blank"
          onClick={() => void createBlank()}
          disabled={creatingCanvas}
        >
          {creatingCanvas ? <Loader2 size={16} className="animate-spin" /> : <Network size={16} />}
          创建无剧情空白画布
        </Button>
      </div>

      {actionError ? <div className="drama-inline-error" role="alert">{actionError}</div> : null}

      {sortedCanvases.length ? (
        <div className="drama-canvas-list" aria-label="已有画布">
          <div className="drama-canvas-list-heading"><span>已有画布</span><small>{sortedCanvases.length} 个</small></div>
          {sortedCanvases.map((canvas) => (
            <Link
              key={canvas.id}
              href={getDramaCanvasHref(dramaId, canvas.id, effectiveContext)}
              className="drama-canvas-list-row"
            >
              <Network size={16} />
              <span><strong>{canvas.title}</strong><small>{canvas.source_episode_id ? '剧集画布' : '空白画布'} · {new Date(canvas.updated_at).toLocaleDateString('zh-CN')}</small></span>
              <ArrowUpRight size={15} />
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  )
}
