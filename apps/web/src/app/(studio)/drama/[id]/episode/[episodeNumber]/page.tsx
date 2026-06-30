'use client'

import { useEffect, useMemo, useCallback, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { useShallow } from 'zustand/react/shallow'
import { Loader2, ArrowLeft, RefreshCw, Check, Play } from 'lucide-react'
import { hasCompleteShotFrames, isVisualCharacter, useWorkbench, SIDEBAR_SECTIONS } from '@/hooks/use-workbench'
import { useGridTool } from '@/hooks/use-grid-tool'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ImageViewer } from '@/components/shared/image-viewer'
import { ScriptPanel } from '@/components/episode/script/script-panel'
import { ProductionPanel } from '@/components/episode/production/production-panel'
import { ExportPanel } from '@/components/episode/export/export-panel'
import { GridToolDialog } from '@/components/episode/production/grid-tool-dialog'
import { cn } from '@/lib/cn'
import { getStoryboardTtsDialogue } from '@/lib/dialogue'
import type { Storyboard } from '@/types/api'
import './episode-shell.css'
import './episode-panels.css'

const STEP_LABELS: Record<string, string> = {
  'script-raw': '原始内容', 'script-rewrite': 'AI 改写',
  'script-extract': '提取角色场景', 'script-voice': '分配音色',
  'script-storyboard': '分镜列表',
  'prod-chars': '角色形象', 'prod-scenes': '场景图',
  'prod-dubbing': '配音', 'prod-shots': '镜头图',
  'prod-videos': '视频', 'prod-compose': '合成',
  'export-merge': '合并成片',
}

const STORYBOARD_STAGE_NAV = [
  { key: 'script-storyboard', label: '分镜拆解', section: 'script' },
  { key: 'prod-dubbing', label: '配音生成', section: 'production' },
  { key: 'prod-shots', label: '镜头图片', section: 'production' },
  { key: 'prod-videos', label: '视频生成', section: 'production' },
  { key: 'prod-compose', label: '视频合成', section: 'production' },
] as const

export default function WorkbenchPage() {
  const router = useRouter()
  const params = useParams()
  const dramaId = Number(params.id)
  const episodeNumber = Number(params.episodeNumber)

  const wb = useWorkbench(useShallow((state) => ({
    drama: state.drama,
    episode: state.episode,
    characters: state.characters,
    scenes: state.scenes,
    storyboards: state.storyboards,
    panel: state.panel,
    scriptStep: state.scriptStep,
    prodTab: state.prodTab,
    viewerOpen: state.viewerOpen,
    viewerSrc: state.viewerSrc,
    viewerTitle: state.viewerTitle,
    pendingDeleteStoryboard: state.pendingDeleteStoryboard,
    mergeUrl: state.mergeUrl,
    reset: state.reset,
    loadAll: state.loadAll,
    goSubStep: state.goSubStep,
    closeImageViewer: state.closeImageViewer,
    cancelDeleteShot: state.cancelDeleteShot,
    confirmDeleteShot: state.confirmDeleteShot,
    pipelineProgress: state.pipelineProgress,
    charsVoiced: state.charsVoiced,
  })))
  const gt = useGridTool()
  const resetWorkbench = wb.reset
  const loadWorkbench = wb.loadAll
  const workbenchDrama = wb.drama
  const setGridStorageKey = gt.setStorageKey
  const loadGridHistory = gt.loadHistory
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    // Reset state when navigating to a new episode
    resetWorkbench()
    loadWorkbench(dramaId, episodeNumber)
    // Set localStorage key for grid tool
    setGridStorageKey(`xiaochuang:grid:${dramaId}:${episodeNumber}`)
  }, [dramaId, episodeNumber, loadWorkbench, refreshKey, resetWorkbench, setGridStorageKey])

  // Load grid history after drama is loaded
  useEffect(() => {
    if (workbenchDrama) {
      loadGridHistory(dramaId)
    }
  }, [dramaId, loadGridHistory, workbenchDrama])

  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  const pipelineProgress = wb.pipelineProgress()
  const showTopbarContinueAction = Boolean(wb.mergeUrl || wb.storyboards.length > 0)
  const activeStep = useMemo(() => {
    if (wb.panel === 'script') {
      const stepMap = ['script-raw', 'script-rewrite', 'script-extract', 'script-voice', 'script-storyboard']
      return stepMap[wb.scriptStep] || 'script-raw'
    }
    if (wb.panel === 'production') {
      const tabMap: Record<string, string> = {
        chars: 'prod-chars',
        scenes: 'prod-scenes',
        dubbing: 'prod-dubbing',
        shots: 'prod-shots',
        videos: 'prod-videos',
        compose: 'prod-compose',
      }
      return tabMap[wb.prodTab] || 'prod-chars'
    }
    return 'export-merge'
  }, [wb.panel, wb.scriptStep, wb.prodTab])
  const subStepLabel = STEP_LABELS[activeStep] || ''
  const visualCharacters = useMemo(() => wb.characters.filter(isVisualCharacter), [wb.characters])
  const sidebarJumpSteps = useMemo(() => {
    const section = SIDEBAR_SECTIONS.find((item) => item.items.some((step) => step.key === activeStep))
    return section?.items || []
  }, [activeStep])
  const stageSubnavSteps = useMemo(() => {
    const allSteps = SIDEBAR_SECTIONS.flatMap((section) => section.items)
    const pick = (keys: string[]) =>
      keys
        .map((key) => allSteps.find((step) => step.key === key))
        .filter((step): step is (typeof allSteps)[number] => !!step)

    if (activeStep === 'script-raw' || activeStep === 'script-rewrite') {
      return sidebarJumpSteps.slice(0, 2)
    }
    if (activeStep === 'script-extract' || activeStep === 'script-voice') {
      return pick(['script-extract', 'script-voice', 'prod-chars', 'prod-scenes'])
    }
    if (
      activeStep === 'script-storyboard' ||
      activeStep === 'prod-dubbing' ||
      activeStep === 'prod-shots' ||
      activeStep === 'prod-videos' ||
      activeStep === 'prod-compose'
    ) {
      return STORYBOARD_STAGE_NAV
    }
    return sidebarJumpSteps
  }, [activeStep, sidebarJumpSteps])

  const goContinue = useCallback(() => {
    if (wb.mergeUrl) {
      wb.goSubStep('export-merge')
      return
    }
    if (wb.storyboards.length > 0) {
      const ttsEligible = wb.storyboards.filter(s => !!getStoryboardTtsDialogue(s))
      if (visualCharacters.some(c => !c.image_url)) wb.goSubStep('prod-chars')
      else if (wb.scenes.some(s => !s.image_url)) wb.goSubStep('prod-scenes')
      else if (ttsEligible.some(s => !s.tts_audio_url)) wb.goSubStep('prod-dubbing')
      else if (wb.storyboards.some(s => !hasCompleteShotFrames(s))) wb.goSubStep('prod-shots')
      else if (wb.storyboards.some(s => !s.video_url)) wb.goSubStep('prod-videos')
      else if (wb.storyboards.some(s => !s.composed_video_url)) wb.goSubStep('prod-compose')
      else wb.goSubStep('export-merge')
      return
    }
    wb.goSubStep('script-raw')
  }, [wb, visualCharacters])

  const isDone = (key: string) => {
    if (key === 'script-raw') return !!(wb.episode?.content)
    if (key === 'script-rewrite') return !!(wb.episode?.script_content)
    if (key === 'script-extract') return wb.characters.length > 0
    if (key === 'script-voice') return wb.characters.length > 0 && wb.charsVoiced() === wb.characters.length
    if (key === 'script-storyboard') return wb.storyboards.length > 0
    if (key === 'prod-chars') return wb.characters.length > 0 && (visualCharacters.length === 0 || visualCharacters.every(c => !!c.image_url))
    if (key === 'prod-scenes') return wb.storyboards.length > 0 && (wb.scenes.length === 0 || wb.scenes.every(s => !!s.image_url))
    if (key === 'prod-dubbing') {
      const eligible = wb.storyboards.filter(s => !!getStoryboardTtsDialogue(s))
      return wb.storyboards.length > 0 && (eligible.length === 0 || eligible.every(s => !!s.tts_audio_url))
    }
    if (key === 'prod-shots') return wb.storyboards.length > 0 && wb.storyboards.every(hasCompleteShotFrames)
    if (key === 'prod-videos') return wb.storyboards.length > 0 && wb.storyboards.every(s => !!s.video_url)
    if (key === 'prod-compose') return wb.storyboards.length > 0 && wb.storyboards.every(s => !!s.composed_video_url)
    if (key === 'export-merge') return !!wb.mergeUrl
    return false
  }

  const handleOpenGrid = (sb: Storyboard) => {
    gt.openFresh(wb.storyboards.map(s => s.id), dramaId, wb.episode?.id || 0)
    // Pre-select the target storyboard
    gt.setSingleTarget(sb.id)
  }

  if (!wb.drama) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    )
  }

  return (
    <div className="studio">
      {/* ===== Topbar ===== */}
      <header className="studio-topbar">
        <div className="studio-topbar-main">
        <Link
          className="back-btn topbar-back"
          href={`/drama/${dramaId}`}
        >
          <ArrowLeft size={15} /> 返回项目
        </Link>

        <div className="studio-identity">
          <h1 className="studio-title">{wb.drama.title}</h1>
          <span className="studio-episode-chip">第 {episodeNumber} 集</span>
          <div className="studio-meta-row">
            <span className="studio-meta-pill is-stage">{subStepLabel}</span>
            <span className="studio-meta-pill is-progress">{pipelineProgress}/11</span>
            <span className="studio-meta-inline">{wb.characters.length} 角色 · {wb.storyboards.length} 镜头</span>
          </div>
        </div>
        </div>

        <div className="studio-topbar-side">
          <div className="studio-actions">
            <button className="refresh-btn" onClick={refresh}>
              <RefreshCw size={12} /> 刷新
            </button>
            {showTopbarContinueAction ? (
              <button className="refresh-btn studio-btn-primary" onClick={goContinue}>
                <Play size={13} fill="currentColor" strokeWidth={2.4} />
                {wb.mergeUrl ? '查看成片' : '继续制作'}
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <div className="studio-body">
        {/* ===== Sidebar ===== */}
        <aside className="sidebar">
          <nav className="pipeline">
            {SIDEBAR_SECTIONS.map(section => (
              <div key={section.id} className="pipe-section">
                <div className="pipe-section-label">{section.label}</div>
                {section.items.map(item => (
                  <button
                    key={item.key}
                    className={cn(
                      'pipe-item pipe-item-sub',
                      activeStep === item.key && 'active',
                      isDone(item.key) && 'done',
                    )}
                    aria-label={item.label}
                    onClick={() => wb.goSubStep(item.key)}
                  >
                    <span className={cn(
                      'pipe-icon',
                      isDone(item.key) && 'icon-done',
                      !isDone(item.key) && activeStep === item.key && 'icon-active',
                    )} aria-hidden="true">
                      {isDone(item.key) ? <Check size={11} /> : item.label[0]}
                    </span>
                    <span className="pipe-copy">
                      <span className="pipe-label">{item.label}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          {/* Bottom: Progress */}
          <div className="sidebar-bottom">
            <div className="progress-wrap">
              <div className="progress-head">
                <span className="progress-label">制作进度</span>
                <span className="progress-val">{pipelineProgress}/11</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(pipelineProgress / 11) * 100}%` }} />
              </div>
            </div>
            {sidebarJumpSteps.length > 0 && (
              <div className="sidebar-jumper">
                {sidebarJumpSteps.map(step => (
                  <button
                    key={step.key}
                    className={cn('sidebar-jump-dot', activeStep === step.key && 'active', isDone(step.key) && 'done')}
                    onClick={() => wb.goSubStep(step.key)}
                    title={step.label}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* ===== Main Content ===== */}
        <main className="main">
          {stageSubnavSteps.length > 0 && (
            <div className="stage-subnav">
              {stageSubnavSteps.map(sub => (
                <button
                  key={sub.key}
                  className={cn('stage-subnav-item', activeStep === sub.key && 'active')}
                  onClick={() => wb.goSubStep(sub.key)}
                >
                  <span>{sub.label}</span>
                  {isDone(sub.key) && <span className="stage-subnav-dot" />}
                </button>
              ))}
            </div>
          )}
          {/* Panel Content */}
          <div className="content-wrap">
            <div className={cn(
              'content-card',
              (activeStep === 'script-raw' || activeStep === 'script-rewrite') && 'content-card-document',
            )}>
              {wb.panel === 'script' && (
                <ScriptPanel activeStep={activeStep} onRefresh={refresh} />
              )}
              {wb.panel === 'production' && (
                <ProductionPanel
                  prodTab={wb.prodTab}
                  onOpenGrid={handleOpenGrid}
                />
              )}
              {wb.panel === 'export' && <ExportPanel />}
            </div>
          </div>
        </main>
      </div>

      {/* Image Viewer */}
      {wb.viewerOpen && (
        <ImageViewer open={wb.viewerOpen} src={wb.viewerSrc} title={wb.viewerTitle} onClose={wb.closeImageViewer} />
      )}

      {/* Grid Tool Dialog */}
      {wb.episode && (
        <GridToolDialog
          storyboards={wb.storyboards}
          dramaId={dramaId}
          episodeId={wb.episode.id}
          onDone={refresh}
        />
      )}

      <ConfirmDialog
        open={Boolean(wb.pendingDeleteStoryboard)}
        onOpenChange={(open) => {
          if (!open) wb.cancelDeleteShot()
        }}
        title="删除分镜"
        description="确定删除此分镜？此操作不可恢复。"
        confirmLabel="删除"
        onConfirm={() => wb.confirmDeleteShot()}
      />
    </div>
  )
}
