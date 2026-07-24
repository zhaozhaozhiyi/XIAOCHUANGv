'use client'

import Link from 'next/link'
import { useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { AlertCircle, ArrowRight, Film, ImagePlus, Loader2, Sparkles } from 'lucide-react'

import { imageAPI, type DramaWorkspacePayload } from '@/lib/api'
import { getAiErrorCopy } from '@/lib/ai-error-copy'
import { staticUrl } from '@/lib/utils'
import { EmptyState } from '@/components/shared/empty-state'
import { buildCoverPrompt, sleep } from '../legacy/ai-first-workbench-parts'
import { useDramaWorkspace } from '../use-drama-workspace'
import { useDramaReviewSummary } from '../use-drama-review-summary'

type ProjectFocus = {
  title: string
  description: string
  href: string
}

function cssImageUrl(url: string) {
  return `url(${JSON.stringify(url)})`
}

function resolveProjectFocus(data: DramaWorkspacePayload, dramaId: number): ProjectFocus {
  const { counts, production } = data
  const storyGraphGap = production.gaps.find(
    (gap) => gap.key === 'story_graph_missing' || gap.key === 'story_graph_stale',
  )

  if (counts.episodes === 0) {
    return {
      title: '从源稿开始',
      description: '先建立改编方向和分集蓝图，项目的第一集会由这里展开。',
      href: `/drama/${dramaId}/episodes?stage=source`,
    }
  }

  if (counts.scripted_episodes < counts.episodes) {
    return {
      title: '补齐剧本正文',
      description: `还有 ${counts.episodes - counts.scripted_episodes} 集等待成稿，完成后才能稳定推进镜头制作。`,
      href: `/drama/${dramaId}/episodes?stage=script`,
    }
  }

  if (storyGraphGap?.count) {
    const stale = storyGraphGap.key === 'story_graph_stale'
    return {
      title: stale ? '重建故事地图' : '构建故事地图',
      description: stale
        ? '剧本已更新，先同步故事地图，避免分镜继续使用过期人物、关系和场景信息。'
        : '剧本已经就绪，先确认故事地图，再进入分镜会更稳。',
      href: `/drama/${dramaId}/episodes?stage=graph`,
    }
  }

  if (counts.storyboard_episodes < counts.episodes) {
    return {
      title: '确认分镜',
      description: `还有 ${counts.episodes - counts.storyboard_episodes} 集需要分镜，确认后会进入单集镜头流程。`,
      href: `/drama/${dramaId}/episodes?stage=storyboard`,
    }
  }

  if (production.first_frame_done < production.first_frame_total) {
    return {
      title: '生成镜头首帧',
      description: `还有 ${production.first_frame_total - production.first_frame_done} 个镜头缺少首帧。`,
      href: `/drama/${dramaId}/episodes`,
    }
  }

  if (production.tts_done < production.tts_total) {
    return {
      title: '完成配音',
      description: `还有 ${production.tts_total - production.tts_done} 个镜头缺少配音。`,
      href: `/drama/${dramaId}/episodes`,
    }
  }

  if (production.video_done < production.video_total) {
    return {
      title: '生成镜头视频',
      description: `还有 ${production.video_total - production.video_done} 个镜头等待生成。`,
      href: `/drama/${dramaId}/episodes`,
    }
  }

  return {
    title: '进入成片检查',
    description: '镜头制作已经齐备，可以逐集检查合成结果并准备交付。',
    href: `/drama/${dramaId}/final`,
  }
}

function episodeStatusLabel(episode: DramaWorkspacePayload['episodes'][number]) {
  if (episode.review_status === 'storyboard_review_required') return '需复核'
  if (!episode.has_script) return '等待剧本'
  if (episode.storyboard_count === 0) return '继续分镜'
  if (episode.missing_first_frame_count > 0) return '继续制作'
  return '查看制作'
}

export function DramaWorkspaceOverview({ dramaId }: { dramaId: number }) {
  const { data, loading, error, refresh } = useDramaWorkspace(dramaId)
  const review = useDramaReviewSummary(dramaId)
  const [coverGenerating, setCoverGenerating] = useState(false)

  if (loading && !data) {
    return (
      <div className="drama-workspace-state" role="status">
        <Loader2 size={22} className="animate-spin" />
        <span>正在加载项目总览</span>
      </div>
    )
  }

  if (error && !data) {
    return (
        <div className="drama-workspace-state" role="alert">
          <AlertCircle size={22} />
          <span>暂时无法加载项目总览</span>
        <button type="button" onClick={() => void refresh()}>重试</button>
      </div>
    )
  }

  if (!data) return null

  const project = data.project
  const focus = resolveProjectFocus(data, dramaId)
  const primary = review.data?.review.needs_attention ? review.data.primary_action : focus
  const pendingReviewItems = review.data?.review.items.filter((item) => item.review_status !== 'confirmed') ?? []
  const coverUrl = staticUrl(project.thumbnail)
  const heroStyle = coverUrl
    ? ({ '--drama-overview-cover': cssImageUrl(coverUrl) } as CSSProperties)
    : undefined

  async function generateCover() {
    if (coverGenerating) return

    try {
      setCoverGenerating(true)
      const generation = await imageAPI.generate({
        drama_id: project.id,
        prompt: buildCoverPrompt(project),
        size: '1920x1080',
        frame_type: 'drama_cover',
      })
      toast.success('已开始生成封面')

      for (let attempt = 0; attempt < 90; attempt += 1) {
        await sleep(2_000)
        const latest = await imageAPI.get(generation.id)
        if (latest.status === 'completed' && latest.image_url) {
          await refresh()
          toast.success('封面已生成')
          return
        }
        if (latest.status === 'failed') {
          throw new Error(latest.error_msg || '封面生成失败')
        }
      }

      toast.warning('封面仍在生成中，稍后刷新页面查看')
    } catch (err) {
      toast.error('封面生成失败', { description: getAiErrorCopy(err) })
    } finally {
      setCoverGenerating(false)
    }
  }

  return (
    <div className="drama-overview-focus">
      <section className={coverUrl ? 'drama-overview-hero has-cover' : 'drama-overview-hero'} style={heroStyle}>
        <div className="drama-overview-hero-copy">
          <span className="drama-overview-eyebrow"><Sparkles size={14} /> 当前重点</span>
          <h2>{primary.title}</h2>
          <p>{primary.description}</p>
        </div>

        {!coverUrl ? (
          <button
            type="button"
            className="drama-overview-cover-action"
            aria-label={coverGenerating ? '封面生成中' : '生成封面'}
            title={coverGenerating ? '封面生成中' : '生成封面'}
            disabled={coverGenerating}
            onClick={() => { void generateCover() }}
          >
            {coverGenerating ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
            <span>{coverGenerating ? '生成中' : '生成封面'}</span>
          </button>
        ) : null}
        <Link href={primary.href} className="drama-overview-primary-action drama-overview-hero-primary">
          <strong>{primary.title}</strong>
          <ArrowRight size={17} />
        </Link>
      </section>

      {pendingReviewItems.length ? (
        <section className="drama-review-summary" aria-label="待确认摘要">
          <div>
            <h3>还有 {pendingReviewItems.length} 项待确认</h3>
            <p>
              先完成上方主动作；其余确认项已收起，避免在总览页重复打断。
            </p>
          </div>
          <Link href={pendingReviewItems[0].href}>
            查看待确认
            <ArrowRight size={14} />
          </Link>
        </section>
      ) : null}

      <section className="drama-overview-episodes">
        <div className="drama-overview-section-head">
          <div>
            <h3>剧集</h3>
          </div>
          {data.episodes.length ? (
            <Link href={`/drama/${dramaId}/episodes`}>查看全部 <ArrowRight size={14} /></Link>
          ) : null}
        </div>

        <div className="drama-overview-episode-list">
          {data.episodes.length ? data.episodes.slice(0, 5).map((episode) => (
            <Link key={episode.id} href={episode.href} className="drama-overview-episode-row">
              <Film size={16} />
              <span>
                <strong>第 {episode.episode_number} 集</strong>
                <small>{episode.title || '未命名剧集'}</small>
              </span>
              <b>{episodeStatusLabel(episode)}</b>
              <ArrowRight size={15} />
            </Link>
          )) : (
            <EmptyState
              icon={Film}
              title="暂未创建剧集"
              description="导入并理解源稿后，系统会在这里生成分集蓝图和首集正文。"
              className="drama-overview-episodes-empty"
              action={(
                <Link href={`/drama/${dramaId}/episodes?stage=source`} className="drama-overview-empty-action">
                  导入源稿
                  <ArrowRight size={15} />
                </Link>
              )}
            />
          )}
        </div>
      </section>
    </div>
  )
}
