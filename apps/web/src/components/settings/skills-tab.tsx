'use client'

import { useState, useCallback, useEffect } from 'react'
import { Plus, Trash2, FileText, ChevronDown, Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { skillsAPI } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { Dialog, DialogActions, DialogContent, DialogHeaderBar, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { AGENT_DEFS } from './settings-data'

interface Skill {
  id: string
  name: string
  description?: string
}

const SKILL_DIR_NAME_PATTERN = /^[A-Za-z0-9_-]+$/

export function SkillsTab() {
  const [selectedAgent, setSelectedAgent] = useState(AGENT_DEFS[0].type)
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [editingSkill, setEditingSkill] = useState<string | null>(null)
  const [skillContent, setSkillContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [addDialog, setAddDialog] = useState(false)
  const [newSkill, setNewSkill] = useState({ id: '', name: '', description: '' })
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)
  const [deleteLoading, setDeleteLoading] = useState(false)

  const selectedAgentDef = AGENT_DEFS.find(a => a.type === selectedAgent)!
  const skillDirName = newSkill.id.trim()
  const skillDirNameError = skillDirName && !SKILL_DIR_NAME_PATTERN.test(skillDirName)
    ? '目录名仅支持英文字母、数字、中划线和下划线'
    : ''
  const canCreateSkill = Boolean(skillDirName) && !skillDirNameError

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await skillsAPI.list() as unknown as Skill[]
      setSkills(data || [])
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  const currentSkills = skills.filter(s => s.id.startsWith(`${selectedAgent}/`))

  async function loadSkillContent(id: string) {
    try {
      const content = await skillsAPI.get(id) as unknown as string
      setSkillContent(typeof content === 'string' ? content : JSON.stringify(content))
    } catch {
      setSkillContent('')
    }
  }

  function toggleEdit(id: string) {
    if (editingSkill === id) {
      setEditingSkill(null)
    } else {
      setEditingSkill(id)
      loadSkillContent(id)
    }
  }

  async function saveSkill(id: string) {
    setSaving(true)
    try {
      await skillsAPI.update(id, skillContent)
      toast.success('已保存')
      setSavedId(id)
      setTimeout(() => setSavedId(null), 2000)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeleteSkill() {
    if (!deleteTargetId) return
    try {
      setDeleteLoading(true)
      await skillsAPI.del(deleteTargetId)
      toast.success('已删除')
      setDeleteTargetId(null)
      load()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setDeleteLoading(false)
    }
  }

  async function addSkill() {
    if (!skillDirName) return
    if (skillDirNameError) {
      toast.error(skillDirNameError)
      return
    }
    const fullId = `${selectedAgent}/${skillDirName}`
    try {
      await skillsAPI.create({ id: fullId, name: newSkill.name, description: newSkill.description })
      setAddDialog(false)
      setNewSkill({ id: '', name: '', description: '' })
      toast.success('已创建')
      load()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* Agent List Sidebar */}
      <aside className="w-[200px] shrink-0 border-r border-border bg-bg-0 p-4 overflow-y-auto">
        <div className="text-[10px] font-bold tracking-[0.1em] uppercase text-text-3 mb-3">Agent 列表</div>
        {AGENT_DEFS.map(a => (
          <button key={a.type}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-[8px] text-left text-xs mb-1 cursor-pointer transition-colors ${selectedAgent === a.type ? 'bg-accent-bg text-accent-text font-semibold' : 'hover:bg-bg-hover text-text-2'}`}
            onClick={() => { setSelectedAgent(a.type); setEditingSkill(null) }}
          >
            <span className="text-base">{a.icon}</span>
            <span className="flex-1 min-w-0 truncate">{a.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-2 text-text-3">
              {skills.filter(s => s.id.startsWith(`${a.type}/`)).length}
            </span>
          </button>
        ))}
      </aside>

      {/* Skills Main */}
      <div className="page-shell flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-4 shrink-0 border-b border-border pb-4">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-lg w-8 h-8 flex items-center justify-center">{selectedAgentDef.icon}</span>
            <div>
              <h2 className="font-display text-[22px] font-bold text-text-0">{selectedAgentDef.label}</h2>
              <div className="text-[11px] text-text-3">{selectedAgentDef.type} — Skills</div>
            </div>
          </div>
          <p className="page-subtitle mb-4">Skills 仅作为 Agent 的高级提示词层使用。</p>
          <Button size="sm" onClick={() => setAddDialog(true)}>
            <Plus size={13} /> 新增 Skill
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto pt-2">
          {loading ? (
            <div className="text-sm text-text-3 py-8 text-center">加载中...</div>
          ) : currentSkills.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-border bg-bg-2 py-12 text-center">
              <div className="w-14 h-14 rounded-[14px] bg-bg-2 flex items-center justify-center text-text-3">
                <FileText size={28} strokeWidth={1.3} />
              </div>
              <div className="text-sm font-semibold text-text-1">暂无 Skill</div>
              <div className="text-xs text-text-3">点击右上角「新增 Skill」创建第一个提示词文件</div>
            </div>
          ) : (
            <div className="space-y-3 max-w-[800px]">
              {currentSkills.map(s => {
                const isEditing = editingSkill === s.id
                const relativeId = s.id.replace(`${selectedAgent}/`, '')
                return (
                  <div key={s.id} className="rounded-[14px] bg-bg-0 border border-border overflow-hidden">
                    <button className="w-full flex items-center gap-3 p-4 cursor-pointer hover:bg-bg-hover transition-colors text-left" onClick={() => toggleEdit(s.id)}>
                      <FileText size={14} className="text-accent shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-semibold text-text-0">{s.name}</div>
                        <div className="text-[11px] text-text-3">{s.description}</div>
                      </div>
                      <button
                        type="button"
                        aria-label={`删除 Skill「${s.name}」`}
                        className="p-1 rounded hover:bg-bg-hover shrink-0"
                        onClick={(e) => {
                          e.stopPropagation()
                          setDeleteTargetId(s.id)
                        }}
                      >
                        <Trash2 size={13} className="text-text-3" />
                      </button>
                      <ChevronDown size={14} className={`text-text-3 shrink-0 transition-transform ${isEditing ? 'rotate-180' : ''}`} />
                    </button>

                    {isEditing && (
                      <div className="px-4 pb-4 border-t border-border pt-4 flex flex-col gap-3">
                        <Textarea value={skillContent}
                          onChange={e => setSkillContent(e.target.value)}
                          rows={20}
                          className="text-xs font-mono leading-relaxed"
                          placeholder="编写 SKILL.md 内容..." />
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-text-3">skills/{selectedAgent}/{relativeId}/SKILL.md</span>
                          {savedId === s.id && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-success-bg text-success flex items-center gap-1">
                              <Check size={10} /> 已保存
                            </span>
                          )}
                          <Button size="sm" className="ml-auto" disabled={saving} onClick={() => saveSkill(s.id)}>
                            {saving ? <Loader2 size={12} className="animate-spin" /> : null} 保存
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Add Skill Dialog */}
      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent
          className="flex max-h-[min(90dvh,calc(100dvh-2rem))] w-full max-w-[min(100%-2rem,480px)] flex-col gap-0 overflow-hidden rounded-[var(--radius-xl)] border-border bg-bg-surface p-0 shadow-shadow-elevated animate-scale-in sm:max-w-[480px]"
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            if (canCreateSkill) void addSkill()
          }}
        >
          <DialogTitle className="sr-only">新增 Skill</DialogTitle>
          <DialogHeaderBar className="border-0 bg-transparent p-0">
            <div className="flex gap-3.5 sm:gap-4">
              <div
                className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-accent-glow bg-accent-bg text-accent shadow-shadow-xs sm:size-11"
                aria-hidden
              >
                <Plus className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 pr-8 sm:pr-10">
                <h2 className="font-display text-xl font-bold tracking-tight text-text-0 sm:text-[22px]">
                  新增 Skill
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-text-2">
                  目标 Agent：{selectedAgentDef.label}
                </p>
                <p className="mt-1 text-xs text-text-3">目录名需为英文且全局唯一。</p>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain className="min-h-0 flex-1 w-full items-start justify-start gap-5 border-t border-border/70 px-0 pt-6 pb-2 sm:gap-6 sm:pt-7 sm:pb-3">
            <label className="flex w-full flex-col gap-2">
              <span className="text-xs font-semibold text-text-1">
                Skill 目录名 <span className="font-normal text-text-3">(英文，唯一)</span>
              </span>
              <Input
                value={newSkill.id}
                onChange={e => setNewSkill(f => ({ ...f, id: e.target.value }))}
                placeholder="如 custom-extraction"
                aria-invalid={Boolean(skillDirNameError)}
                aria-describedby="skill-dir-name-help"
                className="h-11 text-sm"
              />
              <span id="skill-dir-name-help" className={`text-xs ${skillDirNameError ? 'text-red-500' : 'text-text-3'}`}>
                {skillDirNameError || '仅支持英文字母、数字、中划线和下划线'}
              </span>
            </label>
            <label className="flex w-full flex-col gap-2">
              <span className="text-xs font-semibold text-text-1">名称</span>
              <Input
                value={newSkill.name}
                onChange={e => setNewSkill(f => ({ ...f, name: e.target.value }))}
                placeholder="如 自定义提取规则"
                className="h-11 text-sm"
              />
            </label>
            <label className="flex w-full flex-col gap-2">
              <span className="text-xs font-semibold text-text-1">描述</span>
              <Input
                value={newSkill.description}
                onChange={e => setNewSkill(f => ({ ...f, description: e.target.value }))}
                placeholder="简短描述此 Skill 的用途"
                className="h-11 text-sm"
              />
            </label>
          </DialogMain>

          <DialogActions className="flex-col-reverse gap-3 px-0 pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <Button variant="ghost" className="h-10 w-full sm:w-auto sm:min-w-[88px]" onClick={() => setAddDialog(false)}>
              取消
            </Button>
            <Button className="h-10 w-full rounded-full px-6 shadow-primary-glow sm:w-auto sm:min-w-[148px]" onClick={addSkill} disabled={!canCreateSkill}>
              创建
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTargetId)}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null)
        }}
        title="删除 Skill"
        description={deleteTargetId ? `确定删除 skill「${deleteTargetId}」？` : ''}
        confirmLabel="删除"
        loading={deleteLoading}
        onConfirm={confirmDeleteSkill}
      />
    </div>
  )
}
