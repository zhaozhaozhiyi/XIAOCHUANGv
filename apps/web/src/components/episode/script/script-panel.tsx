'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Loader2, Users, MapPin, Mic2, FileText, Plus, Trash2,
} from 'lucide-react'
import { useWorkbench } from '@/hooks/use-workbench'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { storyboardAPI } from '@/lib/api'
import { staticUrl } from '@/lib/utils'
import type { Character, Episode, Scene, Storyboard } from '@/types/api'

const SHOT_TYPES = ['全景', '远景', '中景', '近景', '特写', '航拍', '俯拍']
const SHOT_ANGLES = ['平视', '仰视', '俯视', '侧面', '背面', '主观视角']
const SHOT_MOVEMENTS = ['固定', '推镜', '拉镜', '摇镜', '跟拍', '环绕', '升降']

function formatEpisodeDocumentTitle(episode: Episode | null) {
  const episodeNumber = episode?.episode_number ? `第 ${episode.episode_number} 集` : '当前分集'
  const episodeTitle = episode?.title?.trim() || '未命名分集'
  return /^第\s*[\d一二三四五六七八九十百千]+\s*[集章][：:]/.test(episodeTitle)
    ? episodeTitle
    : `${episodeNumber}：${episodeTitle}`
}

function sceneSummary(scene: Scene) {
  const prompt = scene.prompt?.trim()
  if (prompt && /[\u4e00-\u9fff]/.test(prompt)) return prompt

  const parts = [
    scene.location ? `地点：${scene.location}` : '',
    scene.time ? `时间：${scene.time}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : '等待补充场景描述'
}

interface ScriptPanelProps {
  activeStep: string
  onRefresh?: () => void
}

export function ScriptPanel({ activeStep, onRefresh }: ScriptPanelProps) {
  const step = activeStep.replace('script-', '')

  return (
    <div className="script-panel">
      {step === 'raw' && <RawStep />}
      {step === 'rewrite' && <RewriteStep />}
      {step === 'extract' && <ExtractStep />}
      {step === 'voice' && <VoiceStep />}
      {step === 'storyboard' && <StoryboardStep onRefresh={onRefresh} />}
    </div>
  )
}

const SCRIPT_FLOW = [
  { key: 'script-raw', label: '原始内容' },
  { key: 'script-rewrite', label: 'AI 改写' },
  { key: 'script-extract', label: '提取角色场景' },
  { key: 'script-voice', label: '分配音色' },
  { key: 'script-storyboard', label: '分镜列表' },
] as const

interface ScriptStepBubbleProps {
  currentKey: (typeof SCRIPT_FLOW)[number]['key']
  disabled?: boolean
  onPrimaryClick?: () => void
  primaryLabel?: string
}

function ScriptStepBubble({ currentKey, disabled = false, onPrimaryClick, primaryLabel }: ScriptStepBubbleProps) {
  const wb = useWorkbench()
  const currentIndex = SCRIPT_FLOW.findIndex(step => step.key === currentKey)
  const canNext = currentIndex < SCRIPT_FLOW.length - 1

  const isDone = (key: string) => {
    if (key === 'script-raw') return !!wb.localRaw.trim()
    if (key === 'script-rewrite') return !!wb.localScript.trim()
    if (key === 'script-extract') return wb.characters.length > 0 || wb.scenes.length > 0
    if (key === 'script-voice') return wb.characters.length > 0 && wb.charsVoiced() === wb.characters.length
    if (key === 'script-storyboard') return wb.storyboards.length > 0
    return false
  }

  const goNext = () => {
    if (canNext) {
      wb.goSubStep(SCRIPT_FLOW[currentIndex + 1].key)
      return
    }
    wb.goSubStep('prod-chars')
  }

  const defaultPrimaryLabel = currentKey === 'script-raw'
    ? 'AI转剧本'
    : canNext
      ? SCRIPT_FLOW[currentIndex + 1].label
      : '进入制作'
  const label = primaryLabel || defaultPrimaryLabel

  return (
    <div className="step-bubble">
      <div className="bubble-dots">
        {SCRIPT_FLOW.map((step, index) => (
          <button
            key={step.key}
            className={cn(
              'bubble-dot',
              index === currentIndex && 'current',
              isDone(step.key) && 'done',
            )}
            onClick={() => wb.goSubStep(step.key)}
            title={step.label}
          />
        ))}
      </div>
      <button className="bubble-btn primary" disabled={disabled} onClick={onPrimaryClick || goNext}>
        {label}
      </button>
    </div>
  )
}

// ——————————————————————————————————————————————
// Step 01: Raw
// ——————————————————————————————————————————————
function RawStep() {
  const wb = useWorkbench()
  const { episode, localRaw, saveRaw, setLocalRaw } = wb
  const rawTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const rawLen = localRaw.length
  const [autosaveFailed, setAutosaveFailed] = useState(false)
  const savedRaw = episode?.content || ''
  const documentTitle = formatEpisodeDocumentTitle(episode)
  const isAutosaveDirty = Boolean(episode?.id) && localRaw !== savedRaw
  const autosaveState = autosaveFailed
    ? 'error'
    : isAutosaveDirty
      ? 'saving'
      : 'saved'
  const autosaveText = autosaveState === 'saving'
    ? '自动保存中'
    : autosaveState === 'error'
      ? '自动保存失败'
      : '已自动保存'

  useEffect(() => {
    if (!episode?.id || localRaw === savedRaw) return

    let cancelled = false
    const timer = window.setTimeout(() => {
      saveRaw({ silent: true })
        .then(() => {
          if (!cancelled) setAutosaveFailed(false)
        })
        .catch(() => {
          if (!cancelled) setAutosaveFailed(true)
        })
    }, 800)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [episode?.id, localRaw, savedRaw, saveRaw])

  useEffect(() => {
    const textarea = rawTextareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [localRaw])

  return (
    <div className="script-step raw-script-step document-script-step">
      <div className="step-toolbar">
        <div className="toolbar-left">
          <div className="step-indicator">
            <span className="step-num">01</span>
            <span className="step-name">原始内容</span>
          </div>
          {rawLen > 0 && <span className="char-count">{rawLen.toLocaleString()} 字</span>}
        </div>
        <div className="toolbar-right">
          {rawLen > 0 && <span className={cn('autosave-status', autosaveState === 'error' && 'is-error')}>{autosaveText}</span>}
        </div>
      </div>
      <div className="step-editor document-editor raw-editor">
        <div className="script-document raw-document">
          <header className="script-document-header raw-document-header">
            <h2 className="script-document-title raw-document-title">{documentTitle}</h2>
          </header>
          <textarea
            ref={rawTextareaRef}
            className="fill-textarea document-textarea raw-textarea"
            value={localRaw}
            onChange={e => setLocalRaw(e.target.value)}
            placeholder="粘贴小说原文、故事大纲或分镜描述..."
          />
        </div>
      </div>
      <ScriptStepBubble currentKey="script-raw" />
    </div>
  )
}

// ——————————————————————————————————————————————
// Step 02: Rewrite
// ——————————————————————————————————————————————
function RewriteStep() {
  const wb = useWorkbench()
  const rewriteTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const scriptLen = wb.localScript.length
  const isLoading = wb.running && wb.runningType === 'script_rewriter'
  const hasSavedRaw = !!wb.localRaw.trim()
  const documentTitle = formatEpisodeDocumentTitle(wb.episode)
  const streamStatus = isLoading
    ? scriptLen > 0
      ? `正在流式生成 · 已生成 ${scriptLen.toLocaleString()} 字`
      : wb.runningNote || '正在连接 AI，等待第一段剧本内容'
    : scriptLen > 0
      ? `已生成 ${scriptLen.toLocaleString()} 字`
      : ''

  useEffect(() => {
    const textarea = rewriteTextareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [wb.localScript])

  if (!hasSavedRaw) {
    return (
      <div className="script-step locked-script-step">
        <div className="studio-locked-empty">
          <FileText size={34} className="studio-locked-icon" />
          <div className="empty-title">尚未准备就绪</div>
          <div className="empty-desc">请先填写原始内容</div>
        </div>
        <ScriptStepBubble
          currentKey="script-rewrite"
          primaryLabel="前往原始内容"
          onPrimaryClick={() => wb.goSubStep('script-raw')}
        />
      </div>
    )
  }

  return (
    <div className="script-step rewrite-script-step document-script-step">
      <div className="step-toolbar">
        <div className="toolbar-left">
          <div className="step-indicator">
            <span className="step-num">02</span>
            <span className="step-name">AI 改写</span>
          </div>
          {scriptLen > 0 && <span className="char-count">{scriptLen.toLocaleString()} 字</span>}
        </div>
        <div className="toolbar-right">
          {hasSavedRaw && (
            <Button variant="ghost" size="sm" className="panel-btn" disabled={wb.running} onClick={wb.skipRewrite}>
              跳过改写
            </Button>
          )}
        </div>
      </div>
      <div className={cn('step-editor', (isLoading || wb.localScript) && 'document-editor rewrite-editor')}>
        {!isLoading && !wb.localScript ? (
          <div className="step-empty">
            <div className="empty-title">AI 转剧本</div>
            <div className="empty-desc">你可以先用 AI 把原始内容整理成格式化剧本，也可以跳过这一步直接继续。</div>
          </div>
        ) : (
          <div className="script-document rewrite-document">
            <header className="script-document-header rewrite-document-header">
              <h2 className="script-document-title rewrite-document-title">{documentTitle}</h2>
              {streamStatus ? (
                <div className="document-status" role="status" aria-live="polite">
                  {isLoading ? <Loader2 size={13} className="animate-spin" /> : null}
                  <span>{streamStatus}</span>
                </div>
              ) : null}
            </header>
            <textarea
              ref={rewriteTextareaRef}
              className="fill-textarea document-textarea rewrite-textarea"
              value={wb.localScript}
              onChange={e => wb.setLocalScript(e.target.value)}
              placeholder={isLoading ? '等待 AI 写入剧本...' : '格式化剧本内容...'}
            />
          </div>
        )}
      </div>
      <ScriptStepBubble
        currentKey="script-rewrite"
        disabled={wb.running}
        primaryLabel={isLoading ? 'AI转剧本中' : wb.localScript ? '提取角色场景' : 'AI转剧本'}
        onPrimaryClick={wb.localScript ? () => wb.goSubStep('script-extract') : wb.doRewrite}
      />
    </div>
  )
}

// ——————————————————————————————————————————————
// Step 03: Extract
// ——————————————————————————————————————————————
function ExtractStep() {
  const wb = useWorkbench()
  const isLoading = wb.running && wb.runningType === 'extractor'
  const hasExtracted = wb.characters.length > 0 || wb.scenes.length > 0
  const hasSavedScript = !!wb.episode?.script_content?.trim()

  if (!hasSavedScript) {
    return (
      <div className="script-step locked-script-step">
        <div className="studio-locked-empty">
          <Users size={34} className="studio-locked-icon" />
          <div className="empty-title">尚未准备就绪</div>
          <div className="empty-desc">请先完成 AI 转剧本，或跳过改写使用原始内容</div>
        </div>
        <ScriptStepBubble
          currentKey="script-extract"
          primaryLabel="前往 AI 转剧本"
          onPrimaryClick={() => wb.goSubStep('script-rewrite')}
        />
      </div>
    )
  }

  return (
    <div className="script-step">
      <div className="step-toolbar">
        <div className="toolbar-left">
          <div className="step-indicator">
            <span className="step-num">03</span>
            <span className="step-name">提取角色与场景</span>
          </div>
          {(wb.characters.length > 0 || wb.scenes.length > 0) && (
            <span className="char-count">
              {wb.characters.length} 角色 · {wb.scenes.length} 场景
            </span>
          )}
        </div>
        <div className="toolbar-right" />
      </div>
      <div className="step-editor">
        {isLoading ? (
          <div className="step-loading">
            <Loader2 size={28} className="animate-spin text-accent" />
            <div className="loading-text">{wb.runningNote || '正在提取角色和场景...'}</div>
          </div>
        ) : !hasExtracted ? (
          <div className="step-empty">
            <div className="empty-title">从剧本提取角色与场景</div>
            <div className="empty-desc">
              AI 自动分析剧本，提取角色信息和场景列表
            </div>
          </div>
        ) : (
          <div className="extract-stage">
            <aside className="card extract-summary">
              <div className="extract-summary-kicker">提取结果</div>
              <div className="extract-summary-title">角色与场景结果</div>
              <div className="extract-summary-desc">从剧本里提取出的角色和场景已经入库。这里先确认命名和描述是否可直接进入后续制作。</div>
              <div className="extract-summary-stats">
                <div className="extract-summary-stat">
                  <span>角色</span>
                  <strong>{wb.characters.length}</strong>
                </div>
                <div className="extract-summary-stat">
                  <span>场景</span>
                  <strong>{wb.scenes.length}</strong>
                </div>
              </div>
            </aside>

            <div className="card extract-card">
              <div className="extract-card-head">
                <Users size={14} />
                <span>角色</span>
                <span className="tag tag-accent">{wb.characters.length}</span>
              </div>
              <div className="extract-list">
                {wb.characters.map(c => (
                  <div key={c.id} className="extract-row">
                    <div className="char-avatar">{c.name?.[0] || '?'}</div>
                    <div className="extract-info">
                      <div className="extract-name-row">
                        <div className="extract-name">{c.name}</div>
                        <span className="tag">{c.role || '角色'}</span>
                      </div>
                      <div className="extract-meta wrap">{c.description || c.appearance || c.personality || '暂无描述'}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="card extract-card">
              <div className="extract-card-head">
                <MapPin size={14} />
                <span>场景</span>
                <span className="tag tag-accent">{wb.scenes.length}</span>
              </div>
              <div className="extract-list">
                {wb.scenes.length === 0 ? (
                  <div className="extract-empty">暂无场景</div>
                ) : wb.scenes.map(s => (
                  <div key={s.id} className="extract-row">
                    <div className="scene-icon"><MapPin size={12} /></div>
                    <div className="extract-info">
                      <div className="extract-name-row">
                        <div className="extract-name">{s.location}</div>
                        <span className="tag">{s.time || '场景'}</span>
                      </div>
                      <div className="extract-meta wrap">{sceneSummary(s)}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <ScriptStepBubble
        currentKey="script-extract"
        disabled={wb.running}
        primaryLabel={hasExtracted ? '分配配音' : '提取角色场景'}
        onPrimaryClick={hasExtracted ? () => wb.goSubStep('script-voice') : wb.doExtract}
      />
    </div>
  )
}

// ——————————————————————————————————————————————
// Step 04: Voice
// ——————————————————————————————————————————————
function VoiceStep() {
  const wb = useWorkbench()
  const isLoading = wb.running && wb.runningType === 'voice_assigner'
  const voicedCount = wb.charsVoiced()
  const sampleCount = wb.characters.filter(c => !!c.voice_sample_url).length
  const hasVoices = wb.voices.length > 0

  if (wb.characters.length === 0) {
    return (
      <div className="script-step locked-script-step">
        <div className="studio-locked-empty">
          <Mic2 size={34} className="studio-locked-icon" />
          <div className="empty-title">尚未准备就绪</div>
          <div className="empty-desc">请先提取角色与场景</div>
        </div>
        <ScriptStepBubble
          currentKey="script-voice"
          primaryLabel="前往提取"
          onPrimaryClick={() => wb.goSubStep('script-extract')}
        />
      </div>
    )
  }

  return (
    <div className="script-step">
      <div className="step-toolbar">
        <div className="toolbar-left">
          <div className="step-indicator">
            <span className="step-num">04</span>
            <span className="step-name">分配音色</span>
          </div>
          {voicedCount > 0 && (
            <span className="char-count">
              {voicedCount}/{wb.characters.length} 已分配
            </span>
          )}
        </div>
        <div className="toolbar-right">
          <Button
            variant="outline"
            size="sm"
            className="panel-btn voice-toolbar-btn"
            disabled={wb.running || !hasVoices}
            onClick={wb.batchVoiceSamples}
            title={hasVoices ? '生成试听文件' : '暂无可用音色，请先在设置中启用音频配置并同步音色'}
          >
            生成试听文件
          </Button>
        </div>
      </div>
      <div className="step-editor">
        {isLoading ? (
          <div className="step-loading">
            <Loader2 size={28} className="animate-spin text-accent" />
            <div className="loading-text">{wb.runningNote || '正在分配音色...'}</div>
          </div>
        ) : (
          <div className="voice-stage">
            <aside className="card voice-stage-panel">
              <div className="voice-stage-kicker">Voice Casting</div>
              <div className="voice-stage-title">角色声音分配台</div>
              <div className="voice-stage-desc">先为每个角色选择合适音色，再生成试听文件快速确认角色表达。</div>
              <div className="voice-stage-stats">
                <div className="voice-stage-stat">
                  <span className="voice-stage-stat-label">已分配</span>
                  <strong>{voicedCount}/{wb.characters.length}</strong>
                </div>
                <div className="voice-stage-stat">
                  <span className="voice-stage-stat-label">试听文件</span>
                  <strong>{sampleCount}/{voicedCount || 0}</strong>
                </div>
              </div>
              <div className="voice-library-meta">
                <span>音色库</span>
                <span>{wb.voices.length} 条</span>
              </div>
              <div className="voice-library">
              {wb.voices.length === 0 ? (
                <div className="extract-empty">暂无音色</div>
              ) : (
                wb.voices.map(v => (
                    <div key={v.voice_id} className="voice-library-item">
                      <div className="voice-library-head">
                        <span className="voice-library-name">{v.voice_name}</span>
                        <span className="tag">voice</span>
                      </div>
                      <div className="voice-library-traits">{v.voice_id}</div>
                    </div>
                ))
              )}
              </div>
            </aside>

            <div className="voice-grid">
                {wb.characters.map(c => (
                  <div key={c.id} className="card voice-card">
                    {(() => {
                      const compatCharacter = c as Character & { voiceStyle?: string; voiceSampleUrl?: string }
                      const voiceStyle = c.voice_style || compatCharacter.voiceStyle || ''
                      const sampleUrl = c.voice_sample_url || compatCharacter.voiceSampleUrl || ''
                      const voiceExists = voiceStyle ? wb.voices.some(v => v.voice_id === voiceStyle) : false
                      const shouldShowLegacyVoice = voiceStyle && !voiceExists
                      const isSampleLoading = wb.pendingVoiceSamples.has(c.id)
                      const canGenerateSample = hasVoices && !!voiceStyle && voiceExists
                      const unavailableHint = !hasVoices
                        ? '暂无可用音色，请先在设置中启用音频配置并同步音色'
                        : voiceStyle && !voiceExists
                          ? '当前音色不在可用音色库中，请重新选择'
                          : '生成试听'
                      const audioSrc = sampleUrl
                        ? (/^https?:\/\//i.test(sampleUrl) ? sampleUrl : `/${String(sampleUrl).replace(/^\/+/, '')}`)
                        : ''
                      return (
                        <>
                    <div className="voice-card-head">
                      <div className="voice-char">
                        <div className="char-avatar lg">
                        {c.name?.[0]}
                      </div>
                        <div className="voice-name">
                          <div className="voice-name-row">
                            <div className="extract-name">{c.name}</div>
                            <span className={cn('tag', voiceStyle ? 'tag-success' : '')}>{voiceStyle ? '已分配' : '待分配'}</span>
                          </div>
                          <div className="extract-meta">{c.role || '角色'}</div>
                        </div>
                      </div>
                    </div>

                    <div className="voice-select-block">
                      <span className="voice-block-label">选择音色</span>
                    <select
                        className="voice-select"
                      value={voiceStyle || ''}
                      disabled={!hasVoices}
                      title={hasVoices ? '选择音色' : '暂无可用音色，请先在设置中启用音频配置并同步音色'}
                      onChange={e => wb.updateCharVoice(c.id, e.target.value)}
                    >
                      <option value="">{hasVoices ? '— 选择音色 —' : '暂无可用音色'}</option>
                      {shouldShowLegacyVoice && (
                        <option value={voiceStyle}>{voiceStyle}（当前不可用）</option>
                      )}
                      {wb.voices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.voice_name}
                        </option>
                      ))}
                    </select>
                    </div>

                    <div className="voice-card-copy">
                      <div className="voice-card-text">{c.description || c.personality || c.appearance || '暂无角色描述，可根据人物定位手动挑选音色。'}</div>
                    </div>

                    <div className="voice-actions-row">
                      {voiceStyle ? (
                        <span className="tag tag-accent">{voiceStyle}</span>
                      ) : (
                        <span className="tag">未分配</span>
                      )}
                      <Button
                        size="xs"
                        variant="outline"
                        className="panel-btn voice-sample-btn"
                        disabled={!canGenerateSample || isSampleLoading}
                        onClick={() => wb.genVoiceSample(c.id)}
                        title={unavailableHint}
                      >
                        {isSampleLoading && <Loader2 size={11} className="animate-spin" />}
                        {isSampleLoading ? '生成中' : sampleUrl ? '重新试听' : '生成试听'}
                      </Button>
                    </div>

                    {sampleUrl && (
                      <audio
                        src={audioSrc}
                        controls
                        className="voice-player"
                        preload="none"
                      />
                    )}
                        </>
                      )
                    })()}
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
      <ScriptStepBubble
        currentKey="script-voice"
        disabled={wb.running || (!hasVoices && voicedCount < wb.characters.length)}
        primaryLabel={
          isLoading
            ? '分配中'
            : voicedCount >= wb.characters.length
              ? '分镜列表'
              : hasVoices
                ? '分配音色'
                : '暂无可用音色'
        }
        onPrimaryClick={voicedCount >= wb.characters.length ? () => wb.goSubStep('script-storyboard') : wb.doVoice}
      />
    </div>
  )
}

// ——————————————————————————————————————————————
// Step 05: Storyboard
// ——————————————————————————————————————————————
interface StoryboardStepProps {
  onRefresh?: () => void
}

function StoryboardStep({ onRefresh }: StoryboardStepProps) {
  const wb = useWorkbench()
  const [selectedSbId, setSelectedSbId] = useState<number | null>(null)
  const isLoading = wb.running && wb.runningType === 'storyboard_breaker'
  const hasSavedScript = !!wb.episode?.script_content?.trim()
  const hasExtractedContext = wb.characters.length > 0 || wb.scenes.length > 0

  const selectedSb = useMemo(() => {
    if (wb.storyboards.length === 0) return null
    if (selectedSbId == null) return wb.storyboards[0]
    return wb.storyboards.find((s) => s.id === selectedSbId) ?? wb.storyboards[0]
  }, [selectedSbId, wb.storyboards])

  const handleAddShot = async () => {
    if (!wb.episode) return
    try {
      await storyboardAPI.create({
        episode_id: wb.episode.id,
        storyboard_number: wb.storyboards.length + 1,
        title: '镜头' + (wb.storyboards.length + 1),
        duration: 10,
      })
      onRefresh?.()
    } catch {
      // handled
    }
  }

  if (!hasSavedScript) {
    return (
      <div className="script-step locked-script-step">
        <div className="studio-locked-empty">
          <FileText size={34} className="studio-locked-icon" />
          <div className="empty-title">尚未准备就绪</div>
          <div className="empty-desc">请先完成 AI 转剧本，或跳过改写使用原始内容</div>
        </div>
        <ScriptStepBubble
          currentKey="script-storyboard"
          primaryLabel="前往 AI 转剧本"
          onPrimaryClick={() => wb.goSubStep('script-rewrite')}
        />
      </div>
    )
  }

  if (!hasExtractedContext) {
    return (
      <div className="script-step locked-script-step">
        <div className="studio-locked-empty">
          <Users size={34} className="studio-locked-icon" />
          <div className="empty-title">尚未准备就绪</div>
          <div className="empty-desc">请先提取角色与场景</div>
        </div>
        <ScriptStepBubble
          currentKey="script-storyboard"
          primaryLabel="前往提取"
          onPrimaryClick={() => wb.goSubStep('script-extract')}
        />
      </div>
    )
  }

  return (
    <div className="script-step">
      <div className="step-toolbar">
        <div className="toolbar-left">
          <div className="step-indicator">
            <span className="step-num">05</span>
            <span className="step-name">分镜列表</span>
          </div>
          {wb.storyboards.length > 0 && (
            <span className="char-count">
              {wb.storyboards.length} 镜头 · {wb.totalDuration()}s
            </span>
          )}
        </div>
        <div className="toolbar-right">
          <Button variant="ghost" size="sm" className="panel-btn" disabled={wb.running} onClick={handleAddShot}>
            <Plus size={12} /> 添加
          </Button>
          {wb.storyboards.length > 0 && (
            <span className="char-count">{wb.storyboards.length} 镜头 · {wb.totalDuration()}s</span>
          )}
          {wb.storyboards.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="panel-btn"
              disabled={wb.running}
              onClick={wb.doBreakdown}
            >
              {wb.running && wb.runningType === 'storyboard_breaker' && (
                <Loader2 size={11} className="animate-spin" />
              )}
              重新拆解
            </Button>
          )}
        </div>
      </div>

      <div className="step-editor">
        {isLoading ? (
          <div className="step-loading">
            <Loader2 size={28} className="animate-spin text-accent" />
            <div className="loading-text">{wb.runningNote || '正在拆解分镜...'}</div>
          </div>
        ) : wb.storyboards.length === 0 ? (
          <div className="step-empty">
            <div className="empty-title">将剧本拆解为分镜序列</div>
            <div className="empty-desc">
              AI 将自动生成分镜结构、镜头描述与提示词
            </div>
          </div>
        ) : (
          <div className="split-layout">
            {/* Left: Shot list */}
            <div className="shot-list">
              <div className="shot-list-head">
                <div>
                  <div className="shot-list-title">镜头序列</div>
                  <div className="shot-list-sub">按镜头顺序检查内容与素材状态</div>
                </div>
                <span className="tag mono">{wb.totalDuration()}s</span>
              </div>
              <div className="shot-list-body">
                {wb.storyboards.map((sb, i) => {
                  const characters = sb.characters || []
                  const scene = wb.scenes.find(s => s.id === sb.scene_id)
                  return (
                    <div
                      key={sb.id}
                      className={cn('shot-item', selectedSb?.id === sb.id && 'active')}
                      onClick={() => setSelectedSbId(sb.id)}
                    >
                      <div className="shot-item-header">
                        <div className="shot-num">#{String(i + 1).padStart(2, '0')}</div>
                        <span className="tag">{sb.shot_type || '—'}</span>
                        {characters.length > 0 && <span className="tag">{characters.length} 角色</span>}
                        <div className="shot-status">
                          {(sb.composed_image || sb.first_frame_image || sb.last_frame_image) && (
                            <span className="shot-dot has-img" title="已生成图片" />
                          )}
                          {(sb.video_url || sb.composed_video_url) && (
                            <span className="shot-dot has-video" title="已生成视频" />
                          )}
                          {sb.dialogue && <span className="shot-dot has-dialogue" title="有对白" />}
                        </div>
                      </div>
                      <div className="shot-body">
                        <div className="shot-desc">{sb.description || sb.title || '无描述'}</div>
                      </div>
                      <div className="shot-meta">
                        <span className="mono dim">{sb.duration || 10}s</span>
                        {(sb.location || scene?.location) && (
                          <span className="shot-location">{sb.location || scene?.location}</span>
                        )}
                        {characters.length > 0 && (
                          <span className="shot-location">
                            {characters.map(c => c.name).filter(Boolean).join(' / ')}
                          </span>
                        )}
                        {sb.dialogue && <span className="shot-dialogue">{sb.dialogue}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right: Shot detail */}
            <div className="detail-panel">
              {selectedSb ? (
                <ShotDetail key={selectedSb.id} sb={selectedSb} />
              ) : (
                <div className="storyboard-empty">
                  选择一个镜头查看详情
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <ScriptStepBubble
        currentKey="script-storyboard"
        disabled={wb.running}
        primaryLabel={
          isLoading
            ? '拆解中'
            : wb.storyboards.length
              ? '进入制作'
              : 'AI拆解分镜'
        }
        onPrimaryClick={wb.storyboards.length ? () => wb.goSubStep('prod-chars') : wb.doBreakdown}
      />
    </div>
  )
}

// ——————————————————————————————————————————————
// Shot Detail Panel
// ——————————————————————————————————————————————
function ShotDetail({ sb }: { sb: Storyboard }) {
  const wb = useWorkbench()

  const selectedIndex = Math.max(0, wb.storyboards.findIndex(s => s.id === sb.id))
  const scene = wb.scenes.find(s => s.id === sb.scene_id)
  const firstFrame = sb.first_frame_image || sb.composed_image
  const lastFrame = sb.last_frame_image
  const imageUrl = (url: string) => staticUrl(url)

  const field = (key: keyof Storyboard, placeholder?: string, rows = 3) => (
    <textarea
      className="textarea"
      defaultValue={(sb[key] as string) || ''}
      placeholder={placeholder}
      rows={rows}
      onBlur={e => wb.updateField(sb, key, e.target.value)}
    />
  )

  const inlineField = (key: keyof Storyboard, placeholder?: string, list?: string) => (
    <input
      type="text"
      className="input"
      defaultValue={(sb[key] as string) || ''}
      placeholder={placeholder}
      list={list}
      onBlur={e => wb.updateField(sb, key, e.target.value)}
    />
  )

  return (
    <>
      <div className="detail-head">
        <div className="detail-head-copy">
          <span className="detail-head-title">镜头 #{selectedIndex + 1}</span>
          <span className="detail-head-sub">
            {sb.title || `镜头 ${selectedIndex + 1}`} · {sb.shot_type || '未设置景别'}
          </span>
        </div>
        <span className="tag mono">{sb.duration || 10}s</span>
        <Button
          size="sm"
          variant="ghost"
          className="detail-delete-btn"
          onClick={() => wb.requestDeleteShot(sb)}
        >
          <Trash2 size={12} />
        </Button>
      </div>

      <div className="detail-body">
        <div className="detail-hero">
          <div className="detail-hero-copy">
            <div className="detail-hero-label">镜头概览</div>
            <div className="detail-hero-text">
              {sb.description || sb.title || '当前镜头还没有画面描述，建议先补充核心动作和构图。'}
            </div>
            <div className="detail-status-row">
              <span className="tag">{scene?.location || sb.location || '未绑定场景'}</span>
              <span className="tag">{sb.angle || '未设角度'}</span>
              <span className="tag">{sb.movement || '未设运镜'}</span>
              <span className={cn('tag', firstFrame && 'tag-success')}>
                首帧 {firstFrame ? '已生成' : '待生成'}
              </span>
              <span className={cn('tag', lastFrame && 'tag-success')}>
                尾帧 {lastFrame ? '已生成' : '待生成'}
              </span>
              <span className={cn('tag', (sb.video_url || sb.composed_video_url) && 'tag-success')}>
                视频 {(sb.video_url || sb.composed_video_url) ? '已生成' : '待生成'}
              </span>
            </div>
          </div>
          <div className="detail-preview-grid">
            <div className="detail-preview-card">
              <div className="detail-preview-title">首帧</div>
              <button
                type="button"
                className="detail-preview-media"
                disabled={!firstFrame}
                onClick={() => firstFrame && wb.openImageViewer(imageUrl(firstFrame), `镜头 #${selectedIndex + 1} 首帧`)}
              >
                {firstFrame ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl(firstFrame)} alt={`镜头 #${selectedIndex + 1} 首帧`} className="previewable-image" />
                ) : (
                  <span className="detail-preview-empty">待生成</span>
                )}
              </button>
            </div>
            <div className="detail-preview-card">
              <div className="detail-preview-title">尾帧</div>
              <button
                type="button"
                className="detail-preview-media"
                disabled={!lastFrame}
                onClick={() => lastFrame && wb.openImageViewer(imageUrl(lastFrame), `镜头 #${selectedIndex + 1} 尾帧`)}
              >
                {lastFrame ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl(lastFrame)} alt={`镜头 #${selectedIndex + 1} 尾帧`} className="previewable-image" />
                ) : (
                  <span className="detail-preview-empty">待生成</span>
                )}
              </button>
            </div>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-head">
            <span className="detail-section-title">镜头结构</span>
            <span className="detail-section-copy">景别、角度、运镜、场景绑定和时长</span>
          </div>
          <div className="field-grid field-grid-4">
            <label className="field">
              <span className="field-label">标题</span>
              {inlineField('title', '如：深夜难眠')}
            </label>
            <label className="field">
              <span className="field-label">景别</span>
              {inlineField('shot_type', '选择或输入景别', 'shot-type-list')}
            </label>
            <label className="field">
              <span className="field-label">角度</span>
              {inlineField('angle', '选择或输入角度', 'shot-angle-list')}
            </label>
            <label className="field">
              <span className="field-label">运镜</span>
              {inlineField('movement', '选择或输入运镜', 'shot-movement-list')}
            </label>
          </div>
          <div className="field-grid field-grid-4">
            <label className="field field-wide">
              <span className="field-label">绑定角色</span>
              <div className="role-pills">
                {wb.characters.map(c => {
                  const isIn = (sb.characters || []).some(ch => ch.id === c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className={cn('role-pill', isIn && 'active')}
                      onClick={() => wb.toggleStoryboardCharacter(sb, c.id)}
                    >
                      {c.name}
                    </button>
                  )
                })}
                {wb.characters.length === 0 && (
                  <span className="dim text-xs">当前集还没有角色</span>
                )}
              </div>
            </label>
            <label className="field">
              <span className="field-label">绑定场景</span>
              <select
                className="input"
                defaultValue={sb.scene_id || ''}
                onChange={e => wb.updateField(sb, 'scene_id', e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">未绑定场景</option>
                {wb.scenes.map(s => (
                  <option key={s.id} value={s.id}>{s.location} · {s.time || '未设时间'}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field-label">地点</span>
              {inlineField('location', '场景地点')}
            </label>
            <label className="field">
              <span className="field-label">时间</span>
              {inlineField('time', '如：深夜 / 清晨')}
            </label>
            <label className="field">
              <span className="field-label">时长</span>
              <input
                type="number"
                className="input"
                defaultValue={sb.duration || 10}
                min={1}
                max={60}
                onBlur={e => wb.updateField(sb, 'duration', Number(e.target.value))}
              />
            </label>
          </div>
        </div>

        <div className="detail-section">
          <div className="detail-section-head">
            <span className="detail-section-title">画面语义</span>
            <span className="detail-section-copy">动作、结果、氛围和对白</span>
          </div>
          <div className="field-grid field-grid-2">
            <label className="field">
              <span className="field-label">动作</span>
              {field('action', '谁在做什么，表情和动作细节是什么')}
            </label>
            <label className="field">
              <span className="field-label">结果</span>
              {field('result', '镜头结束时的状态变化或画面结果')}
            </label>
          </div>
          <div className="field-grid field-grid-2">
            <label className="field">
              <span className="field-label">画面描述</span>
              {field('description', '描述画面内容...', 4)}
            </label>
            <label className="field">
              <span className="field-label">氛围</span>
              {field('atmosphere', '光线、色调、空气感、环境氛围', 4)}
            </label>
          </div>
          <label className="field">
            <span className="field-label">对白 / 旁白</span>
            {field('dialogue', '角色名：台词内容 或 旁白：内容')}
          </label>
        </div>

        <div className="detail-section">
          <div className="detail-section-head">
            <span className="detail-section-title">生成提示</span>
            <span className="detail-section-copy">分别服务图片、视频、配乐和音效生成</span>
          </div>
          <label className="field">
            <span className="field-label">静态画面提示词</span>
            {field('image_prompt', '用于首帧、尾帧和镜头图片的单帧画面提示词', 4)}
          </label>
          <label className="field">
            <span className="field-label">视频提示词</span>
            {field('video_prompt', '按 3 秒分段的视频提示词...', 5)}
          </label>
          <div className="field-grid field-grid-2">
            <label className="field">
              <span className="field-label">配乐提示词</span>
              {field('bgm_prompt', '如：压抑低频弦乐，缓慢推进')}
            </label>
            <label className="field">
              <span className="field-label">音效提示词</span>
              {field('sound_effect', '如：风雪声、脚步声、衣料摩擦声')}
            </label>
          </div>
        </div>

        <datalist id="shot-type-list">
          {SHOT_TYPES.map(item => <option key={item} value={item} />)}
        </datalist>
        <datalist id="shot-angle-list">
          {SHOT_ANGLES.map(item => <option key={item} value={item} />)}
        </datalist>
        <datalist id="shot-movement-list">
          {SHOT_MOVEMENTS.map(item => <option key={item} value={item} />)}
        </datalist>
      </div>
    </>
  )
}
