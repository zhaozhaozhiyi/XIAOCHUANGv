'use client'

import { useMemo } from 'react'
import {
  Loader2, Users, MapPin, Mic2, ImageIcon, Video,
  Clapperboard, Plus, Layers, Settings2,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { hasCompleteShotFrames, isVisualCharacter, useWorkbench } from '@/hooks/use-workbench'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { getStoryboardTtsDialogue } from '@/lib/dialogue'
import { staticUrl } from '@/lib/utils'
import type { Storyboard } from '@/types/api'

interface ProductionPanelProps {
  prodTab: string
  onOpenGrid?: (sb: Storyboard) => void
}

export function ProductionPanel({ prodTab, onOpenGrid }: ProductionPanelProps) {
  const wb = useWorkbench(useShallow((state) => ({
    characters: state.characters,
    scenes: state.scenes,
    storyboards: state.storyboards,
    running: state.running,
    runningType: state.runningType,
    pendingCharImages: state.pendingCharImages,
    pendingSceneImages: state.pendingSceneImages,
    pendingShotFrames: state.pendingShotFrames,
    pendingVideos: state.pendingVideos,
    pendingComposes: state.pendingComposes,
    lockedImageConfigLabel: state.lockedImageConfigLabel,
    lockedVideoConfigLabel: state.lockedVideoConfigLabel,
    lockedAudioConfigLabel: state.lockedAudioConfigLabel,
    openImageViewer: state.openImageViewer,
    goSubStep: state.goSubStep,
    batchCharImages: state.batchCharImages,
    genCharImg: state.genCharImg,
    batchSceneImages: state.batchSceneImages,
    genSceneImg: state.genSceneImg,
    batchShotTTS: state.batchShotTTS,
    genShotTTS: state.genShotTTS,
    genShotFrame: state.genShotFrame,
    batchShotVideos: state.batchShotVideos,
    genShotVideo: state.genShotVideo,
    batchCompose: state.batchCompose,
    composeShot: state.composeShot,
  })))
  const visualCharacters = useMemo(() => wb.characters.filter(isVisualCharacter), [wb.characters])
  const charImgCount = visualCharacters.filter(c => !!c.image_url).length
  const sceneImgCount = wb.scenes.filter(s => !!s.image_url).length
  const ttsEligibleCount = wb.storyboards.filter(s => !!getStoryboardTtsDialogue(s)).length
  const ttsGeneratedCount = wb.storyboards.filter(s => !!getStoryboardTtsDialogue(s) && !!s.tts_audio_url).length
  const shotImgCount = wb.storyboards.filter(hasCompleteShotFrames).length
  const shotVidCount = wb.storyboards.filter(s => !!s.video_url).length
  const composedCount = wb.storyboards.filter(s => !!s.composed_video_url).length
  const prodTabs = [
    { id: 'chars', label: '角色形象', icon: Users, badge: visualCharacters.length ? `${charImgCount}/${visualCharacters.length}` : '' },
    { id: 'scenes', label: '场景图片', icon: MapPin, badge: wb.scenes.length ? `${sceneImgCount}/${wb.scenes.length}` : '' },
    { id: 'dubbing', label: '配音生成', icon: Mic2, badge: ttsEligibleCount ? `${ttsGeneratedCount}/${ttsEligibleCount}` : '' },
    { id: 'shots', label: '镜头图片', icon: ImageIcon, badge: wb.storyboards.length ? `${shotImgCount}/${wb.storyboards.length}` : '' },
    { id: 'videos', label: '视频生成', icon: Video, badge: wb.storyboards.length ? `${shotVidCount}/${wb.storyboards.length}` : '' },
    { id: 'compose', label: '视频合成', icon: Layers, badge: wb.storyboards.length ? `${composedCount}/${wb.storyboards.length}` : '' },
  ]

  if (!wb.storyboards.length) {
    return (
      <div className="production-panel production-locked-panel">
        <div className="studio-locked-empty">
          <Clapperboard size={34} className="studio-locked-icon" />
          <div className="empty-title">尚未准备就绪</div>
          <div className="empty-desc">请先完成分镜拆解</div>
        </div>
        <FloatingWorkbenchAction label="前往分镜" onClick={() => wb.goSubStep('script-storyboard')} />
      </div>
    )
  }

  return (
    <div className="production-panel">
      <div className="production-toolbar">
        <div className="step-indicator">
          <Clapperboard size={14} />
          <span className="step-name">制作工作台</span>
        </div>
        <div className="prod-tabs">
          {prodTabs.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                className={cn('prod-tab', prodTab === tab.id && 'active')}
                onClick={() => useWorkbench.setState({ prodTab: tab.id })}
              >
                <Icon size={11} />
                {tab.label}
                {tab.badge && <span className="prod-tab-badge">{tab.badge}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="panel-scroll">
        {prodTab === 'chars' && <CharsTab />}
        {prodTab === 'scenes' && <ScenesTab />}
        {prodTab === 'dubbing' && <DubbingTab />}
        {prodTab === 'shots' && <ShotsTab onOpenGrid={onOpenGrid} />}
        {prodTab === 'videos' && <VideosTab />}
        {prodTab === 'compose' && <ComposeTab />}
      </div>
      <ProductionStepAction prodTab={prodTab} />
    </div>
  )
}

function FloatingWorkbenchAction({ label, onClick, disabled = false }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="step-bubble">
      <button className="bubble-btn primary" disabled={disabled} onClick={onClick}>
        {label}
      </button>
    </div>
  )
}

function ProductionStepAction({ prodTab }: { prodTab: string }) {
  const wb = useWorkbench()
  const nextMap: Record<string, { label: string; step: string }> = {
    chars: { label: '进入场景图', step: 'prod-scenes' },
    scenes: { label: '进入配音生成', step: 'prod-dubbing' },
    dubbing: { label: '进入镜头图片', step: 'prod-shots' },
    shots: { label: '进入视频生成', step: 'prod-videos' },
    videos: { label: '进入视频合成', step: 'prod-compose' },
    compose: { label: '合并成片', step: 'export-merge' },
  }
  const next = nextMap[prodTab]
  if (!next) return null
  return <FloatingWorkbenchAction label={next.label} onClick={() => wb.goSubStep(next.step)} />
}

function ConfigBadge({ label, value }: { label: string; value: string }) {
  const isDefault = !value || value === '未选择' || value === '默认配置' || value.startsWith('默认：')
  const displayValue = value.startsWith('默认：') ? value.slice(3) : value

  return (
    <span
      className={cn('locked-config', isDefault && 'is-default')}
      title={isDefault ? `${label}未固定，将使用当前默认配置：${displayValue || '默认配置'}` : `${label}：${value}`}
    >
      <Settings2 size={11} aria-hidden />
      <span className="locked-config-label">{label}</span>
      {isDefault && <span className="locked-config-default">默认</span>}
      <span className="locked-config-value">{displayValue || '默认配置'}</span>
    </span>
  )
}

// ——————————————————————————————————————————————
// Chars Tab
// ——————————————————————————————————————————————
function CharsTab() {
  const wb = useWorkbench()
  const visualCharacters = wb.characters.filter(isVisualCharacter)
  const isBatchGenerating = wb.running && wb.runningType === 'batch_char_images'

  const handleBatchGenerate = async () => {
    await wb.batchCharImages()
  }

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">{visualCharacters.length} 个需生成形象角色</span>
        <ConfigBadge label="图片配置" value={wb.lockedImageConfigLabel} />
        {wb.characters.length > visualCharacters.length && (
          <span className="tag">旁白仅保留声音</span>
        )}
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            disabled={visualCharacters.length === 0 || isBatchGenerating}
            onClick={handleBatchGenerate}
          >
            {isBatchGenerating ? <Loader2 size={10} className="animate-spin" /> : null}
            {isBatchGenerating ? '生成中...' : '批量生成'}
          </Button>
        </div>
      </div>

      {visualCharacters.length === 0 ? (
        <div className="step-empty">
          <Users size={32} className="mx-auto mb-2 opacity-50" />
          <div className="empty-title">暂无角色形象</div>
          <div className="empty-desc">暂无需生成形象的角色，请先提取角色</div>
        </div>
      ) : (
        <div className="asset-grid">
          {visualCharacters.map(c => (
            <div key={c.id} className="card asset-card">
              {(() => {
                const imageSrc = staticUrl(c.image_url)
                return (
              <div className="asset-cover relative">
                {c.image_url ? (
                  <img
                    src={imageSrc}
                    className="previewable-image"
                    onClick={() => wb.openImageViewer(imageSrc, `${c.name} 角色形象`)}
                    alt={c.name}
                  />
                ) : (
                  <div className="asset-cover-empty">
                    <Users size={24} />
                  </div>
                )}
                <span
                  className={cn(
                    'asset-cover-badge',
                    c.image_url
                      ? 'is-ready'
                      : wb.pendingCharImages.has(c.id)
                        ? 'is-pending'
                        : '',
                  )}
                >
                  {c.image_url ? '已生成' : wb.pendingCharImages.has(c.id) ? '生成中' : '待生成'}
                </span>
              </div>
                )
              })()}
              <div className="asset-body">
                <div className="asset-name">{c.name}</div>
                <div className="asset-meta">{c.role || '角色'}</div>
              </div>
              <div className="asset-foot">
                <span
                  className={cn(
                    'dot',
                    c.image_url && 'ok',
                    wb.pendingCharImages.has(c.id) && 'pending',
                  )}
                />
                <span className="asset-foot-status">
                  {c.image_url ? '已生成' : wb.pendingCharImages.has(c.id) ? '生成中' : '待生成'}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="panel-btn ml-auto"
                  disabled={wb.pendingCharImages.has(c.id)}
                  onClick={() => wb.genCharImg(c.id)}
                >
                  {wb.pendingCharImages.has(c.id) ? '生成中' : '生成'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ——————————————————————————————————————————————
// Scenes Tab
// ——————————————————————————————————————————————
function ScenesTab() {
  const wb = useWorkbench()
  const isBatchGenerating = wb.running && wb.runningType === 'batch_scene_images'

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">{wb.scenes.length} 个场景</span>
        <ConfigBadge label="图片配置" value={wb.lockedImageConfigLabel} />
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            disabled={wb.scenes.length === 0 || isBatchGenerating}
            onClick={() => wb.batchSceneImages()}
          >
            {isBatchGenerating ? <Loader2 size={10} className="animate-spin" /> : null}
            {isBatchGenerating ? '生成中...' : '批量生成'}
          </Button>
        </div>
      </div>

      {wb.scenes.length === 0 ? (
        <div className="step-empty">
          <MapPin size={32} className="mx-auto mb-2 opacity-50" />
          <div className="empty-title">暂无场景图片</div>
          <div className="empty-desc">暂无场景，请先提取场景</div>
        </div>
      ) : (
        <div className="asset-grid">
          {wb.scenes.map(s => (
            <div key={s.id} className="card asset-card">
              {(() => {
                const imageSrc = staticUrl(s.image_url)
                return (
              <div className="asset-cover wide relative">
                {s.image_url ? (
                  <img
                    src={imageSrc}
                    className="previewable-image"
                    onClick={() => wb.openImageViewer(imageSrc, `${s.location} 场景图`)}
                    alt={s.location || '场景'}
                  />
                ) : (
                  <div className="asset-cover-empty">
                    <MapPin size={24} />
                  </div>
                )}
                <span
                  className={cn(
                    'asset-cover-badge',
                    s.image_url
                      ? 'is-ready'
                      : wb.pendingSceneImages.has(s.id)
                        ? 'is-pending'
                        : '',
                  )}
                >
                  {s.image_url ? '已生成' : wb.pendingSceneImages.has(s.id) ? '生成中' : '待生成'}
                </span>
              </div>
                )
              })()}
              <div className="asset-body">
                <div className="asset-name">{s.location}</div>
                <div className="asset-meta">{s.time || '—'}</div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="w-full mt-2 panel-btn"
                  disabled={wb.pendingSceneImages.has(s.id)}
                  onClick={() => wb.genSceneImg(s.id)}
                >
                  {wb.pendingSceneImages.has(s.id) ? (
                    <><Loader2 size={10} className="animate-spin" /> 生成中...</>
                  ) : '生成场景图'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ——————————————————————————————————————————————
// Dubbing Tab
// ——————————————————————————————————————————————
function DubbingTab() {
  const wb = useWorkbench()
  const ttsEligible = wb.storyboards.filter(s => !!getStoryboardTtsDialogue(s))
  const isBatchGenerating = wb.running && wb.runningType === 'batch_tts'

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">{ttsEligible.length} 条对白可配音</span>
        <ConfigBadge label="配音配置" value={wb.lockedAudioConfigLabel} />
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            disabled={ttsEligible.length === 0 || isBatchGenerating}
            onClick={() => wb.batchShotTTS()}
          >
            {isBatchGenerating ? <Loader2 size={10} className="animate-spin" /> : null}
            {isBatchGenerating ? '生成中...' : '批量配音'}
          </Button>
        </div>
      </div>

      {ttsEligible.length === 0 ? (
        <div className="step-empty">
          <Mic2 size={32} className="mx-auto mb-2 opacity-50" />
          <div className="empty-title">当前没有可生成的配音</div>
          <div className="empty-desc">先在分镜里填写对白内容</div>
        </div>
      ) : (
        <div className="dub-grid">
          {ttsEligible.map(sb => {
            const dialogue = getStoryboardTtsDialogue(sb)
            return (
              <div key={sb.id} className="card dub-card">
                <div className="dub-head">
                  <span className="shot-num">
                    #{String(sb.storyboard_number).padStart(2, '0')}
                  </span>
                  <div className="dub-copy">
                    <div className="asset-meta">
                      {dialogue.split('：')[0] || '旁白'}
                    </div>
                    <div className="dub-desc">{dialogue}</div>
                  </div>
                  <div className="dub-meta">
                    <span
                      className={cn(
                        'asset-cover-badge',
                        sb.tts_audio_url ? 'is-ready' : '',
                      )}
                    >
                      {sb.tts_audio_url ? '已生成' : '待生成'}
                    </span>
                  </div>
                </div>
                <div className="dub-foot">
                  {sb.tts_audio_url ? (
                    <audio
                      src={staticUrl(sb.tts_audio_url)}
                      controls
                      className="dub-audio"
                      preload="none"
                    />
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="panel-btn"
                      onClick={() => wb.genShotTTS(sb)}
                    >
                      生成配音
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ——————————————————————————————————————————————
// Shots Tab
// ——————————————————————————————————————————————
function ShotsTab({ onOpenGrid }: { onOpenGrid?: (sb: Storyboard) => void }) {
  const wb = useWorkbench()
  const shotImgCount = wb.storyboards.filter(hasCompleteShotFrames).length

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">{shotImgCount}/{wb.storyboards.length} 镜头帧图完成</span>
        <ConfigBadge label="图片配置" value={wb.lockedImageConfigLabel} />
      </div>

      <div className="prod-grid">
        {wb.storyboards.map((sb, i) => {
          const pendingFrame = wb.pendingShotFrames.get(sb.id)
          const firstFrame = sb.first_frame_image || sb.composed_image
          const lastFrame = sb.last_frame_image || sb.composed_image
          const firstFrameSrc = staticUrl(firstFrame)
          const lastFrameSrc = staticUrl(lastFrame)
          return (
            <div key={sb.id} className="card prod-card">
              <div className="prod-cover shot-cover-grid">
                {/* First frame */}
                <div className="shot-cover-pane">
                  {firstFrame ? (
                    <img
                      src={firstFrameSrc}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => wb.openImageViewer(firstFrameSrc, `镜头 #${i + 1} 首帧`)}
                      alt="首帧"
                    />
                  ) : (
                    <button
                      className="shot-generate-btn"
                      onClick={() => wb.genShotFrame(sb, 'first_frame')}
                      disabled={!!pendingFrame}
                    >
                      {pendingFrame === 'first_frame' ? (
                        <Loader2 size={14} className="animate-spin text-accent" />
                      ) : (
                        <Plus size={14} className="text-text-3" />
                      )}
                    </button>
                  )}
                  <span className="shot-pane-label">
                    首帧
                  </span>
                </div>
                {/* Last frame */}
                <div className="shot-cover-pane">
                  {lastFrame ? (
                    <img
                      src={lastFrameSrc}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => wb.openImageViewer(lastFrameSrc, `镜头 #${i + 1} 尾帧`)}
                      alt="尾帧"
                    />
                  ) : (
                    <button
                      className="shot-generate-btn"
                      onClick={() => wb.genShotFrame(sb, 'last_frame')}
                      disabled={!!pendingFrame}
                    >
                      {pendingFrame === 'last_frame' ? (
                        <Loader2 size={14} className="animate-spin text-accent" />
                      ) : (
                        <Plus size={14} className="text-text-3" />
                      )}
                    </button>
                  )}
                  <span className="shot-pane-label">
                    尾帧
                  </span>
                </div>
              </div>
              <div className="prod-info">
                <div className="min-w-0">
                  <div className="prod-meta-line">
                    #{String(i + 1).padStart(2, '0')}
                  </div>
                  <div className="prod-desc truncate">{sb.description || '—'}</div>
                </div>
              </div>
              <div className="prod-actions">
                {onOpenGrid && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="panel-btn"
                    onClick={() => onOpenGrid(sb)}
                  >
                    宫格工具
                  </Button>
                )}
                {/* Status badges */}
                {(sb.composed_image || sb.first_frame_image) && (
                  <span className="asset-cover-badge is-ready">首帧 ✓</span>
                )}
                {(sb.composed_image || sb.last_frame_image) && (
                  <span className="asset-cover-badge is-ready">尾帧 ✓</span>
                )}
                {!sb.composed_image && !sb.first_frame_image && !sb.last_frame_image && (
                  <span className="asset-cover-badge">待生成</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ——————————————————————————————————————————————
// Videos Tab
// ——————————————————————————————————————————————
function VideosTab() {
  const wb = useWorkbench()
  const generatedCount = wb.storyboards.filter(s => !!s.video_url).length
  const isBatchGenerating = wb.running && wb.runningType === 'batch_videos'

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">{generatedCount}/{wb.storyboards.length} 镜头视频完成</span>
        <ConfigBadge label="视频配置" value={wb.lockedVideoConfigLabel} />
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            disabled={wb.storyboards.length === 0 || generatedCount === wb.storyboards.length || isBatchGenerating}
            onClick={() => wb.batchShotVideos()}
          >
            {isBatchGenerating ? <Loader2 size={10} className="animate-spin" /> : null}
            {isBatchGenerating ? '生成中...' : '批量生成'}
          </Button>
        </div>
      </div>

      <div className="prod-grid">
        {wb.storyboards.map((sb, i) => {
          const videoSrc = staticUrl(sb.video_url)
          const posterSrc = staticUrl(sb.first_frame_image || sb.composed_image || sb.last_frame_image)
          const isServerPending = sb.status === 'video_queued' || sb.status === 'video_processing'
          const isFailed = sb.status === 'video_failed'
          const isPending = wb.pendingVideos.has(sb.id) || isServerPending
          return (
            <div key={sb.id} className="card prod-card">
              <div className="prod-cover flex items-center justify-center">
                {videoSrc ? (
                  <video
                    src={videoSrc}
                    poster={posterSrc || undefined}
                    className="prod-video"
                    preload="metadata"
                    controls
                    playsInline
                  />
                ) : (
                  <Video size={24} className="text-text-3" />
                )}
                <span
                  className={cn(
                    'absolute top-2 right-2 text-xs px-2 py-0.5 rounded-full',
                    'asset-cover-badge',
                    videoSrc
                      ? 'is-ready'
                      : isPending
                        ? 'is-pending'
                        : '',
                  )}
                >
                  {videoSrc ? '已生成' : isPending ? '生成中' : isFailed ? '生成失败' : '待生成'}
                </span>
              </div>
              <div className="prod-actions">
                <span className="prod-meta-line">#{String(i + 1).padStart(2, '0')}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="panel-btn"
                  disabled={isPending}
                  onClick={() => wb.genShotVideo(sb)}
                >
                  {isPending ? (
                    <Loader2 size={10} className="animate-spin" />
                  ) : videoSrc ? '重新生成' : '生成'}
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ——————————————————————————————————————————————
// Compose Tab
// ——————————————————————————————————————————————
function ComposeTab() {
  const wb = useWorkbench()
  const composedCount = wb.storyboards.filter(s => s.composed_video_url).length
  const isBatchComposing = wb.running && wb.runningType === 'compose_all'

  const handleBatchCompose = async () => {
    await wb.batchCompose()
  }

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">
          {composedCount}/{wb.storyboards.length} 已合成
        </span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            onClick={handleBatchCompose}
            disabled={isBatchComposing}
          >
            {isBatchComposing ? <Loader2 size={11} className="animate-spin" /> : <Clapperboard size={11} />}
            {isBatchComposing ? '合成中...' : '批量合成'}
          </Button>
        </div>
      </div>

      <div className="prod-grid">
        {wb.storyboards.map((sb, i) => {
          const hasComposedVideo = !!sb.composed_video_url
          const isLocalPending = wb.pendingComposes.has(sb.id)
          const isServerPending = !hasComposedVideo
            && (sb.status === 'compose_queued' || sb.status === 'compose_processing')
          const isPending = isLocalPending || isServerPending
          return (
            <div key={sb.id} className="card prod-card">
              <div className="prod-info">
              <div className="flex items-center justify-between mb-2">
                <span className="prod-meta-line">
                  #{String(i + 1).padStart(2, '0')}
                </span>
                <span
                  className={cn(
                    'asset-cover-badge',
                    hasComposedVideo ? 'is-ready' : isPending ? 'is-pending' : '',
                  )}
                >
                  {hasComposedVideo ? '已合成' : isPending ? '合成中' : '待合成'}
                </span>
              </div>
              <div className="prod-desc line-clamp-2">{sb.description || '—'}</div>
              </div>
              {hasComposedVideo ? (
                <>
                  <video
                    src={staticUrl(sb.composed_video_url)}
                    poster={staticUrl(sb.first_frame_image || sb.composed_image || sb.last_frame_image) || undefined}
                    className="prod-video"
                    controls
                    playsInline
                    preload="none"
                  />
                  <Button
                    size="xs"
                    className="panel-btn prod-card-action"
                    disabled={isPending}
                    onClick={() => wb.composeShot(sb)}
                  >
                    {isPending ? (
                      <>
                        <Loader2 size={10} className="animate-spin" /> 合成中
                      </>
                    ) : (
                      <>
                        <Clapperboard size={10} /> 重新合成
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <Button
                  size="xs"
                  className="panel-btn panel-btn-primary prod-card-action"
                  disabled={isPending || !sb.video_url}
                  onClick={() => wb.composeShot(sb)}
                >
                  {isPending ? (
                    <>
                      <Loader2 size={10} className="animate-spin" /> 合成中
                    </>
                  ) : (
                    <>
                      <Clapperboard size={10} /> 合成
                    </>
                  )}
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
