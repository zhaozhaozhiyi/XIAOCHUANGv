'use client'

import Link from 'next/link'
import { useState } from 'react'
import { toast } from 'sonner'
import { AlertCircle, ArrowRight, Clapperboard, Film, Loader2 } from 'lucide-react'

import { getEpisodeWorkbenchHref, type EpisodeStage } from '../episodes/episode-route'
import { dramaWorkspaceAPI, taskAPI, type DramaWorkspacePayload } from '@/lib/api'
import { useDramaWorkspace } from '../use-drama-workspace'
import { useDramaReviewSummary } from '../use-drama-review-summary'

type Episode = DramaWorkspacePayload['episodes'][number]
type ProductionGap = DramaWorkspacePayload['production']['gaps'][number]
type WorkspaceTask = DramaWorkspacePayload['recent_tasks'][number]

function gapStage(key: string): EpisodeStage | null {
  const normalized = key.toLowerCase()
  if (normalized.includes('script')) return 'script'
  if (normalized.includes('storyboard')) return 'storyboard'
  if (normalized.includes('frame')) return 'assets'
  if (normalized.includes('tts') || normalized.includes('audio') || normalized.includes('video')) return 'video'
  return null
}

function findGapEpisode(gap: ProductionGap, episodes: Episode[]) {
  const key = gap.key.toLowerCase()
  if (key.includes('script')) return episodes.find((episode) => !episode.has_script) ?? null
  if (key.includes('storyboard')) return episodes.find((episode) => episode.storyboard_count === 0) ?? null
  if (key.includes('frame')) return episodes.find((episode) => episode.missing_first_frame_count > 0) ?? null
  if (key.includes('tts') || key.includes('audio') || key.includes('video')) {
    return episodes.find((episode) => episode.storyboard_count > 0) ?? null
  }
  return null
}

function gapHref(dramaId: number, gap: ProductionGap, episodes: Episode[]) {
  const stage = gapStage(gap.key)
  const episode = stage ? findGapEpisode(gap, episodes) : null
  if (stage && episode) {
    return getEpisodeWorkbenchHref(dramaId, episode.episode_number, stage, { origin: 'final-gap' })
  }
  return gap.href
}

function isCompositionTask(task: WorkspaceTask) {
  const signature = `${task.type} ${task.title ?? ''} ${task.source_type}`.toLowerCase()
  return /compose|merge|export|render/.test(signature) && (task.status === 'queued' || task.status === 'running')
}

function taskHref(dramaId: number, task: WorkspaceTask, episodes: Episode[]) {
  const episode = episodes.find((item) => item.id === task.episode_id)
  return episode
    ? getEpisodeWorkbenchHref(dramaId, episode.episode_number, 'final', { task: task.id, origin: 'final' })
    : `/drama/${dramaId}/tasks?task=${task.id}`
}

function episodeDeliveryStatus(episode: Episode, reviewItems: NonNullable<ReturnType<typeof useDramaReviewSummary>['data']>['review']['items']) {
  const finalReview = reviewItems.find((item) => item.subject_type === 'episode_final' && item.episode_id === episode.id)
  if (finalReview?.review_status === 'confirmed') return '可交付'
  if (finalReview) return finalReview.review_status === 'rework_required' || finalReview.review_status === 'stale' ? '需处理' : '待确认'
  if (!episode.has_script || episode.storyboard_count === 0 || episode.missing_first_frame_count > 0) return '待处理'
  return '待合成'
}

export function DramaFinalPage({ dramaId }: { dramaId: number }) {
  const { data, loading, error, refresh } = useDramaWorkspace(dramaId)
  const review = useDramaReviewSummary(dramaId)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [cancellingTaskId, setCancellingTaskId] = useState<number | null>(null)

  if (loading && !data) {
    return (
      <div className="drama-workspace-state" role="status">
        <Loader2 size={22} className="animate-spin" />
        <span>正在检查成片</span>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="drama-workspace-state" role="alert">
        <AlertCircle size={22} />
        <span>暂时无法加载成片</span>
        <button type="button" onClick={() => void refresh()}>重试</button>
      </div>
    )
  }

  if (!data) return null

  const productionGaps = data.production.gaps.filter((gap) => gap.count > 0)
  const reviewItems = review.data?.review.items ?? []
  const reviewGaps = reviewItems.filter((item) => item.review_status !== 'confirmed')
  const compositionTask = data.recent_tasks.find(isCompositionTask) ?? null
  const productionReady = data.production.video_total > 0
    && data.production.video_done >= data.production.video_total
    && productionGaps.length === 0
  const ready = productionReady && Boolean(review.data?.review.deliverable)

  const primary = compositionTask
    ? {
      title: '正在合成',
      actionTitle: '查看合成进度',
      description: `当前进度 ${compositionTask.progress ?? 0}% 。本期只支持逐集查看，合成完成后再确认交付版本。`,
      href: taskHref(dramaId, compositionTask, data.episodes),
    }
    : ready
      ? {
        title: '可以交付',
        actionTitle: '查看可交付成片',
        description: '当前可审核版本已确认，可以逐集查看并交付。',
        href: getEpisodeWorkbenchHref(dramaId, data.episodes[0]?.episode_number ?? 1, 'final', { origin: 'final' }),
      }
      : productionGaps.length
        ? {
          title: '先补齐制作缺口',
          actionTitle: '处理第一个制作缺口',
          description: '分镜、首帧、配音或视频缺失时，先补制作；完成后再确认交付版本。',
          href: gapHref(dramaId, productionGaps[0], data.episodes),
        }
        : reviewGaps.length
        ? {
          title: '先确认交付版本',
          actionTitle: review.data?.primary_action.title ?? '查看待确认版本',
          description: '制作已就绪，请确认当前版本；内容更新后会再次进入待确认。',
          href: review.data?.primary_action.href ?? reviewGaps[0].href,
        }
          : {
            title: '先完成一个可审核版本',
            actionTitle: '进入剧本',
            description: '剧本、分镜或单集成片完成后，会在这里进入交付确认。',
            href: `/drama/${dramaId}/episodes?stage=script`,
          }

  async function confirmCheckpoint(item: (typeof reviewItems)[number]) {
    const id = `${item.subject_type}:${item.subject_id}`
    try {
      setConfirmingId(id)
      await dramaWorkspaceAPI.confirmReviewCheckpoint(dramaId, {
        subject_type: item.subject_type,
        subject_id: item.subject_id,
        version_key: item.version_key,
      })
      toast.success(`${item.label}已确认`)
      await review.refresh()
    } catch (err) {
      toast.error('确认失败', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setConfirmingId(null)
    }
  }

  async function cancelComposition() {
    if (!compositionTask) return
    try {
      setCancellingTaskId(compositionTask.id)
      await taskAPI.cancel(compositionTask.id)
      toast.success('已请求取消合成')
      await refresh()
    } catch (err) {
      toast.error('取消合成失败', { description: err instanceof Error ? err.message : String(err) })
    } finally {
      setCancellingTaskId(null)
    }
  }

  return (
    <div className="drama-final-page">
      <section className="drama-final-hero" data-ready={ready || undefined}>
        <div>
          <span><Clapperboard size={15} /> 成片</span>
          <h2>{primary.title}</h2>
          <p>{primary.description}</p>
        </div>
        <div className="drama-final-hero-action">
          <Link href={primary.href} className="drama-overview-primary-action">
            <strong>{primary.actionTitle}</strong>
            <ArrowRight size={17} />
          </Link>
          {compositionTask ? (
            <button
              type="button"
              className="drama-final-secondary-action"
              disabled={cancellingTaskId === compositionTask.id}
              onClick={() => void cancelComposition()}
            >
              {cancellingTaskId === compositionTask.id ? '正在取消' : '取消合成'}
            </button>
          ) : null}
        </div>
      </section>

      {productionGaps.length ? (
        <section className="drama-final-checklist">
          <div className="drama-overview-section-head">
            <div>
              <h3>先处理制作缺口</h3>
              <span>这些是交付前置条件；补齐后再做版本确认</span>
            </div>
          </div>
          <div className="drama-final-checklist-list">
            {productionGaps.slice(0, 4).map((gap) => (
              <Link key={gap.key} href={gapHref(dramaId, gap, data.episodes)} className="drama-final-check-row">
                <AlertCircle size={16} />
                <span>{gap.label}</span>
                <b>{gap.count}</b>
                <ArrowRight size={15} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {productionGaps.length && reviewGaps.length ? (
        <section className="drama-review-summary is-muted" aria-label="版本确认稍后开放">
          <div>
            <h3>版本确认稍后开放</h3>
            <p>当前还有制作缺口。先补齐分镜、素材、配音和视频后，再确认交付版本。</p>
          </div>
        </section>
      ) : null}

      {!productionGaps.length && reviewGaps.length ? (
        <section className="drama-review-list">
          <div className="drama-overview-section-head">
            <div>
              <h3>版本确认</h3>
              <span>制作缺口清空后，再确认当前可交付版本</span>
            </div>
          </div>
          {reviewGaps.slice(0, 4).map((item) => {
            const id = `${item.subject_type}:${item.subject_id}`
            const requiresWork = item.review_status === 'rework_required' || item.review_status === 'stale'
            return (
              <div key={id} className="drama-review-row">
                <Link href={item.href}>{item.label}</Link>
                {requiresWork ? <Link href={item.href}>处理</Link> : (
                  <button type="button" onClick={() => void confirmCheckpoint(item)} disabled={confirmingId === id}>
                    {confirmingId === id ? '确认中' : '确认'}
                  </button>
                )}
              </div>
            )
          })}
        </section>
      ) : null}

      <section className="drama-final-episodes">
        <div className="drama-overview-section-head">
          <div>
            <h3>单集成片</h3>
            <span>逐集查看与交付</span>
          </div>
        </div>
        <div className="drama-final-episode-list">
          {data.episodes.length ? data.episodes.map((episode) => (
            <Link
              key={episode.id}
              href={getEpisodeWorkbenchHref(dramaId, episode.episode_number, 'final', { origin: 'final' })}
              className="drama-final-episode-row"
            >
              <Film size={16} />
              <span><strong>{episode.title || `第 ${episode.episode_number} 集`}</strong></span>
              <b data-ready={episodeDeliveryStatus(episode, reviewItems) === '可交付' || undefined}>
                {episodeDeliveryStatus(episode, reviewItems)}
              </b>
              <ArrowRight size={15} />
            </Link>
          )) : (
            <Link href={`/drama/${dramaId}/episodes?stage=source`} className="drama-final-episode-row is-empty">
              <Film size={16} />
              <span><strong>还没有剧集</strong></span>
              <ArrowRight size={15} />
            </Link>
          )}
        </div>
      </section>
    </div>
  )
}
