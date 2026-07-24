'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Check, ChevronRight, Loader2, Settings2 } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { dramaWorkspaceAPI, type DramaDefaultSettingsPayload } from '@/lib/api'
import { cn } from '@/lib/cn'
import { dramaStyleLabel } from '@/lib/drama-style'

type SettingsForm = {
  text_config_id: string
  image_config_id: string
  video_config_id: string
  audio_config_id: string
  visual_style: string
  aspect_ratio: string
  character_consistency: string
  scene_consistency: string
  lead_character_name: string
  lead_character_description: string
  lead_voice_id: string
  voice_notes: string
}

const styleOptions = [
  { value: 'realistic', label: '写实', tone: 'is-realistic' },
  { value: 'cinematic', label: '电影感', tone: 'is-cinematic' },
  { value: 'anime', label: '二次元', tone: 'is-anime' },
  { value: 'watercolor', label: '水彩', tone: 'is-watercolor' },
]

function toForm(payload: DramaDefaultSettingsPayload): SettingsForm {
  const settings = payload.settings
  return {
    text_config_id: settings.text_config_id ? String(settings.text_config_id) : '',
    image_config_id: settings.image_config_id ? String(settings.image_config_id) : '',
    video_config_id: settings.video_config_id ? String(settings.video_config_id) : '',
    audio_config_id: settings.audio_config_id ? String(settings.audio_config_id) : '',
    visual_style: String(settings.visual_style || ''),
    aspect_ratio: String(settings.aspect_ratio || ''),
    character_consistency: String(settings.character_consistency || ''),
    scene_consistency: String(settings.scene_consistency || ''),
    lead_character_name: String(settings.lead_character_name || ''),
    lead_character_description: String(settings.lead_character_description || ''),
    lead_voice_id: String(settings.lead_voice_id || ''),
    voice_notes: String(settings.voice_notes || ''),
  }
}

function modelSummary(payload: DramaDefaultSettingsPayload | null, key: 'text' | 'image' | 'video' | 'audio') {
  const value = payload?.resolved?.[key]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '继承平台默认'
  const record = value as Record<string, unknown>
  if (record.available === false) return '未配置可用模型'
  return record.inherited ? '继承平台默认' : String(record.name || record.model || '项目覆盖')
}

export function DefaultSettingsPanel({ dramaId }: { dramaId: number }) {
  const [payload, setPayload] = useState<DramaDefaultSettingsPayload | null>(null)
  const [form, setForm] = useState<SettingsForm | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')

  const load = async () => {
    setLoading(true)
    try {
      const next = await dramaWorkspaceAPI.getDefaultSettings(dramaId, { bypassCache: true })
      setPayload(next)
      setForm(toForm(next))
    } catch {
      toast.error('项目设置暂时无法加载，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dramaId])

  const savePatch = async (patch: Partial<SettingsForm>) => {
    if (!payload) return
    setSaving(true)
    setSaveState('idle')
    try {
      const body = Object.fromEntries(Object.entries(patch).map(([key, value]) => {
        if (key.endsWith('_config_id')) return [key, value?.trim() ? Number(value) : null]
        return [key, value?.trim() || null]
      }))
      const next = await dramaWorkspaceAPI.updateDefaultSettings(dramaId, { version: payload.version, ...body })
      setPayload(next)
      setForm(toForm(next))
      setSaveState('saved')
    } catch {
      setSaveState('error')
      toast.error('未能保存此项设置，请刷新后重试。')
    } finally {
      setSaving(false)
    }
  }

  const update = <Key extends keyof SettingsForm>(key: Key, value: SettingsForm[Key], save = false) => {
    setForm((current) => current ? { ...current, [key]: value } : current)
    if (save) void savePatch({ [key]: value })
  }

  if (loading) return <div className="drama-workspace-band"><div className="drama-empty-inline"><Loader2 size={16} className="animate-spin" />加载项目设置...</div></div>
  if (!form) return <div className="drama-workspace-band"><div className="drama-empty-inline">项目设置暂时不可用</div></div>

  const currentStyle = form.visual_style || String(payload?.resolved.visual_style || '')

  return (
    <div className="drama-workspace-band drama-project-settings">
      <div className="drama-workspace-section-head">
        <div>
          <h3>默认制作偏好</h3>
          <p>只影响后续生成，不改写已确认的结果。</p>
        </div>
        <span className={cn('drama-settings-save-state', saveState === 'saved' && 'is-saved', saveState === 'error' && 'is-error')} aria-live="polite">
          {saving ? <><Loader2 size={13} className="animate-spin" />正在保存</> : saveState === 'saved' ? <><Check size={13} />已保存</> : saveState === 'error' ? '保存失败' : null}
        </span>
      </div>

      <section className="drama-settings-preference">
        <div className="drama-settings-preference-copy">
          <span>画面风格</span>
          <small>{dramaStyleLabel(currentStyle) || '使用项目现有风格'}</small>
        </div>
        <div className="drama-style-picker" role="radiogroup" aria-label="默认画面风格">
          {styleOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn('drama-style-option', option.tone, currentStyle === option.value && 'is-selected')}
              role="radio"
              aria-checked={currentStyle === option.value}
              disabled={saving}
              onClick={() => update('visual_style', option.value, true)}
            >
              <i aria-hidden="true" />
              <span>{option.label}</span>
              {currentStyle === option.value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="drama-settings-preference is-compact">
        <div className="drama-settings-preference-copy"><span>画幅比例</span><small>{form.aspect_ratio || '使用项目默认比例'}</small></div>
        <div className="drama-settings-segment" role="radiogroup" aria-label="默认画幅比例">
          {['9:16', '16:9', '1:1'].map((ratio) => (
            <button key={ratio} type="button" role="radio" aria-checked={form.aspect_ratio === ratio} className={cn(form.aspect_ratio === ratio && 'is-selected')} disabled={saving} onClick={() => update('aspect_ratio', ratio, true)}>{ratio}</button>
          ))}
        </div>
      </section>

      <section className="drama-settings-preference is-compact">
        <div className="drama-settings-preference-copy"><span>角色一致性</span><small>{form.character_consistency || '使用已确认的主角色图'}</small></div>
        <button type="button" className="drama-settings-choice" disabled={saving} onClick={() => update('character_consistency', '使用已确认的主角色图', true)}>
          使用已确认的主角色图 <ChevronRight size={15} />
        </button>
      </section>

      <section className="drama-settings-preference is-compact">
        <label className="drama-settings-preference-copy" htmlFor="drama-voice-notes"><span>声音偏好</span><small>{form.voice_notes || '使用项目默认声音'}</small></label>
        <Input id="drama-voice-notes" value={form.voice_notes} disabled={saving} onChange={(event) => update('voice_notes', event.target.value)} onBlur={() => void savePatch({ voice_notes: form.voice_notes })} placeholder="例如：女声、温和" />
      </section>

      <details className="drama-settings-advanced">
        <summary>高级设置 <ChevronRight size={15} /></summary>
        <div className="drama-settings-advanced-body">
          <div className="drama-settings-model-summary">
            {(['text', 'image', 'video', 'audio'] as const).map((key) => <span key={key}>{({ text: '文本', image: '图片', video: '视频', audio: '音频' })[key]}模型：<b>{modelSummary(payload, key)}</b></span>)}
          </div>
          <div className="drama-settings-grid">
            <label><span>文本配置编号</span><Input value={form.text_config_id} disabled={saving} onChange={(event) => update('text_config_id', event.target.value)} onBlur={() => void savePatch({ text_config_id: form.text_config_id })} placeholder="继承平台默认" /></label>
            <label><span>图片配置编号</span><Input value={form.image_config_id} disabled={saving} onChange={(event) => update('image_config_id', event.target.value)} onBlur={() => void savePatch({ image_config_id: form.image_config_id })} placeholder="继承平台默认" /></label>
            <label><span>视频配置编号</span><Input value={form.video_config_id} disabled={saving} onChange={(event) => update('video_config_id', event.target.value)} onBlur={() => void savePatch({ video_config_id: form.video_config_id })} placeholder="继承平台默认" /></label>
            <label><span>音频配置编号</span><Input value={form.audio_config_id} disabled={saving} onChange={(event) => update('audio_config_id', event.target.value)} onBlur={() => void savePatch({ audio_config_id: form.audio_config_id })} placeholder="继承平台默认" /></label>
            <label><span>场景一致性</span><Input value={form.scene_consistency} disabled={saving} onChange={(event) => update('scene_consistency', event.target.value)} onBlur={() => void savePatch({ scene_consistency: form.scene_consistency })} placeholder="使用已确认的场景素材" /></label>
            <label><span>主角名称</span><Input value={form.lead_character_name} disabled={saving} onChange={(event) => update('lead_character_name', event.target.value)} onBlur={() => void savePatch({ lead_character_name: form.lead_character_name })} placeholder="可选" /></label>
            <label className="is-wide"><span>主角描述</span><Textarea value={form.lead_character_description} disabled={saving} onChange={(event) => update('lead_character_description', event.target.value)} onBlur={() => void savePatch({ lead_character_description: form.lead_character_description })} rows={3} /></label>
            <label><span>默认音色编号</span><Input value={form.lead_voice_id} disabled={saving} onChange={(event) => update('lead_voice_id', event.target.value)} onBlur={() => void savePatch({ lead_voice_id: form.lead_voice_id })} placeholder="继承平台默认" /></label>
          </div>
          <Link href="/settings" className="drama-inline-link"><Settings2 size={14} />管理平台 AI 配置</Link>
        </div>
      </details>
    </div>
  )
}
