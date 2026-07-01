'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { Plus, Pencil, Trash2, Loader2, Check, Eye, EyeOff, Copy, PlugZap } from 'lucide-react'
import { toast } from 'sonner'
import { aiConfigAPI } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogHeaderBar,
  DialogMain,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  SERVICE_TYPES, SERVICE_META, PROVIDER_PRESETS, PROVIDER_COLORS,
  fmtModel, providerLabel,
} from './settings-data'
import type { AIServiceConfig } from '@/types/api'

function ProviderMark({ provider, label, size = 26 }: { provider: string; label: string; size?: number }) {
  const color = PROVIDER_COLORS[provider] || '#6B7280'
  const initial = (label || provider).trim().charAt(0).toUpperCase()
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[8px] font-semibold text-white"
      style={{ backgroundColor: color, width: size, height: size, fontSize: size * 0.5 }}
    >
      {initial}
    </span>
  )
}

export function AIServicesTab() {
  const [cfgs, setCfgs] = useState<AIServiceConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState<string>(SERVICE_TYPES[0].type)

  const [cfgDialog, setCfgDialog] = useState(false)
  const [cfgEditId, setCfgEditId] = useState<number | null>(null)
  const [cfgTesting, setCfgTesting] = useState(false)
  const [cfgTestResult, setCfgTestResult] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const [cfgOriginalApiKey, setCfgOriginalApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)

  const [cfgForm, setCfgForm] = useState({
    name: '', description: '', provider: '', api_key: '', base_url: '', modelStr: '',
    service_type: 'text', priority: 0, settingsText: '',
  })

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true)
    try {
      const data = await aiConfigAPI.list() as unknown as AIServiceConfig[]
      setCfgs(data || [])
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      if (!opts?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const byType = (t: string) => cfgs.filter(c => c.service_type === t)
  const countByType = (t: string) => byType(t).length
  const countActive = (t: string) => byType(t).filter(c => isConfigEnabled(c)).length

  const activeService = SERVICE_TYPES.find(st => st.type === activeType) ?? SERVICE_TYPES[0]

  const providerCards = useMemo(() => {
    const presets = presetsByType(cfgForm.service_type)
    if (cfgForm.provider && !presets.some(p => p.provider === cfgForm.provider)) {
      return [
        ...presets,
        {
          provider: cfgForm.provider,
          label: providerLabel(cfgForm.provider),
          baseUrl: cfgForm.base_url,
          models: cfgForm.modelStr.split(',').map(s => s.trim()).filter(Boolean),
          defaultName: cfgForm.name || providerLabel(cfgForm.provider),
          defaultDescription: cfgForm.description,
        },
      ]
    }
    return presets
  }, [cfgForm.service_type, cfgForm.provider, cfgForm.base_url, cfgForm.modelStr, cfgForm.name, cfgForm.description])

  const dialogTitle = cfgEditId
    ? `编辑 · ${providerLabel(cfgForm.provider) || '服务'} · ${SERVICE_META[cfgForm.service_type]?.label ?? '服务'}`
    : `添加${SERVICE_META[cfgForm.service_type]?.label ?? ''}服务`

  const defaultBaseUrl = PROVIDER_PRESETS[cfgForm.service_type]?.[cfgForm.provider]?.baseUrl ?? ''
  const baseUrlValid = /^(https?|wss?):\/\/.+/i.test(cfgForm.base_url.trim())

  async function copyApiKey() {
    if (!cfgForm.api_key) return
    try {
      await navigator.clipboard.writeText(cfgForm.api_key)
      toast.success('已复制 API Key')
    } catch {
      toast.error('复制失败')
    }
  }

  function settingsTextForProvider(type: string, provider: string) {
    if (type === 'audio' && provider === 'volcengine') {
      return JSON.stringify({
        encoding: 'mp3',
        sampleRate: 24000,
        bitRate: 128000,
        emotion: '',
        emotionScale: 4,
        loudnessRate: 0,
        explicitLanguage: 'zh',
        disableMarkdownFilter: false,
      }, null, 2)
    }
    if (type === 'video' && provider === 'kling') {
      return JSON.stringify({ secretKey: '', mode: 'std' }, null, 2)
    }
    return ''
  }

  function prefillConnection() {
    const source = cfgs.find(c => c.api_key && c.base_url) || cfgs[0]
    if (!source) return { api_key: '', base_url: '' }
    return { api_key: source.api_key || '', base_url: source.base_url || '' }
  }

  function presetsByType(type: string) {
    const group = PROVIDER_PRESETS[type] || {}
    return Object.entries(group).map(([provider, preset]) => ({ provider, ...preset }))
  }

  function selectProvider(type: string, provider: string, opts?: { fillBasic?: boolean }) {
    const preset = PROVIDER_PRESETS[type]?.[provider]
    if (!preset) return
    setCfgTestResult(null)
    setCfgForm(f => ({
      ...f,
      provider,
      base_url: preset.baseUrl,
      modelStr: preset.models[0] ?? '',
      settingsText: settingsTextForProvider(type, provider),
      ...(opts?.fillBasic
        ? { name: preset.defaultName, description: preset.defaultDescription }
        : {}),
    }))
  }

  function startAdd(t: string) {
    setCfgEditId(null)
    setCfgTestResult(null)
    setCfgOriginalApiKey('')
    setShowApiKey(false)
    const prefilled = prefillConnection()
    const first = presetsByType(t)[0]
    setCfgForm({
      name: '', description: '', provider: '', api_key: prefilled.api_key, base_url: prefilled.base_url, modelStr: '',
      service_type: t, priority: 0, settingsText: '',
    })
    if (first) selectProvider(t, first.provider, { fillBasic: true })
    setCfgDialog(true)
  }

  function startEdit(c: AIServiceConfig) {
    setCfgEditId(c.id)
    setCfgTestResult(null)
    setCfgOriginalApiKey(c.api_key || '')
    setShowApiKey(false)
    setCfgForm({
      name: c.name || '',
      description: c.description || '',
      provider: c.provider,
      api_key: c.api_key || '',
      base_url: c.base_url || '',
      modelStr: fmtSingleModel(c.model),
      service_type: c.service_type,
      priority: c.priority ?? 0,
      settingsText: c.settings ? JSON.stringify(c.settings, null, 2) : '',
    })
    setCfgDialog(true)
  }

  async function testCfg(payload: Record<string, unknown>) {
    setCfgTesting(true)
    try {
      const result = await aiConfigAPI.test(payload) as Record<string, unknown>
      setCfgTestResult(result)
      if (result.reachable) toast.success('端点已响应')
      else toast.warning('端点未通过测试')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setCfgTesting(false)
    }
  }

  async function testDraft() {
    const modelId = parseModelId()
    if (modelId === false) return
    const settings = parseSettingsText()
    if (settings === false) return
    await testCfg({
      service_type: cfgForm.service_type,
      provider: cfgForm.provider,
      api_key: cfgForm.api_key,
      base_url: cfgForm.base_url,
      model: [modelId],
      settings,
    })
  }

  function fmtSingleModel(m: unknown): string {
    if (Array.isArray(m)) return m[0] ? String(m[0]) : ''
    return m ? String(m) : ''
  }

  function parseModelId(): string | false {
    const modelId = cfgForm.modelStr.trim()
    if (!modelId) {
      toast.warning('请填写模型 ID')
      return false
    }
    if (modelId.includes(',')) {
      toast.warning('每条配置仅支持一个模型')
      return false
    }
    return modelId
  }

  function parseSettingsText(): Record<string, unknown> | null | false {
    const raw = cfgForm.settingsText.trim()
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        toast.warning('高级参数必须是 JSON 对象')
        return false
      }
      return parsed as Record<string, unknown>
    } catch {
      toast.warning('高级参数不是有效 JSON')
      return false
    }
  }

  async function saveCfg() {
    if (!cfgForm.name.trim()) { toast.warning('请填写配置名称'); return }
    if (!cfgForm.description.trim()) { toast.warning('请填写配置描述'); return }
    if (!cfgForm.provider) { toast.warning('选择服务商'); return }
    if (!cfgForm.api_key.trim()) { toast.warning('请填写 API Key'); return }
    if (!cfgForm.base_url.trim()) { toast.warning('请填写 Base URL'); return }
    const modelId = parseModelId()
    if (modelId === false) return
    setSaving(true)
    const settings = parseSettingsText()
    if (settings === false) {
      setSaving(false)
      return
    }
    try {
      if (cfgEditId) {
        const updatePayload: Record<string, unknown> = {
          name: cfgForm.name.trim(),
          description: cfgForm.description.trim(),
          provider: cfgForm.provider,
          base_url: cfgForm.base_url.trim(),
          model: [modelId],
          priority: cfgForm.priority,
          settings,
        }
        const apiKeyChanged = cfgForm.api_key !== cfgOriginalApiKey
        const isRedacted = cfgForm.api_key.includes('*')
        if (apiKeyChanged && !isRedacted) {
          updatePayload.api_key = cfgForm.api_key
        }
        await aiConfigAPI.update(cfgEditId, {
          ...updatePayload,
        })
      } else {
        await aiConfigAPI.create({
          service_type: cfgForm.service_type,
          provider: cfgForm.provider,
          name: cfgForm.name.trim(),
          description: cfgForm.description.trim(),
          api_key: cfgForm.api_key.trim(), base_url: cfgForm.base_url.trim(), model: [modelId],
          settings,
          priority: cfgForm.priority,
        })
      }
      setCfgDialog(false)
      setActiveType(cfgForm.service_type)
      toast.success('已保存')
      load({ silent: true })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function toggleCfg(c: AIServiceConfig, nextActive: boolean) {
    const prev = cfgs
    setCfgs(items => items.map(item => (
      item.id === c.id ? { ...item, is_active: nextActive ? 1 : 0 } : item
    )))
    try {
      await aiConfigAPI.update(c.id, { is_active: nextActive ? 1 : 0 })
    } catch (e: unknown) {
      setCfgs(prev)
      toast.error((e as Error).message)
    }
  }

  async function delCfg(id: number) {
    const prev = cfgs
    setCfgs(items => items.filter(c => c.id !== id))
    try {
      await aiConfigAPI.del(id)
      toast.success('已删除')
    } catch (e: unknown) {
      setCfgs(prev)
      toast.error((e as Error).message)
    }
  }

  if (loading) return <div className="page-shell flex-1 min-h-0 text-text-3 text-sm">加载中...</div>

  return (
    <div className="page-shell animate-fade-up flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      {/* Head (sticky) */}
      <div className="shrink-0 pb-4">
        <h2 className="page-title mb-2">AI 服务配置</h2>
        <p className="page-subtitle">按服务类型添加与管理 AI 模型配置。</p>
        <div
          className="mt-4 flex gap-1 overflow-x-auto pb-0.5"
          role="tablist"
          aria-label="AI 服务类型"
        >
          {SERVICE_TYPES.map(st => {
            const selected = activeType === st.type
            const total = countByType(st.type)
            return (
              <button
                key={st.type}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveType(st.type)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm transition-colors cursor-pointer ${
                  selected
                    ? 'border-accent-glow bg-accent-bg font-semibold text-accent-text'
                    : 'border-border bg-bg-0 text-text-2 hover:border-accent hover:bg-bg-hover hover:text-text-0'
                }`}
              >
                <span>{st.label}</span>
                <span
                  className={`min-w-[1.25rem] rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none ${
                    selected ? 'bg-bg-0/80 text-accent-text' : 'bg-bg-2 text-text-3'
                  }`}
                >
                  {total}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-5">
        <section className="mb-6">
          <div className="mb-3 flex items-center gap-3">
            <div>
              <div className="text-sm font-bold text-text-0">{activeService.label}</div>
            </div>
            <span className="text-[10px] rounded-full bg-bg-2 px-2 py-0.5 text-text-3">
              {countByType(activeType)} 已配置
            </span>
            {countActive(activeType) > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-bg text-accent-text">
                {countActive(activeType)} 已启用
              </span>
            )}
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => startAdd(activeType)}>
              <Plus size={13} /> 添加
            </Button>
          </div>
          <div className="space-y-2">
            {byType(activeType).map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-[14px] bg-bg-0 border border-border">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-text-0">{c.name || providerLabel(c.provider)}</span>
                  </div>
                  {c.description ? (
                    <div className="text-[11px] text-text-2 truncate mb-0.5">{c.description}</div>
                  ) : null}
                  <div className="text-[10px] font-mono text-text-3 truncate">{providerLabel(c.provider)} · {fmtModel(c.model)}</div>
                  <div className="text-[10px] font-mono text-text-3 truncate mt-0.5">{c.base_url || '未设置 Base URL'}</div>
                </div>
                <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${c.api_key ? 'bg-success-bg text-success' : 'bg-error-bg text-error'}`}>
                  {c.api_key ? '已配置' : '无密钥'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => startEdit(c)}
                  title="测试或编辑配置"
                >
                  测试
                </Button>
                <Switch
                  checked={isConfigEnabled(c)}
                  onCheckedChange={next => toggleCfg(c, next)}
                  title="启停配置"
                  aria-label={`${isConfigEnabled(c) ? '停用' : '启用'} ${c.name || providerLabel(c.provider)}`}
                  className="data-[state=checked]:bg-accent"
                />
                <Button variant="ghost" size="icon" onClick={() => startEdit(c)} title="编辑配置"><Pencil size={13} /></Button>
                <Button variant="ghost" size="icon" onClick={() => delCfg(c.id)} title="删除配置"><Trash2 size={13} /></Button>
              </div>
            ))}
            {byType(activeType).length === 0 && (
              <div className="rounded-[14px] border border-dashed border-border bg-bg-2 py-6 text-center text-sm text-text-3">
                暂无配置
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Config Dialog */}
      <Dialog open={cfgDialog} onOpenChange={setCfgDialog}>
        <DialogContent layout="panel" className="w-[min(960px,calc(100%-2rem))] max-w-[960px] sm:max-w-[960px]">
          <DialogHeaderBar density="compact" className="border-b border-border/70">
            <DialogTitle className="text-lg font-semibold text-text-0 sm:text-xl">
              {dialogTitle}
            </DialogTitle>
            <DialogDescription className="mt-1.5 text-sm leading-relaxed text-text-2">
              {SERVICE_META[cfgForm.service_type]?.desc ?? '配置 AI 模型连接信息'}
            </DialogDescription>
          </DialogHeaderBar>

          {cfgTestResult ? (
            <div
              className={`mx-6 mt-4 shrink-0 rounded-[var(--radius-sm)] border px-3 py-2.5 text-sm sm:mx-7 ${
                (cfgTestResult as Record<string, unknown>).reachable
                  ? 'border-success/20 bg-success-bg text-success'
                  : 'border-error/20 bg-error-bg text-error'
              }`}
            >
              <div className="font-medium">{(cfgTestResult as Record<string, unknown>).message as string}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] opacity-80">
                {(cfgTestResult as Record<string, unknown>).url as string}
              </div>
            </div>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
              {/* 左侧服务商竖列 */}
              <aside className="shrink-0 overflow-y-auto border-b border-border/70 px-4 py-4 sm:w-[216px] sm:border-b-0 sm:border-r sm:px-5 sm:py-6">
                <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-wide text-text-3">
                  服务商
                </h3>
                <div className="flex gap-2 overflow-x-auto sm:flex-col sm:overflow-visible" role="radiogroup" aria-label="选择服务商">
                  {providerCards.map(p => {
                    const selected = cfgForm.provider === p.provider
                    return (
                      <button
                        key={p.provider}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => selectProvider(cfgForm.service_type, p.provider)}
                        className={`group relative flex shrink-0 items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-left transition-colors cursor-pointer ${
                          selected
                            ? 'border-accent bg-accent-bg shadow-shadow-xs'
                            : 'border-border bg-bg-0 hover:border-accent/40 hover:bg-bg-hover'
                        }`}
                      >
                        <ProviderMark provider={p.provider} label={p.label} />
                        <span className={`text-sm font-medium ${selected ? 'text-accent-text' : 'text-text-1'}`}>
                          {p.label}
                        </span>
                        {selected ? (
                          <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-accent text-white shadow-shadow-xs">
                            <Check size={11} strokeWidth={3} />
                          </span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </aside>

              {/* 右侧表单 */}
              <DialogMain density="compact" className="min-h-0 flex-1 overflow-y-auto">
                <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-1">
                      配置名称 <span className="text-error">*</span>
                    </span>
                    <div className="relative">
                      <Input
                        value={cfgForm.name}
                        maxLength={50}
                        onChange={e => setCfgForm(f => ({ ...f, name: e.target.value }))}
                        placeholder="如：主力视频 / 备用生图"
                        className="h-9 pr-14 text-sm"
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] tabular-nums text-text-3">
                        {cfgForm.name.length}/50
                      </span>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-1">
                      API Key <span className="text-error">*</span>
                    </span>
                    <div className="relative">
                      <Input
                        type={showApiKey ? 'text' : 'password'}
                        value={cfgForm.api_key}
                        onChange={e => setCfgForm(f => ({ ...f, api_key: e.target.value }))}
                        placeholder="sk-..."
                        className="h-9 pr-16 text-sm"
                      />
                      <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => setShowApiKey(v => !v)}
                          title={showApiKey ? '隐藏' : '显示'}
                          className="flex size-7 cursor-pointer items-center justify-center rounded-[6px] text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
                        >
                          {showApiKey ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={copyApiKey}
                          title="复制"
                          className="flex size-7 cursor-pointer items-center justify-center rounded-[6px] text-text-3 transition-colors hover:bg-bg-hover hover:text-text-1"
                        >
                          <Copy size={14} />
                        </button>
                      </div>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-1">配置描述</span>
                    <div className="relative">
                      <Textarea
                        value={cfgForm.description}
                        maxLength={200}
                        onChange={e => setCfgForm(f => ({ ...f, description: e.target.value }))}
                        placeholder="说明用途或场景，如：适合首尾帧，日常镜头"
                        className="min-h-[96px] rounded-[var(--radius-sm)] border-border bg-bg-input pb-6 text-sm shadow-shadow-xs focus-visible:border-border-focus focus-visible:ring-accent/20"
                      />
                      <span className="pointer-events-none absolute bottom-2 right-3 text-[11px] tabular-nums text-text-3">
                        {cfgForm.description.length}/200
                      </span>
                    </div>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-1">
                      Base URL <span className="text-error">*</span>
                    </span>
                    <div className="relative">
                      <Input
                        value={cfgForm.base_url}
                        onChange={e => setCfgForm(f => ({ ...f, base_url: e.target.value }))}
                        placeholder="https://..."
                        className="h-9 pr-9 font-mono text-sm"
                      />
                      {baseUrlValid ? (
                        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-success">
                          <Check size={15} strokeWidth={2.5} />
                        </span>
                      ) : null}
                    </div>
                    {defaultBaseUrl ? (
                      <div className="mt-0.5 flex flex-col gap-1">
                        <span className="text-[11px] text-text-3">如未填写，系统将使用默认地址</span>
                        <button
                          type="button"
                          onClick={() => setCfgForm(f => ({ ...f, base_url: defaultBaseUrl }))}
                          title="点击填入默认地址"
                          className="flex w-full items-center gap-1.5 rounded-[var(--radius-sm)] border border-border/60 bg-bg-2 px-2.5 py-1.5 text-left text-[11px] text-text-2 transition-colors hover:border-accent/40 hover:text-text-0"
                        >
                          <span className="text-text-3">默认地址</span>
                          <span className="truncate font-mono text-accent-text">{defaultBaseUrl}</span>
                        </button>
                      </div>
                    ) : null}
                  </label>

                  <label className="flex flex-col gap-1.5 sm:col-span-2">
                    <span className="text-xs font-semibold text-text-1">
                      模型 ID <span className="text-error">*</span>
                    </span>
                    <Input
                      value={cfgForm.modelStr}
                      onChange={e => setCfgForm(f => ({ ...f, modelStr: e.target.value }))}
                      placeholder="请输入模型 ID，如：ep-20260316174217-nhvxp"
                      className="h-9 font-mono text-sm"
                    />
                    <span className="text-[11px] text-text-3">每条配置对应一个模型；多模型请分别添加配置</span>
                  </label>
                </div>

                <div className="mt-1">
                  <Button
                    variant="outline"
                    className="h-9 border-accent/40 text-accent-text hover:bg-accent-bg"
                    onClick={testDraft}
                    disabled={cfgTesting}
                  >
                    {cfgTesting ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={14} />}
                    测试连接
                  </Button>
                </div>
              </DialogMain>
            </div>

            <DialogActions density="compact" className="sm:justify-end">
              <Button variant="outline" className="h-9" onClick={() => setCfgDialog(false)}>
                取消
              </Button>
              <Button className="h-9" onClick={saveCfg} disabled={saving}>
                {saving ? <Loader2 size={12} className="animate-spin" /> : null}
                保存
              </Button>
            </DialogActions>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function isConfigEnabled(config: Pick<AIServiceConfig, 'is_active'>) {
  return Number(config.is_active) === 1
}
