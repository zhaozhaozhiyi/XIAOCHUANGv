'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'
import { getEpisodeStaleLabel } from '../legacy/ai-first-workbench-parts'
import { useDramaWorkspace } from '../use-drama-workspace'
import {
  getEpisodeWorkbenchHref,
  getProjectStageHref,
  parseProjectStage,
  PROJECT_STAGE_LABELS,
  PROJECT_STAGES,
  resolveRecommendedProjectStage,
  type EpisodeStep,
  type ProjectStageProgressState,
  type ProjectStage,
} from './episode-route'
import { DramaEpisodesStagePanel } from './DramaEpisodesStagePanel'
import { useDramaAiFirstController } from './use-drama-ai-first-controller'

function episodeReadyStep(hasScript: boolean, storyboardCount: number): EpisodeStep {
  if (!hasScript) return 'script-raw'
  if (storyboardCount === 0) return 'script-storyboard'
  return 'prod-shots'
}

function episodeListStatus(episode: { has_script: boolean; storyboard_count: number; review_status: string | null }) {
  if (episode.review_status === 'storyboard_review_required') return '需复核'
  if (!episode.has_script) return '等待剧本'
  if (episode.storyboard_count === 0) return '继续分镜'
  return '进入制作'
}

export function DramaEpisodesWorkspacePage({ dramaId }: { dramaId: number }) {
  const { data, loading, error, refresh } = useDramaWorkspace(dramaId)
  const aiFirst = useDramaAiFirstController(dramaId, { onWorkspaceRefresh: refresh })
  const router = useRouter()
  const searchParams = useSearchParams()
  const [stageRecovery, setStageRecovery] = useState<{
    stage: ProjectStage
    message: string
  } | null>(null)
  const rawRequestedStage = searchParams.get('stage')
  const requestedStage = parseProjectStage(rawRequestedStage)
  const blueprintCount = aiFirst.blueprintEpisodes.length
  const planNeedsDecision = aiFirst.targetSettingsDirty && blueprintCount > 0
  const targetEpisodeTotal = aiFirst.planTargetEpisodes
  const scopedWorkspaceEpisodes = (data?.episodes || []).filter(
    (episode) => episode.episode_number <= targetEpisodeTotal,
  )
  const episodeTotal = scopedWorkspaceEpisodes.length
  const storyboardReviewEpisodeIds = new Set(
    aiFirst.plannedEpisodes
      .filter((episode) =>
        Boolean(getEpisodeStaleLabel(episode))
        || episode.review_status === 'storyboard_review_required',
      )
      .map((episode) => episode.id),
  )
  const storyboardEpisodeTotal = scopedWorkspaceEpisodes.filter((episode) =>
    episode.storyboard_count > 0
    && episode.review_status !== 'storyboard_review_required'
    && !storyboardReviewEpisodeIds.has(episode.id),
  ).length
  const hasEpisodes = episodeTotal > 0
  const blueprintsDone = !planNeedsDecision && blueprintCount >= targetEpisodeTotal
  const currentScriptedTotal = aiFirst.currentScriptReadyEpisodes.length
  const scriptsDone = currentScriptedTotal >= targetEpisodeTotal
  const storyboardsDone = hasEpisodes && storyboardEpisodeTotal >= targetEpisodeTotal
  const graphReady = aiFirst.storyGraphUsable
  const requiresGuidance = !aiFirst.hasUsableNovelSource
    || !aiFirst.sourceAnalysisReady
    || planNeedsDecision
    || !blueprintsDone
    || !scriptsDone
    || !graphReady
    || !storyboardsDone

  const resolvedRecommendedStage = resolveRecommendedProjectStage({
    hasUsableSource: aiFirst.hasUsableNovelSource,
    hasSourceAnalysis: aiFirst.sourceAnalysisReady,
    plannedEpisodes: blueprintCount,
    targetEpisodes: targetEpisodeTotal,
    currentScriptedEpisodes: currentScriptedTotal,
    graphReady,
    storyboardEpisodes: storyboardEpisodeTotal,
  })
  const recommendedStage = planNeedsDecision ? 'plan' : resolvedRecommendedStage
  const stageUnlocked: Record<ProjectStage, boolean> = {
    source: true,
    plan: aiFirst.sourceAnalysisReady,
    script: blueprintsDone,
    graph: scriptsDone,
    storyboard: graphReady,
  }
  const currentStage = requestedStage && stageUnlocked[requestedStage] ? requestedStage : recommendedStage
  const stageParamNeedsNormalization = Boolean(rawRequestedStage && rawRequestedStage !== currentStage)
  const stageAccessBlocked = Boolean(rawRequestedStage && requestedStage !== currentStage)
  const stagesResolved = Boolean(data) && !loading && !aiFirst.loading && !aiFirst.storyGraphSummaryLoading
  const getStageProgressState = (stage: ProjectStage): ProjectStageProgressState => {
    if (stage === currentStage) return 'active'
    if (!stageUnlocked[stage]) return 'waiting'
    return 'done'
  }
  const showStagePanel = requiresGuidance || currentStage === 'storyboard' || searchParams.has('stage')
  const stageRecoveryReason = currentStage === 'source'
    ? aiFirst.hasUsableNovelSource
      ? '源稿理解尚未完成，已回到源稿理解步骤。'
      : '尚未导入可用源稿，已回到源稿理解步骤。'
    : currentStage === 'plan'
      ? '目标集数的分集蓝图尚未全部就绪，已回到分集规划步骤。'
      : currentStage === 'script'
        ? '目标集数的剧本正文尚未全部完成，已回到剧本正文步骤。'
        : '正式故事地图尚未就绪，已回到故事地图步骤。'

  useEffect(() => {
    if (!stagesResolved) return
    if (stageParamNeedsNormalization) {
      queueMicrotask(() => {
        setStageRecovery(
          stageAccessBlocked
            ? { stage: currentStage, message: stageRecoveryReason }
            : null,
        )
      })
      const nextParams = new URLSearchParams(searchParams.toString())
      nextParams.set('stage', currentStage)
      router.replace(`/drama/${dramaId}/episodes?${nextParams.toString()}`, { scroll: false })
      return
    }
    queueMicrotask(() => {
      setStageRecovery((current) =>
        !current || rawRequestedStage !== current.stage
          ? null
          : current.stage === 'source'
            ? !aiFirst.hasUsableNovelSource || !aiFirst.sourceAnalysisReady
              ? current
              : null
            : current.stage === 'plan'
              ? planNeedsDecision || !blueprintsDone
                ? current
                : null
              : current.stage === 'script'
                ? !scriptsDone
                  ? current
                  : null
                : !graphReady
                  ? current
                  : null,
      )
    })
  }, [
    aiFirst.hasUsableNovelSource,
    aiFirst.sourceAnalysisReady,
    blueprintsDone,
    currentStage,
    dramaId,
    graphReady,
    planNeedsDecision,
    rawRequestedStage,
    router,
    searchParams,
    stageAccessBlocked,
    stageParamNeedsNormalization,
    stageRecoveryReason,
    stagesResolved,
    scriptsDone,
  ])

  return (
    <div className="drama-episodes-page">
      <nav className="drama-episodes-stepper" aria-label="制作步骤">
        {PROJECT_STAGES.map((stage, index) => {
          const state = getStageProgressState(stage)
          const unlocked = stageUnlocked[stage]
          const content = (
            <>
              <span className="drama-episodes-stepper-dot" data-state={state}>
                {state === 'done' ? <Check size={12} strokeWidth={2.5} /> : index + 1}
              </span>
              <span className="drama-episodes-stepper-label">{PROJECT_STAGE_LABELS[stage]}</span>
            </>
          )

          if (!unlocked) {
            return (
              <div
                key={stage}
                className="drama-episodes-stepper-item"
                data-state={state}
                aria-disabled="true"
              >
                {content}
              </div>
            )
          }

          return (
            <Link
              key={stage}
              href={getProjectStageHref(dramaId, stage)}
              className="drama-episodes-stepper-item"
              data-state={state}
              data-active={stage === currentStage || undefined}
              aria-current={stage === currentStage ? 'step' : undefined}
            >
              {content}
            </Link>
          )
        })}
      </nav>

      {loading && !data ? (
        <div className="drama-workspace-state">
          <Loader2 size={22} className="animate-spin" />
          <span>正在加载剧集</span>
        </div>
      ) : null}

      {error && !data ? (
        <div className="drama-workspace-state">
          <span>暂时无法加载剧集</span>
          <button type="button" onClick={() => refresh()}>重试</button>
        </div>
      ) : null}

      {data ? (
        <>
          {stageRecovery ? (
            <div className="drama-stage-notice is-warning" role="status">
              <AlertTriangle size={16} />
              <div>
                <strong>当前步骤尚未解锁</strong>
                <p>{stageRecovery.message}</p>
              </div>
            </div>
          ) : null}

          {showStagePanel ? (
            <section className="drama-episodes-split is-wizard-only">
              <div className="drama-episodes-wizard-surface">
                <DramaEpisodesStagePanel
                  controller={aiFirst}
                  dramaId={dramaId}
                  stage={currentStage}
                  workspaceEpisodes={data.episodes}
                  scriptedEpisodeCount={currentScriptedTotal}
                />
              </div>
            </section>
          ) : (
            <section className="drama-episodes-ready-list">
              <div className="drama-overview-section-head">
                <h3>剧集</h3>
              </div>
              <div className="drama-episodes-ready-rows">
                {data.episodes.map((episode) => (
                  <Link
                    key={episode.id}
                    href={getEpisodeWorkbenchHref(dramaId, episode.episode_number, episodeReadyStep(episode.has_script, episode.storyboard_count))}
                    className="drama-episodes-ready-row"
                  >
                    <span className="drama-episodes-ready-number">第 {episode.episode_number} 集</span>
                    <span className="drama-episodes-ready-copy">
                      <strong>{episode.title || '未命名剧集'}</strong>
                      <small>{episodeListStatus(episode)}</small>
                    </span>
                    <span className={cn('drama-episodes-ready-state', episode.storyboard_count > 0 && 'is-ready')}>
                      {episode.storyboard_count > 0 ? '进入制作' : '继续分镜'}
                    </span>
                  </Link>
                ))}
              </div>
            </section>
          )}
        </>
      ) : null}
    </div>
  )
}
