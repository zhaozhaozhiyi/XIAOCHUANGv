'use client'

import { useState, useCallback, useEffect } from 'react'
import { ChevronDown, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { agentConfigAPI, aiConfigAPI } from '@/lib/api'
import { BaseSelect } from '@/components/shared/base-select'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AGENT_DEFS } from './settings-data'
import type { AgentConfig, AIServiceConfig } from '@/types/api'

const DEFAULT_PROMPTS: Record<string, string> = {
  script_rewriter: `你是专业编剧，擅长将小说改编为短剧剧本。

工作流程：
1. 调用 read_episode_script 读取原始内容
2. 根据读取到的内容，自己进行改写（输出格式化剧本格式）
3. 调用 save_script 保存改写后的完整剧本

格式化剧本格式：
- 场景头：## S编号 | 内景/外景 · 地点 | 时间段
- 动作描写：自然段落，不包含镜头语言
- 对白：角色名：（状态/表情）台词内容
- 每个场景 30-60 秒内容`,
  extractor: `你是制片助理，擅长从剧本中提取角色和场景信息，并在提取时与项目已有数据进行智能去重。

工作流程：
1. 调用 read_script_for_extraction 读取格式化剧本
2. 调用 read_existing_characters 读取项目中已存在的角色列表（用于去重）
3. 调用 read_existing_scenes 读取项目中已存在的场景列表（用于去重）
4. 分析剧本内容，提取所有角色信息
5. 对每个角色：若同名已存在则合并更新，若不存在则新增
6. 调用 save_dedup_characters 保存角色（去重合并，自动处理新增和更新）
7. 分析剧本内容，提取所有场景信息
8. 对每个场景：若同地点+时间段已存在则复用，若不存在则新增
9. 调用 save_dedup_scenes 保存场景（去重合并，自动处理新增和复用）

去重规则：
- 角色：按名字精确匹配，同名保留现有（合并信息）
- 场景：按【地点+时间段】精确匹配；同地点不同时段视为新场景

提取要求：
- 角色要包含完整的外貌特征描述（发型、服装、体态等）
- 场景要包含光线、色调、氛围等视觉信息
- 不要遗漏任何有台词或重要动作的角色`,
  storyboard_breaker: `你是资深影视分镜师，擅长将剧本拆解为分镜方案。

工作流程：
1. 调用 read_storyboard_context 读取剧本、角色列表、场景列表
2. 将剧本拆解为镜头序列（每个镜头 10-15 秒，总体保持剧情完整连续）
3. 为每个镜头补全完整分镜字段，而不只是 video_prompt
4. 调用 save_storyboards 保存所有分镜

硬性要求：
- 你必须调用 save_storyboards 才算完成任务
- 保存时 storyboards 至少 1 条，禁止传空数组
- 不能只写 description 或只写 video_prompt，必须给出可直接进入图片、视频、配音、音效流程的完整分镜

每个镜头必须尽量完整填写以下字段：
- title：3-8 字镜头标题
- shot_type：景别，如全景/中景/近景/特写
- angle：机位角度，如平视/仰视/俯视/侧拍
- movement：运镜，如固定/推镜/拉镜/摇镜/跟拍
- location：镜头地点，应与 scenes 中已有地点保持一致
- time：时间段，应与 scenes 中已有时间保持一致
- character_ids：当前镜头涉及的角色 ID 列表，可以为空，也可以包含多个角色；必须从 characters 中选择
- action：角色动作与表演
- dialogue：该镜头实际发生的对白或旁白；旁白可写为“旁白：内容”
- description：镜头概述，用于前端阅读和镜头编辑
- result：该镜头结束时的画面结果或状态变化
- atmosphere：氛围、光线、色调、环境感受
- image_prompt：用于首帧/尾帧/镜头图片生成的静态画面提示词
- video_prompt：用于视频生成的动态提示词
- bgm_prompt：该镜头适合的配乐风格
- sound_effect：该镜头关键音效
- duration：时长，优先 10-15 秒
- scene_id：若可匹配到 scenes 中已有场景，必须填写正确 scene_id

视频提示词格式：
- 按 3 秒为一段，用时间标记分隔
- 使用 <location>地点</location> 标记场景
- 使用 <role>角色名</role> 标记角色
- 使用 <voice>角色名</voice> 标记画外音
- 用 <n> 分隔不同时间段

额外要求：
- 优先复用 read_storyboard_context 返回的 scene_id，不要凭空创造新场景
- 镜头角色绑定必须来自 read_storyboard_context 返回的角色列表；无角色的空镜头可传空数组
- 镜头描述必须能支撑后续图片、视频、配音、音效、合成流程
- 若一个镜头没有对白，可将 dialogue 置空，但 description / action / atmosphere / image_prompt / video_prompt / bgm_prompt / sound_effect 仍必须完整
- 如果已有 existing_storyboards，仅在用户明确要求增量修改时参考；默认按当前剧本重新完整生成并保存整集分镜。`,
  voice_assigner: `你是配音导演，擅长为角色选择合适的音色。

工作流程：
1. 调用 list_voices 获取可用音色列表
2. 调用 get_characters 获取所有角色信息
3. 根据每个角色的性别、性格、年龄、角色定位，选择最匹配的音色
4. 对每个角色调用 assign_voice 分配音色，并说明选择理由

注意：每个角色都必须分配音色，不要遗漏。`,
  grid_prompt_generator: `你是专业的 AI 图像提示词工程师，擅长为角色、场景和宫格图生成高质量的英文提示词。

你将收到用户的请求，告知要生成哪种类型的提示词：
- "角色" → 生成角色图片提示词
- "场景" → 生成场景图片提示词
- "宫格" → 生成宫格图提示词`,
}

export function AgentsTab() {
  const [agentCfgs, setAgentCfgs] = useState<AgentConfig[]>([])
  const [textConfigs, setTextConfigs] = useState<AIServiceConfig[]>([])
  const [editingAgent, setEditingAgent] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedId, setSavedId] = useState<string | null>(null)
  const [form, setForm] = useState({ model: '', temperature: 0.7, max_tokens: 4096, system_prompt: '' })

  const load = useCallback(async () => {
    try {
      const [agents, texts] = await Promise.all([
        agentConfigAPI.list() as unknown as AgentConfig[],
        aiConfigAPI.list('text') as unknown as AIServiceConfig[],
      ])
      setAgentCfgs(agents || [])
      setTextConfigs(texts || [])
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load])

  function getAgentCfg(type: string) {
    return agentCfgs.find(a => a.agent_type === type)
  }

  function toggleEdit(type: string) {
    if (editingAgent === type) {
      setEditingAgent(null)
    } else {
      const cfg = getAgentCfg(type)
      setForm({
        model: cfg?.model || '',
        temperature: cfg?.temperature ?? 0.7,
        max_tokens: cfg?.max_tokens ?? 4096,
        system_prompt: cfg?.system_prompt || DEFAULT_PROMPTS[type] || '',
      })
      setEditingAgent(type)
    }
  }

  async function save(type: string) {
    setSaving(true)
    try {
      const existing = getAgentCfg(type)
      if (existing) {
        await agentConfigAPI.update(existing.id, form)
      } else {
        await agentConfigAPI.create({ agent_type: type, ...form })
      }
      toast.success('已保存')
      setSavedId(type)
      setTimeout(() => setSavedId(null), 2000)
      load()
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function reset(type: string) {
    setForm(f => ({ ...f, system_prompt: DEFAULT_PROMPTS[type] || '' }))
  }

  const textModelOptions = textConfigs.map(c => ({
    label: `${c.name || c.provider} · ${c.model}`,
    value: c.model || '',
  }))

  return (
    <div className="page-shell animate-fade-up flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border pb-4">
        <h2 className="page-title mb-2">Agent 配置</h2>
        <p className="page-subtitle">调整模型、提示词和参数，保存后立即生效。</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pt-5">
        <div className="space-y-3 max-w-[760px]">
        {AGENT_DEFS.map(a => {
          const cfg = getAgentCfg(a.type)
          const isEditing = editingAgent === a.type
          return (
            <div key={a.type} className="rounded-[14px] bg-bg-0 border border-border overflow-hidden">
              <button className="w-full flex items-center gap-3 p-4 cursor-pointer hover:bg-bg-hover transition-colors text-left" onClick={() => toggleEdit(a.type)}>
                <span className="text-lg w-8 h-8 flex items-center justify-center">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-text-0">{a.label}</div>
                  <div className="text-[11px] text-text-3">{a.type}</div>
                </div>
                {cfg ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-success-bg text-success shrink-0">已配置</span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-bg-2 text-text-3 shrink-0">默认</span>
                )}
                <ChevronDown size={14} className={`text-text-3 transition-transform shrink-0 ${isEditing ? 'rotate-180' : ''}`} />
              </button>

              {isEditing && (
                <div className="px-4 pb-4 border-t border-border pt-4 flex flex-col gap-4">
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-1">模型 <span className="text-text-3 font-normal">(留空使用 AI 服务默认)</span></span>
                    <BaseSelect value={form.model} onValueChange={v => setForm(f => ({ ...f, model: String(v) }))} options={textModelOptions} placeholder="— 使用 AI 服务默认 —" />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-text-1">Temperature</span>
                      <input type="number" min={0} max={2} step={0.1} value={form.temperature}
                        onChange={e => setForm(f => ({ ...f, temperature: Number(e.target.value) }))}
                        className="px-2.5 py-[7px] text-xs border border-border rounded-[8px] bg-bg-input focus:border-border-focus focus:outline-none" />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-semibold text-text-1">Max Tokens</span>
                      <input type="number" min={100} max={32000} value={form.max_tokens}
                        onChange={e => setForm(f => ({ ...f, max_tokens: Number(e.target.value) }))}
                        className="px-2.5 py-[7px] text-xs border border-border rounded-[8px] bg-bg-input focus:border-border-focus focus:outline-none" />
                    </label>
                  </div>
                  <label className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-1">System Prompt</span>
                    <Textarea value={form.system_prompt}
                      onChange={e => setForm(f => ({ ...f, system_prompt: e.target.value }))}
                      rows={12} className="text-xs font-mono" placeholder="Agent 系统提示词..." />
                  </label>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={() => reset(a.type)}>恢复默认</Button>
                    {savedId === a.type && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-success-bg text-success flex items-center gap-1">
                        <Check size={10} /> 已保存
                      </span>
                    )}
                    <Button size="sm" className="ml-auto" disabled={saving} onClick={() => save(a.type)}>
                      {saving ? <Loader2 size={12} className="animate-spin" /> : null} 保存
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}
