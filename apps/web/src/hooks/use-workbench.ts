import { create } from 'zustand'
import { toast } from 'sonner'
import {
  dramaAPI, episodeAPI, storyboardAPI, characterAPI,
  sceneAPI, imageAPI, videoAPI, composeAPI,
  mergeAPI, voicesAPI, aiConfigAPI, taskAPI,
} from '@/lib/api'
import { getEffectiveEpisodeConfigId, getProjectDefaults } from '@/lib/drama-metadata'
import { getStoryboardTtsDialogue } from '@/lib/dialogue'
import { fetchSSE } from '@/lib/sse'
import type { Drama, Episode, Character, Scene, Storyboard, AIVoice, AIServiceConfig, EpisodeComposeStatusResponse, EpisodeMergeStatusResponse, TaskRecord } from '@/types/api'

// ============ Pipeline Steps ============
export const PIPELINE_STEPS = [
  { key: 'script-raw', section: 'script', label: '原始内容', done: false },
  { key: 'script-rewrite', section: 'script', label: 'AI 改写', done: false },
  { key: 'script-extract', section: 'script', label: '提取角色场景', done: false },
  { key: 'script-voice', section: 'script', label: '分配音色', done: false },
  { key: 'script-storyboard', section: 'script', label: '分镜列表', done: false },
  { key: 'prod-chars', section: 'production', label: '角色形象', done: false },
  { key: 'prod-scenes', section: 'production', label: '场景图', done: false },
  { key: 'prod-dubbing', section: 'production', label: '配音', done: false },
  { key: 'prod-shots', section: 'production', label: '镜头图', done: false },
  { key: 'prod-videos', section: 'production', label: '视频', done: false },
  { key: 'prod-compose', section: 'production', label: '合成', done: false },
]

export const SIDEBAR_SECTIONS = [
  {
    id: 'script', label: '剧本',
    items: [
      { key: 'script-raw', label: '原始内容', section: 'script' },
      { key: 'script-rewrite', label: 'AI 改写', section: 'script' },
      { key: 'script-extract', label: '提取角色场景', section: 'script' },
      { key: 'script-voice', label: '分配音色', section: 'script' },
      { key: 'script-storyboard', label: '分镜列表', section: 'script' },
    ],
  },
  {
    id: 'production', label: '制作',
    items: [
      { key: 'prod-chars', label: '角色形象', section: 'production' },
      { key: 'prod-scenes', label: '场景图', section: 'production' },
      { key: 'prod-dubbing', label: '配音', section: 'production' },
      { key: 'prod-shots', label: '镜头图', section: 'production' },
      { key: 'prod-videos', label: '视频', section: 'production' },
      { key: 'prod-compose', label: '合成', section: 'production' },
    ],
  },
  {
    id: 'export', label: '导出',
    items: [
      { key: 'export-merge', label: '合并成片', section: 'export' },
    ],
  },
]

const SCRIPT_STEP_MAP: Record<string, number> = {
  'script-raw': 0,
  'script-rewrite': 1,
  'script-extract': 2,
  'script-voice': 3,
  'script-storyboard': 4,
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const SAVE_STORYBOARDS_TOOL_NAMES = new Set(['save_storyboards', 'saveStoryboards'])
const STORYBOARD_POLL_INTERVAL_MS = 3000
const STORYBOARD_POLL_ATTEMPTS = 30
const ACTIVE_TASK_STATUSES = new Set(['queued', 'running'])

function formatWorkbenchError(error: unknown) {
  return error instanceof Error ? error.message : String(error || '操作失败')
}

function toastWorkbenchError(title: string, error: unknown, details?: Array<string | null | undefined>) {
  const description = details?.map((item) => String(item || '').trim()).filter(Boolean).join(' · ')
  toast.error(`${title}失败`, {
    description: [formatWorkbenchError(error), description].filter(Boolean).join(' · '),
  })
}

function hasSaveStoryboardsTool(called: string[]) {
  return called.some((name) => SAVE_STORYBOARDS_TOOL_NAMES.has(String(name || '').trim()))
}

function resolveWorkbenchAiTaskType(task: TaskRecord) {
  const skillId = task.payload?.skill_id
  return typeof skillId === 'string' && skillId.trim() ? skillId.trim() : 'drama_ai_skill'
}

function formatRecoveredAiTaskNote(task: TaskRecord) {
  const statusText = task.status === 'queued' ? '排队中' : '处理中'
  return `${task.title || '短剧 AI 任务'}${statusText ? ` · ${statusText}` : ''}`
}

export function isNarratorCharacter(char: Pick<Character, 'name' | 'role'> | null | undefined) {
  const text = `${char?.name || ''} ${char?.role || ''}`.toLowerCase()
  return text.includes('旁白') || text.includes('narrator') || text.includes('画外音')
}

export function isVisualCharacter(char: Pick<Character, 'name' | 'role'> | null | undefined) {
  return !isNarratorCharacter(char)
}

export function hasCompleteShotFrames(storyboard: Pick<Storyboard, 'first_frame_image' | 'last_frame_image' | 'composed_image'>) {
  return !!storyboard.composed_image || (!!storyboard.first_frame_image && !!storyboard.last_frame_image)
}

function getStoryboardCharacterIds(sb: Storyboard): number[] {
  const explicitIds = (sb as Storyboard & { character_ids?: number[] }).character_ids
  if (Array.isArray(explicitIds)) return explicitIds
  return (sb.characters || []).map((character) => character.id).filter(Boolean)
}

function getStoryboardReferenceImages(sb: Storyboard): string[] {
  const raw = sb.reference_images
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map((item) => String(item || '').trim()).filter(Boolean) : []
  } catch {
    return []
  }
}

function buildShotReferenceImages(sb: Storyboard, scenes: Scene[], characters: Character[]): string[] {
  const refs: string[] = []
  const pushRef = (value: string | null | undefined) => {
    const ref = String(value || '').trim()
    if (!ref || refs.includes(ref) || refs.length >= 6) return
    refs.push(ref)
  }

  const scene = scenes.find((item) => item.id === sb.scene_id)
  pushRef(scene?.image_url)

  for (const charId of getStoryboardCharacterIds(sb)) {
    const character = characters.find((item) => item.id === charId)
    pushRef(character?.image_url)
  }

  for (const ref of getStoryboardReferenceImages(sb)) pushRef(ref)
  return refs
}

function buildShotImagePrompt(sb: Storyboard, frameType: string, scenes: Scene[]): string {
  const scene = scenes.find((item) => item.id === sb.scene_id)
  const title = sb.title || ''
  const description = sb.image_prompt || sb.description || ''
  const shotType = sb.shot_type || ''
  const angle = sb.angle || ''
  const movement = sb.movement || ''
  const location = sb.location || scene?.location || ''
  const time = sb.time || scene?.time || ''
  const charactersText = (sb.characters || []).map((character) => character.name).filter(Boolean).join('、')
  const action = sb.action || ''
  const atmosphere = sb.atmosphere || ''
  const frameHint = frameType === 'first_frame'
    ? '生成这个镜头的起始关键帧，突出建立关系和动作开始瞬间'
    : '生成这个镜头的结束关键帧，必须表现动作完成后的不同画面，人物姿态、位置或情绪落点要和起始关键帧明显不同'

  return [
    title ? `镜头标题：${title}` : '',
    description ? `画面描述：${description}` : '',
    shotType ? `景别：${shotType}` : '',
    angle ? `机位：${angle}` : '',
    movement ? `运镜：${movement}` : '',
    charactersText ? `角色：${charactersText}` : '',
    location ? `地点：${location}` : '',
    time ? `时间：${time}` : '',
    action ? `动作：${action}` : '',
    atmosphere ? `氛围：${atmosphere}` : '',
    frameHint,
    '画面中不要出现文字、字幕、对话气泡、水印',
  ].filter(Boolean).join('；')
}

function buildNoDialogueShotVideoPrompt(sb: Storyboard): string {
  return [
    sb.video_prompt || sb.description || sb.action || '',
    '不要生成任何音频、人声、对白、旁白、歌声、角色说话声或口型配音',
    '画面中不要出现字幕、文字、对话气泡、水印',
    '如果人物需要说话，只表现表情、姿态和镜头动作',
  ].filter(Boolean).join('；')
}

function getConfigModel(config: AIServiceConfig) {
  const rawValue = config.model as unknown
  if (Array.isArray(rawValue)) return String(rawValue[0] || '').trim()

  const raw = String(rawValue || '').trim()
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return String(parsed[0] || '').trim()
  } catch {
    return raw
  }
  return raw
}

function formatConfig(config: AIServiceConfig, serviceLabel: string) {
  const model = getConfigModel(config)
  const name = config.name || `${serviceLabel}配置`
  const provider = config.provider ? ` · ${config.provider}` : ''
  return model ? `${name} · ${model}${provider}` : `${name}${provider}`
}

function findRuntimeDefaultConfig(configs: AIServiceConfig[], serviceType: string) {
  return configs
    .filter((item) => item.service_type === serviceType && Number(item.is_active) === 1)
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0]
}

function formatConfigLabel(
  configId: number | null | undefined,
  configs: AIServiceConfig[],
  serviceType: 'image' | 'video' | 'audio',
  serviceLabel: string,
  sourceLabel?: string,
) {
  if (!configId) {
    const defaultConfig = findRuntimeDefaultConfig(configs, serviceType)
    return defaultConfig ? `默认：${formatConfig(defaultConfig, serviceLabel)}` : '默认配置'
  }

  const config = configs.find((item) => item.id === configId)
  if (!config) return `配置 #${configId}`

  return sourceLabel ? `${sourceLabel}：${formatConfig(config, serviceLabel)}` : formatConfig(config, serviceLabel)
}

// Workbench-side dispatcher for skill calls. The backend mirror of this
// map is apps/backend/src/modules/ai/ai.service.ts SKILL_HANDLERS; every
// skill that appears below must have a registered handler there.
//
// All five workbench skills now go through /api/v1/ai/runs (the unified
// skill runtime). The legacy /api/v1/agent/:type/chat path is gone — it
// used to handle grid_prompt_generator, but the grid handler now lives
// in apps/backend/src/modules/ai/skill-handlers/grid-prompt.handler.ts
// and the SSE payload shape ({ status / done.payload }) is identical.
const WORKBENCH_SKILLS = {
  extractor:              { skill_id: 'extractor',              mode: 'extract'     },
  voice_assigner:         { skill_id: 'voice_assigner',         mode: 'assign'      },
  storyboard_breaker:     { skill_id: 'storyboard_breaker',     mode: 'breakdown'   },
  script_rewriter:        { skill_id: 'script_rewriter',        mode: 'rewrite'     },
  grid_prompt_generator:  { skill_id: 'grid_prompt_generator',  mode: 'grid_prompt' },
} as const

type WorkbenchSkillType = keyof typeof WORKBENCH_SKILLS

async function runAgentStream(params: {
  type: WorkbenchSkillType
  message: string
  dramaId: number
  episodeId: number
  // Extra input fields (used by grid_prompt_generator for storyboard_ids/rows/cols/mode)
  input?: Record<string, unknown>
  scene?: string
  onDelta?: (text: string) => void
  onStatus?: (text: string) => void
}) {
  const skill = WORKBENCH_SKILLS[params.type]
  if (!skill) throw new Error(`Unknown workbench skill: ${params.type}`)
  const toolsCalled: string[] = []
  const statuses: string[] = []
  const startedAt = Date.now()

  await fetchSSE({
    url: '/api/v1/ai/runs?stream=1',
    method: 'POST',
    body: {
      skill_id: skill.skill_id,
      mode: skill.mode,
      scene: params.scene ?? 'workbench',
      target: { type: 'episode', drama_id: params.dramaId, episode_id: params.episodeId },
      input: { message: params.message, selection: null, ...(params.input || {}) },
      options: { stream: true },
    },
    onEvent: (evt) => {
      if (!evt.data) return
      const payload = JSON.parse(evt.data) as {
        type?: string
        text?: string
        message?: string
        tool?: string
        tools_called?: string[]
      }
      if (payload.type === 'delta' && payload.text) params.onDelta?.(payload.text)
      if (payload.type === 'status' && payload.text) {
        statuses.push(payload.text)
        params.onStatus?.(payload.text)
      }
      if (payload.type === 'tool_call' && payload.tool) toolsCalled.push(payload.tool)
      if (payload.type === 'done' && Array.isArray(payload.tools_called)) {
        toolsCalled.splice(0, toolsCalled.length, ...payload.tools_called)
      }
      if (payload.type === 'error') {
        throw new Error(`${payload.message || 'Skill 执行失败'}（${skill.skill_id}/${skill.mode}）`)
      }
    },
  })
  const durationMs = Date.now() - startedAt
  console.info('[WorkbenchAI]', {
    skill_id: skill.skill_id,
    mode: skill.mode,
    drama_id: params.dramaId,
    episode_id: params.episodeId,
    duration_ms: durationMs,
    tools_called: toolsCalled,
    last_status: statuses[statuses.length - 1] || null,
  })
  return { toolsCalled, statuses, durationMs }
}

async function waitForStoryboards(episodeId: number) {
  for (let attempt = 0; attempt < STORYBOARD_POLL_ATTEMPTS; attempt += 1) {
    const storyboards = await episodeAPI.storyboards(episodeId)
    if ((storyboards || []).length > 0) return storyboards || []
    await sleep(STORYBOARD_POLL_INTERVAL_MS)
  }
  return []
}

interface WorkbenchState {
  // Core data
  drama: Drama | null
  episode: Episode | null
  characters: Character[]
  scenes: Scene[]
  storyboards: Storyboard[]
  voices: AIVoice[]
  // Panel state
  panel: 'script' | 'production' | 'export'
  scriptStep: number
  prodTab: string
  // Pending states
  pendingCharImages: Set<number>
  pendingVoiceSamples: Set<number>
  pendingSceneImages: Set<number>
  pendingShotFrames: Map<number, string>
  pendingVideos: Set<number>
  pendingComposes: Set<number>
  // Merge status
  mergeStatus: unknown
  mergeUrl: string | null
  // Selected
  selectedStoryboard: Storyboard | null
  // Local script edits
  localRaw: string
  localScript: string
  // Image viewer
  viewerOpen: boolean
  viewerSrc: string
  viewerTitle: string
  // Config labels
  lockedImageConfigLabel: string
  lockedVideoConfigLabel: string
  lockedAudioConfigLabel: string
  // Agent running
  running: boolean
  runningType: string | null
  runningNote: string
  // Actions
  reset: () => void
  loadAll: (dramaId: number, episodeNumber: number) => Promise<void>
  goSubStep: (key: string) => void
  setLocalRaw: (v: string) => void
  setLocalScript: (v: string) => void
  saveRaw: (options?: { silent?: boolean }) => Promise<void>
  doRewrite: () => Promise<void>
  skipRewrite: () => Promise<void>
  doExtract: () => Promise<void>
  doVoice: () => Promise<void>
  batchVoiceSamples: () => Promise<void>
  genVoiceSample: (id: number) => Promise<void>
  doBreakdown: () => Promise<void>
  updateCharVoice: (id: number, voice: string) => Promise<void>
  genCharImg: (id: number) => Promise<void>
  batchCharImages: () => Promise<void>
  genSceneImg: (id: number) => Promise<void>
  batchSceneImages: () => Promise<void>
  genShotTTS: (sb: Storyboard) => Promise<void>
  batchShotTTS: () => Promise<void>
  genShotFrame: (sb: Storyboard, frameType: string) => Promise<void>
  genShotVideo: (sb: Storyboard) => Promise<void>
  batchShotVideos: () => Promise<void>
  composeShot: (sb: Storyboard) => Promise<void>
  batchCompose: () => Promise<void>
  mergeEpisode: () => Promise<void>
  pollMergeStatus: () => Promise<void>
  updateField: (sb: Storyboard, field: string, value: unknown) => Promise<void>
  toggleStoryboardCharacter: (sb: Storyboard, charId: number) => Promise<void>
  pendingDeleteStoryboard: Storyboard | null
  requestDeleteShot: (sb: Storyboard) => void
  confirmDeleteShot: () => Promise<void>
  cancelDeleteShot: () => void
  openImageViewer: (src: string, title?: string) => void
  closeImageViewer: () => void
  // Computed
  pipelineProgress: () => number
  charsVoiced: () => number
  totalDuration: () => number
}

const initialState = {
  drama: null,
  episode: null,
  characters: [],
  scenes: [],
  storyboards: [],
  voices: [],
  panel: 'script' as const,
  scriptStep: 0,
  prodTab: 'chars',
  pendingCharImages: new Set<number>(),
  pendingVoiceSamples: new Set<number>(),
  pendingSceneImages: new Set<number>(),
  pendingShotFrames: new Map<number, string>(),
  pendingVideos: new Set<number>(),
  pendingComposes: new Set<number>(),
  mergeStatus: null,
  mergeUrl: null,
  selectedStoryboard: null,
  localRaw: '',
  localScript: '',
  viewerOpen: false,
  viewerSrc: '',
  viewerTitle: '',
  lockedImageConfigLabel: '',
  lockedVideoConfigLabel: '',
  lockedAudioConfigLabel: '',
  running: false,
  runningType: null,
  runningNote: '',
  pendingDeleteStoryboard: null,
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  ...initialState,

  reset: () => set({ ...initialState }),

  loadAll: async (dramaId: number, episodeNumber: number) => {
    try {
      const [d, voices, aiConfigsResult] = await Promise.all([
        dramaAPI.get(dramaId),
        voicesAPI.list(),
        aiConfigAPI.list(),
      ])
      const aiConfigs = Array.isArray(aiConfigsResult) ? aiConfigsResult : []
      const ep = d.episodes?.find((episode: Episode) => episode.episode_number === episodeNumber)
      if (!ep) { toast.error('未找到该集'); return }

      let sbs: Storyboard[] = []
      let epChars: Character[] = []
      let epScenes: Scene[] = []
      let mergeInfo: EpisodeMergeStatusResponse | null = null
      let activeAiTask: TaskRecord | null = null
      if (ep.id) {
        const [storyboards, characters, scenes, aiTasks] = await Promise.all([
          episodeAPI.storyboards(ep.id),
          episodeAPI.characters(ep.id),
          episodeAPI.scenes(ep.id),
          taskAPI.list({
            page_size: 10,
            source_type: 'drama_ai_skill',
            drama_id: dramaId,
            episode_id: ep.id,
            status: 'queued,running',
            sort: 'updated_at',
          }).catch((error: unknown) => {
            console.warn('[Workbench] AI task status unavailable during loadAll', error)
            return null
          }),
        ])
        const mergeStatus = await mergeAPI.status(ep.id).catch((error: unknown) => {
          console.warn('[Workbench] merge status unavailable during loadAll', error)
          return null
        })
        sbs = storyboards || []
        epChars = characters || []
        epScenes = scenes || []
        mergeInfo = mergeStatus || null
        activeAiTask = aiTasks?.items?.find((task) => ACTIVE_TASK_STATUSES.has(String(task.status || ''))) || null
      }

      const mergeUrl = mergeInfo?.merged_url || ep.video_url || null
      const projectDefaults = getProjectDefaults(d)
      const effectiveImageConfigId = getEffectiveEpisodeConfigId(d, ep, 'image')
      const effectiveVideoConfigId = getEffectiveEpisodeConfigId(d, ep, 'video')
      const effectiveAudioConfigId = getEffectiveEpisodeConfigId(d, ep, 'audio')
      const imageSourceLabel = ep.image_config_id ? '本集' : projectDefaults.image_config_id ? '项目' : undefined
      const videoSourceLabel = ep.video_config_id ? '本集' : projectDefaults.video_config_id ? '项目' : undefined
      const audioSourceLabel = ep.audio_config_id ? '本集' : projectDefaults.audio_config_id ? '项目' : undefined
      const visualCharacters = epChars.filter(isVisualCharacter)
      const ttsEligible = sbs.filter((sb) => !!getStoryboardTtsDialogue(sb))
      const nextNav = (() => {
        if (mergeUrl) return { panel: 'export' as const, scriptStep: 4, prodTab: 'compose' }
        if (sbs.length > 0) {
          if (visualCharacters.some((character) => !character.image_url)) return { panel: 'production' as const, scriptStep: 4, prodTab: 'chars' }
          if (epScenes.some((scene) => !scene.image_url)) return { panel: 'production' as const, scriptStep: 4, prodTab: 'scenes' }
          if (ttsEligible.some((storyboard) => !storyboard.tts_audio_url)) return { panel: 'production' as const, scriptStep: 4, prodTab: 'dubbing' }
          if (sbs.some((storyboard) => !hasCompleteShotFrames(storyboard))) return { panel: 'production' as const, scriptStep: 4, prodTab: 'shots' }
          if (sbs.some((storyboard) => !storyboard.video_url)) return { panel: 'production' as const, scriptStep: 4, prodTab: 'videos' }
          if (sbs.some((storyboard) => !storyboard.composed_video_url)) return { panel: 'production' as const, scriptStep: 4, prodTab: 'compose' }
          return { panel: 'export' as const, scriptStep: 4, prodTab: 'compose' }
        }
        if (ep.script_content && epChars.length && epChars.every((character) => !!character.voice_style)) {
          return { panel: 'script' as const, scriptStep: 4, prodTab: 'chars' }
        }
        if (ep.script_content && epChars.length) return { panel: 'script' as const, scriptStep: 3, prodTab: 'chars' }
        if (ep.script_content) return { panel: 'script' as const, scriptStep: 2, prodTab: 'chars' }
        if (ep.content) return { panel: 'script' as const, scriptStep: 1, prodTab: 'chars' }
        return { panel: 'script' as const, scriptStep: 0, prodTab: 'chars' }
      })()

      set({
        drama: d,
        episode: ep,
        characters: epChars,
        scenes: epScenes,
        storyboards: sbs,
        voices: voices || [],
        localRaw: ep.content || '',
        localScript: ep.script_content || '',
        mergeStatus: mergeInfo,
        mergeUrl,
        panel: nextNav.panel,
        scriptStep: nextNav.scriptStep,
        prodTab: nextNav.prodTab,
        lockedImageConfigLabel: formatConfigLabel(effectiveImageConfigId, aiConfigs, 'image', '图片', imageSourceLabel),
        lockedVideoConfigLabel: formatConfigLabel(effectiveVideoConfigId, aiConfigs, 'video', '视频', videoSourceLabel),
        lockedAudioConfigLabel: formatConfigLabel(effectiveAudioConfigId, aiConfigs, 'audio', '配音', audioSourceLabel),
        running: !!activeAiTask,
        runningType: activeAiTask ? resolveWorkbenchAiTaskType(activeAiTask) : null,
        runningNote: activeAiTask ? formatRecoveredAiTaskNote(activeAiTask) : '',
      })

      if (activeAiTask) {
        const taskId = activeAiTask.id
        const recoveredEpisodeId = ep.id
        void (async () => {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await sleep(3000)
            if (get().episode?.id !== recoveredEpisodeId) break
            const latest = await taskAPI.get(taskId).catch((error: unknown) => {
              console.warn('[Workbench] recovered AI task polling failed', error)
              return null
            })
            if (!latest) continue
            if (get().episode?.id !== recoveredEpisodeId) break
            if (ACTIVE_TASK_STATUSES.has(String(latest.status || ''))) {
              set({
                running: true,
                runningType: resolveWorkbenchAiTaskType(latest),
                runningNote: formatRecoveredAiTaskNote(latest),
              })
              continue
            }

            set({ running: false, runningType: null, runningNote: '' })
            if (latest.status === 'completed') {
              await get().loadAll(dramaId, episodeNumber)
            } else if (latest.status === 'failed' && latest.error_message) {
              toast.error('短剧 AI 任务失败', { description: latest.error_message })
            }
            break
          }
        })()
      }
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  },

  goSubStep: (key: string) => {
    if (key.startsWith('script-')) {
      set({ panel: 'script', scriptStep: SCRIPT_STEP_MAP[key] ?? 0 })
    } else if (key.startsWith('prod-')) {
      const tabMap: Record<string, string> = {
        'prod-chars': 'chars', 'prod-scenes': 'scenes',
        'prod-dubbing': 'dubbing', 'prod-shots': 'shots',
        'prod-videos': 'videos', 'prod-compose': 'compose',
      }
      set({ panel: 'production', prodTab: tabMap[key] || 'chars' })
    } else if (key === 'export-merge') {
      set({ panel: 'export' })
    }
  },

  setLocalRaw: (v) => set({ localRaw: v }),
  setLocalScript: (v) => set({ localScript: v }),

  saveRaw: async (options = {}) => {
    const { episode, localRaw } = get()
    if (!episode) return
    try {
      await episodeAPI.update(episode.id, { content: localRaw })
      set({ episode: { ...episode, content: localRaw } })
      if (!options.silent) toast.success('已保存')
    } catch (e: unknown) {
      if (!options.silent) toast.error((e as Error).message)
      throw e
    }
  },

  doRewrite: async () => {
    const { episode, localRaw } = get()
    if (!episode) return
    if (!localRaw.trim()) {
      toast.warning('请先填写原始内容')
      set({ panel: 'script', scriptStep: 0 })
      return
    }
    set({ running: true, runningType: 'script_rewriter', runningNote: '正在改写...' })
    try {
      let workingEpisode = episode
      if (localRaw !== (episode.content || '')) {
        workingEpisode = await episodeAPI.update(episode.id, { content: localRaw }) as Episode
        set({ episode: workingEpisode })
      }
      // Reset first so UI can render streaming output immediately
      set({ localScript: '' })

      let pending = ''
      let raf = 0
      const flush = () => {
        raf = 0
        set({ localScript: pending })
      }

      await fetchSSE({
        url: `/api/v1/ai/runs?stream=1`,
        method: 'POST',
        body: {
          skill_id: 'script_rewriter',
          mode: 'rewrite',
          scene: 'episode_script_workspace',
          input: { message: '改写以下内容' },
          target: {
            type: 'episode',
            drama_id: workingEpisode.drama_id,
            episode_id: workingEpisode.id,
          },
        },
        onEvent: (evt) => {
          if (!evt.data) return
          const payload = JSON.parse(evt.data) as { type?: string; text?: string; message?: string }
          if (payload.type === 'delta' && payload.text) {
            pending += payload.text
            if (!raf) raf = requestAnimationFrame(flush)
          }
          if (payload.type === 'status' && payload.text) {
            set({ runningNote: payload.text })
          }
          if (payload.type === 'error') {
            throw new Error(payload.message || '改写失败')
          }
        },
      })

      if (raf) {
        cancelAnimationFrame(raf)
        flush()
      }

      const ep = await episodeAPI.get(workingEpisode.id)
      const streamedScript = pending.trim()
      const savedScript = ep.script_content?.trim() || ''
      if (!savedScript && streamedScript) {
        await episodeAPI.update(episode.id, { script_content: streamedScript })
        set({
          episode: { ...ep, script_content: streamedScript },
          localScript: streamedScript,
        })
      } else {
        set({ episode: ep, localScript: ep.script_content || pending })
      }
      toast.success('改写完成')
    } catch (e: unknown) {
      toastWorkbenchError('AI 改写', e, [get().runningNote])
    }
    finally { set({ running: false, runningType: null, runningNote: '' }) }
  },

  skipRewrite: async () => {
    const { episode, localRaw } = get()
    if (!episode) return
    if (!localRaw.trim()) {
      toast.warning('请先填写原始内容')
      set({ panel: 'script', scriptStep: 0 })
      return
    }
    try {
      const ep = await episodeAPI.update(episode.id, { content: localRaw, script_content: localRaw }) as Episode
      set({ localScript: localRaw, scriptStep: 2, episode: ep })
      toast.success('已跳过改写')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  },

  doExtract: async () => {
    const { episode } = get()
    if (!episode) return
    if (!episode.script_content?.trim()) {
      toast.warning('请先完成 AI 改写，或跳过改写使用原始内容')
      set({ panel: 'script', scriptStep: 1 })
      return
    }
    set({ running: true, runningType: 'extractor', runningNote: '正在提取角色和场景...' })
    try {
      await runAgentStream({
        type: 'extractor',
        message: '提取角色和场景',
        dramaId: episode.drama_id,
        episodeId: episode.id,
        onStatus: (text) => set({ runningNote: text }),
      })
      const [epChars, epScenes] = await Promise.all([
        episodeAPI.characters(episode.id),
        episodeAPI.scenes(episode.id),
      ])

      // Fallback only if BOTH episode lists are empty after extraction. Under the
      // skill-driven runtime the extractor handler always writes characters/scenes
      // and links episode_characters/scenes; an empty pair here means either the
      // AI returned zero items and the heuristic also found nothing, or there is
      // older drama-level data carrying through. We show drama-level totals with
      // an explicit "drama 兜底" hint so the user knows this isn't a fresh extraction.
      if (epChars.length === 0 && epScenes.length === 0) {
        const d = await dramaAPI.get(episode.drama_id)
        set({ characters: d.characters || [], scenes: d.scenes || [] })
        toast.warning(`本集未提取到任何角色/场景，显示 drama 全量兜底（角色 ${(d.characters || []).length} · 场景 ${(d.scenes || []).length}）`)
      } else {
        set({ characters: epChars, scenes: epScenes })
        toast.success(`提取完成（角色 ${epChars.length} · 场景 ${epScenes.length}）`)
      }
    } catch (e: unknown) {
      toastWorkbenchError('提取角色场景', e, [get().runningNote])
    }
    finally { set({ running: false, runningType: null, runningNote: '' }) }
  },

  doVoice: async () => {
    const { episode, characters } = get()
    if (!episode) return
    if (characters.length === 0) {
      toast.warning('请先提取角色与场景')
      set({ panel: 'script', scriptStep: 2 })
      return
    }
    set({ running: true, runningType: 'voice_assigner', runningNote: '正在分配音色...' })
    try {
      await runAgentStream({
        type: 'voice_assigner',
        message: '分配音色',
        dramaId: episode.drama_id,
        episodeId: episode.id,
        onStatus: (text) => set({ runningNote: text }),
      })

      const epChars = await episodeAPI.characters(episode.id)
      set({ characters: epChars || [] })
      toast.success('音色分配完成')
    } catch (e: unknown) {
      toastWorkbenchError('分配音色', e, [get().runningNote])
    }
    finally { set({ running: false, runningType: null, runningNote: '' }) }
  },

  batchVoiceSamples: async () => {
    const { episode, characters } = get()
    if (!episode) return
    if (!get().voices.length) {
      toast.warning('暂无可用音色，请先在设置中启用音频配置并同步音色')
      return
    }
    const availableVoices = new Set(get().voices.map((voice) => voice.voice_id))
    const pending = characters.filter((c) => !!c.voice_style && availableVoices.has(c.voice_style) && !c.voice_sample_url)
    if (!pending.length) {
      const voicedCount = characters.filter((c) => !!c.voice_style).length
      toast.info(voicedCount > 0 ? '所有角色的试听文件已生成' : '请先分配音色')
      return
    }

    set({ running: true, runningType: 'batch_voice_samples', runningNote: `正在生成试听文件...（${pending.length}个）` })
    try {
      const results = await Promise.allSettled(pending.map((c) => characterAPI.voiceSample(c.id, episode.id)))
      const okCount = results.filter((item) => item.status === 'fulfilled').length
      const failCount = results.length - okCount
      const epChars = await episodeAPI.characters(episode.id)
      set({ characters: epChars || characters })
      if (okCount > 0) toast.success(`已生成 ${okCount} 份试听文件`)
      if (failCount > 0) toast.error(`${failCount} 份试听文件生成失败`)
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      set({ running: false, runningType: null, runningNote: '' })
    }
  },

  genVoiceSample: async (id: number) => {
    const { episode } = get()
    if (!episode) return
    if (!get().voices.length) {
      toast.warning('暂无可用音色，请先在设置中启用音频配置并同步音色')
      return
    }
    set(s => {
      const n = new Set(s.pendingVoiceSamples)
      n.add(id)
      return { pendingVoiceSamples: n }
    })
    try {
      const result = await characterAPI.voiceSample(id, episode.id)
      set(s => ({
        characters: s.characters.map(c => (
          c.id === id ? { ...c, voice_sample_url: result.voice_sample_url } : c
        )),
      }))
      toast.success('试听文件已生成')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      set(s => {
        const n = new Set(s.pendingVoiceSamples)
        n.delete(id)
        return { pendingVoiceSamples: n }
      })
    }
  },

  doBreakdown: async () => {
    const { episode, characters, scenes } = get()
    if (!episode) return
    if (!episode.script_content?.trim()) {
      toast.warning('请先完成 AI 改写，或跳过改写使用原始内容')
      set({ panel: 'script', scriptStep: 1 })
      return
    }
    if (characters.length === 0 && scenes.length === 0) {
      toast.warning('请先提取角色与场景')
      set({ panel: 'script', scriptStep: 2 })
      return
    }
    set({ running: true, runningType: 'storyboard_breaker', runningNote: '正在拆解分镜...' })
    try {
      const runInfo = await runAgentStream({
        type: 'storyboard_breaker',
        message: '拆解分镜',
        dramaId: episode.drama_id,
        episodeId: episode.id,
        onStatus: (text) => set({ runningNote: text }),
      })
      set({ runningNote: 'AI 已返回，正在同步分镜到工作台...' })
      let sbs = await episodeAPI.storyboards(episode.id)
      if (sbs.length === 0) {
        set({ runningNote: '正在等待分镜落库...' })
        sbs = await waitForStoryboards(episode.id)
      }
      set({
        storyboards: sbs,
        selectedStoryboard: sbs[0] || null,
        panel: sbs.length > 0 ? 'script' : get().panel,
        scriptStep: sbs.length > 0 ? 4 : get().scriptStep,
      })
      if (sbs.length === 0) {
        const called = runInfo.toolsCalled
        const hasSaveTool = hasSaveStoryboardsTool(called)
        if (!hasSaveTool) {
          toast.error('分镜未保存：AI 未调用 save_storyboards 工具')
        } else {
          toast.error('分镜未落库：save_storyboards 已调用但未写入，请查看服务端日志')
        }
      } else {
        set({ runningNote: `分镜已保存，共 ${sbs.length} 条` })
        toast.success(`分镜拆解完成（${sbs.length} 条）`)
      }
    } catch (e: unknown) {
      toastWorkbenchError('分镜拆解', e, [get().runningNote])
    }
    finally { set({ running: false, runningType: null, runningNote: '' }) }
  },

  updateCharVoice: async (id: number, voice: string) => {
    try {
      await characterAPI.update(id, { voice_style: voice })
      const chars = get().characters.map(c => c.id === id ? { ...c, voice_style: voice } : c)
      set({ characters: chars })
    } catch (e: unknown) { toast.error((e as Error).message) }
  },

  genCharImg: async (id: number) => {
    const { episode } = get()
    if (!episode) return
    set(s => { const n = new Set(s.pendingCharImages); n.add(id); return { pendingCharImages: n } })
    try {
      await characterAPI.generateImage(id, episode.id)
      toast.success('生成中...')
      // Real polling: up to 60 attempts, 3s interval
      for (let i = 0; i < 60; i++) {
        await sleep(3000)
        const epChars = await episodeAPI.characters(episode.id)
        const char = epChars?.find(c => c.id === id)
        if (char?.image_url) {
          set(s => {
            const n = new Set(s.pendingCharImages); n.delete(id)
            return { characters: epChars || [], pendingCharImages: n }
          })
          return
        }
      }
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
    set(s => { const n = new Set(s.pendingCharImages); n.delete(id); return { pendingCharImages: n } })
  },

  batchCharImages: async () => {
    const { episode, characters } = get()
    if (!episode) return
    const ids = characters.filter((c) => isVisualCharacter(c) && !c.image_url).map((c) => c.id)
    if (!ids.length) {
      toast.info('所有角色图片已生成')
      return
    }

    set({
      running: true,
      runningType: 'batch_char_images',
      runningNote: `批量生成角色图片中...（${ids.length}个）`,
      pendingCharImages: new Set([...get().pendingCharImages, ...ids]),
    })
    try {
      await characterAPI.batchImages(ids, episode.id)
      for (let i = 0; i < 80; i++) {
        await sleep(3000)
        try {
          const epChars = await episodeAPI.characters(episode.id)
          const doneIds = epChars.filter((char) => !!char.image_url).map((char) => char.id)
          const remain = ids.filter((id) => !doneIds.includes(id))
          const mergedPending = new Set(get().pendingCharImages)
          Array.from(mergedPending).forEach((pendingId) => {
            if (!remain.includes(pendingId)) mergedPending.delete(pendingId)
          })

          set({
            characters: epChars || [],
            pendingCharImages: mergedPending,
            runningNote: remain.length ? `批量生成角色图片中...（剩余 ${remain.length} 个）` : '批量生成角色图片完成',
          })

          if (remain.length === 0) {
            toast.success('角色图片批量生成完成')
            return
          }
        } catch {
          // keep polling
        }
      }
      toast.error('角色图片批量生成轮询超时')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      const nextPending = new Set(get().pendingCharImages)
      ids.forEach((id) => nextPending.delete(id))
      set({ running: false, runningType: null, runningNote: '', pendingCharImages: nextPending })
    }
  },

  genSceneImg: async (id: number) => {
    const { episode } = get()
    if (!episode) return
    set(s => { const n = new Set(s.pendingSceneImages); n.add(id); return { pendingSceneImages: n } })
    try {
      await sceneAPI.generateImage(id, episode.id)
      toast.success('生成中...')
      for (let i = 0; i < 60; i++) {
        await sleep(3000)
        const epScenes = await episodeAPI.scenes(episode.id)
        const scene = epScenes?.find(s => s.id === id)
        if (scene?.image_url) {
          set(s => {
            const n = new Set(s.pendingSceneImages); n.delete(id)
            return { scenes: epScenes || [], pendingSceneImages: n }
          })
          return
        }
      }
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
    set(s => { const n = new Set(s.pendingSceneImages); n.delete(id); return { pendingSceneImages: n } })
  },

  batchSceneImages: async () => {
    const { episode, scenes } = get()
    if (!episode) return
    const ids = scenes.filter((s) => !s.image_url).map((s) => s.id)
    if (!ids.length) {
      toast.info('所有场景图片已生成')
      return
    }

    set({
      running: true,
      runningType: 'batch_scene_images',
      runningNote: `批量生成场景图片中...（${ids.length}个）`,
      pendingSceneImages: new Set([...get().pendingSceneImages, ...ids]),
    })
    try {
      await Promise.allSettled(ids.map((id) => sceneAPI.generateImage(id, episode.id)))

      for (let i = 0; i < 80; i++) {
        await sleep(3000)
        try {
          const epScenes = await episodeAPI.scenes(episode.id)
          const doneIds = epScenes.filter((scene) => !!scene.image_url).map((scene) => scene.id)
          const remain = ids.filter((id) => !doneIds.includes(id))
          const mergedPending = new Set(get().pendingSceneImages)
          Array.from(mergedPending).forEach((pendingId) => {
            if (!remain.includes(pendingId)) mergedPending.delete(pendingId)
          })

          set({
            scenes: epScenes || [],
            pendingSceneImages: mergedPending,
            runningNote: remain.length ? `批量生成场景图片中...（剩余 ${remain.length} 个）` : '批量生成场景图片完成',
          })

          if (remain.length === 0) {
            toast.success('场景图片批量生成完成')
            return
          }
        } catch {
          // keep polling
        }
      }
      toast.error('场景图片批量生成轮询超时')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      const nextPending = new Set(get().pendingSceneImages)
      ids.forEach((id) => nextPending.delete(id))
      set({ running: false, runningType: null, runningNote: '', pendingSceneImages: nextPending })
    }
  },

  genShotTTS: async (sb: Storyboard) => {
    try {
      await storyboardAPI.generateTTS(sb.id)
      toast.success('配音生成中...')
      // Poll for tts_audio_url
      for (let i = 0; i < 40; i++) {
        await sleep(3000)
        const sbs = await episodeAPI.storyboards(sb.episode_id)
        const updated = sbs.find(s => s.id === sb.id)
        if (updated?.tts_audio_url) {
          set(s => ({ storyboards: s.storyboards.map(x => x.id === sb.id ? updated : x) }))
          return
        }
      }
    } catch (e: unknown) { toast.error((e as Error).message) }
  },

  batchShotTTS: async () => {
    const { episode, storyboards } = get()
    if (!episode) return
    const pending = storyboards.filter((sb) => !!getStoryboardTtsDialogue(sb) && !sb.tts_audio_url)
    if (!pending.length) {
      toast.info('所有可配音镜头已生成')
      return
    }

    set({ running: true, runningType: 'batch_tts', runningNote: `批量生成配音中...（${pending.length}条）` })
    try {
      const results = await Promise.allSettled(pending.map((sb) => storyboardAPI.generateTTS(sb.id)))
      const failed = results.filter((item) => item.status === 'rejected').length
      if (failed > 0) {
        toast.warning(`已提交批量配音，${failed} 条提交失败`)
      }

      for (let i = 0; i < 60; i++) {
        await sleep(3000)
        try {
          const sbs = await episodeAPI.storyboards(episode.id)
          const remain = sbs.filter((sb) => !!getStoryboardTtsDialogue(sb) && !sb.tts_audio_url).length
          set({
            storyboards: sbs || [],
            runningNote: remain ? `批量生成配音中...（剩余 ${remain} 条）` : '批量配音完成',
          })
          if (remain === 0) {
            toast.success('批量配音完成')
            return
          }
        } catch {
          // keep polling
        }
      }
      toast.error('批量配音轮询超时')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      set({ running: false, runningType: null, runningNote: '' })
    }
  },

  genShotFrame: async (sb: Storyboard, frameType: string) => {
    const { episode, scenes, characters, drama } = get()
    if (!episode) return
    const prompt = buildShotImagePrompt(sb, frameType, scenes)
    const referenceImages = buildShotReferenceImages(sb, scenes, characters)
    const configId = getEffectiveEpisodeConfigId(drama, episode, 'image')
    set(s => { const n = new Map(s.pendingShotFrames); n.set(sb.id, frameType); return { pendingShotFrames: n } })
    try {
      await imageAPI.generate({
        storyboard_id: sb.id,
        drama_id: episode.drama_id,
        prompt,
        frame_type: frameType,
        reference_images: referenceImages.length ? referenceImages : undefined,
        config_id: configId ?? undefined,
      })
      toast.success('生成中...')
      const field = frameType === 'first_frame' ? 'first_frame_image' : 'last_frame_image'
      for (let i = 0; i < 60; i++) {
        await sleep(3000)
        const sbs = await episodeAPI.storyboards(sb.episode_id)
        const updated = sbs.find(s => s.id === sb.id)
        if (updated?.[field]) {
          set(s => {
            const n = new Map(s.pendingShotFrames); n.delete(sb.id)
            return { storyboards: s.storyboards.map(x => x.id === sb.id ? updated : x), pendingShotFrames: n }
          })
          return
        }
      }
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
    set(s => { const n = new Map(s.pendingShotFrames); n.delete(sb.id); return { pendingShotFrames: n } })
  },

  genShotVideo: async (sb: Storyboard) => {
    const { episode, drama } = get()
    if (!episode) return
    const configId = getEffectiveEpisodeConfigId(drama, episode, 'video')
    set(s => { const n = new Set(s.pendingVideos); n.add(sb.id); return { pendingVideos: n } })
    try {
      await videoAPI.generate({
        storyboard_id: sb.id,
        drama_id: episode.drama_id,
        config_id: configId ?? undefined,
        prompt: buildNoDialogueShotVideoPrompt(sb),
        duration: sb.duration || 10,
      })
      toast.success('视频生成中...')
      for (let i = 0; i < 120; i++) {
        await sleep(5000)
        const sbs = await episodeAPI.storyboards(sb.episode_id)
        const updated = sbs.find(s => s.id === sb.id)
        if (updated?.video_url) {
          set(s => {
            const n = new Set(s.pendingVideos); n.delete(sb.id)
            return { storyboards: s.storyboards.map(x => x.id === sb.id ? updated : x), pendingVideos: n }
          })
          return
        }
      }
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
    set(s => { const n = new Set(s.pendingVideos); n.delete(sb.id); return { pendingVideos: n } })
  },

  batchShotVideos: async () => {
    const { episode, storyboards, drama } = get()
    if (!episode) return
    const pending = storyboards.filter((storyboard) => !storyboard.video_url)
    if (!pending.length) {
      toast.info('所有镜头视频已生成')
      return
    }
    const configId = getEffectiveEpisodeConfigId(drama, episode, 'video')

    const ids = pending.map((storyboard) => storyboard.id)
    set({
      running: true,
      runningType: 'batch_videos',
      runningNote: `批量生成视频中...（${pending.length}个）`,
      pendingVideos: new Set([...get().pendingVideos, ...ids]),
    })

    try {
      const results = await Promise.allSettled(pending.map(async (storyboard) => {
        await videoAPI.generate({
          storyboard_id: storyboard.id,
          drama_id: episode.drama_id,
          config_id: configId ?? undefined,
          prompt: buildNoDialogueShotVideoPrompt(storyboard),
          duration: storyboard.duration || 10,
        })
        return storyboard.id
      }))
      const submittedIds = results
        .filter((item): item is PromiseFulfilledResult<number> => item.status === 'fulfilled')
        .map((item) => item.value)
      const failed = results.length - submittedIds.length
      if (failed > 0) toast.warning(`已提交批量视频生成，${failed} 个提交失败`)
      if (!submittedIds.length) return

      set(s => {
        const nextPending = new Set(s.pendingVideos)
        ids
          .filter((id) => !submittedIds.includes(id))
          .forEach((id) => nextPending.delete(id))
        return { pendingVideos: nextPending }
      })

      for (let i = 0; i < 120; i++) {
        await sleep(5000)
        try {
          const sbs = await episodeAPI.storyboards(episode.id)
          const remain = submittedIds.filter((id) => !sbs.find((storyboard) => storyboard.id === id)?.video_url)
          const nextPending = new Set(get().pendingVideos)
          submittedIds.forEach((id) => {
            if (!remain.includes(id)) nextPending.delete(id)
          })
          set({
            storyboards: sbs || [],
            pendingVideos: nextPending,
            runningNote: remain.length ? `批量生成视频中...（剩余 ${remain.length} 个）` : '批量视频生成完成',
          })
          if (remain.length === 0) {
            toast.success('批量视频生成完成')
            return
          }
        } catch {
          // keep polling
        }
      }
      toast.error('批量视频生成轮询超时')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      const nextPending = new Set(get().pendingVideos)
      ids.forEach((id) => nextPending.delete(id))
      set({ running: false, runningType: null, runningNote: '', pendingVideos: nextPending })
    }
  },

  composeShot: async (sb: Storyboard) => {
    const { episode } = get()
    if (!episode) return
    const clearPendingCompose = () => {
      set(s => {
        const n = new Set(s.pendingComposes)
        n.delete(sb.id)
        return { pendingComposes: n }
      })
    }
    set(s => { const n = new Set(s.pendingComposes); n.add(sb.id); return { pendingComposes: n } })
    try {
      await composeAPI.shot(sb.id)
      toast.success('已加入合成任务')
      for (let i = 0; i < 120; i++) {
        await sleep(3000)
        try {
          const [status, sbs]: [EpisodeComposeStatusResponse, Storyboard[]] = await Promise.all([
            composeAPI.status(episode.id),
            episodeAPI.storyboards(episode.id),
          ])
          const updated = sbs.find(s => s.id === sb.id)
          const item = Array.isArray(status?.items) ? status.items.find(x => x.id === sb.id) : null
          set(s => ({ storyboards: sbs || s.storyboards }))
          if (updated?.composed_video_url) {
            toast.success('合成完成')
            return
          }
          if (item?.status === 'compose_failed' || item?.status === 'compose_canceled') {
            toast.error(item.status === 'compose_canceled' ? '合成已取消' : '合成失败')
            return
          }
        } catch {
          // keep polling on transient errors
        }
      }
      const sbs = await episodeAPI.storyboards(episode.id)
      set({ storyboards: sbs || [] })
      const updated = sbs.find(s => s.id === sb.id)
      if (updated?.composed_video_url) {
        toast.success('合成完成')
      } else {
        const stillRunning = updated?.status === 'compose_processing' || updated?.status === 'compose_queued'
        if (stillRunning) {
          toast.info('合成任务仍在后台运行，可稍后刷新查看')
          return
        }
        toast.error('合成状态轮询超时')
      }
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      clearPendingCompose()
    }
  },

  batchCompose: async () => {
    const { episode, storyboards } = get()
    if (!episode) return
    const hasVideo = storyboards.some((sb) => !!sb.video_url)
    if (!hasVideo) {
      toast.warning('请先生成镜头视频')
      return
    }

    set({ running: true, runningType: 'compose_all', runningNote: '批量合成中...' })
    try {
      await composeAPI.all(episode.id)
      toast.success('批量合成已开始')

      for (let i = 0; i < 120; i++) {
        await sleep(3000)
        try {
          const status: EpisodeComposeStatusResponse = await composeAPI.status(episode.id)
          const sbs = await episodeAPI.storyboards(episode.id)
          set({ storyboards: sbs || [] })

          const items = Array.isArray(status?.items) ? status.items : []
          const processing = items.filter((item) => item.status === 'compose_processing' || item.status === 'compose_queued')
          if (processing.length === 0) {
            const failed = items.filter((item) => item.status === 'compose_failed')
            if (failed.length > 0) {
              toast.error(`批量合成完成，但有 ${failed.length} 个镜头失败`)
            } else {
              toast.success('批量合成完成')
            }
            return
          }

          set({ runningNote: `批量合成中...（剩余 ${processing.length} 条）` })
        } catch {
          // keep polling on transient errors
        }
      }
      toast.error('批量合成状态轮询超时')
    } catch (e: unknown) {
      toast.error((e as Error).message)
    } finally {
      set({
        running: false,
        runningType: null,
        runningNote: '',
        pendingComposes: new Set<number>(),
      })
    }
  },

  mergeEpisode: async () => {
    const { episode } = get()
    if (!episode) return
    try {
      await mergeAPI.merge(episode.id)
      toast.success('合并中...')
      set({ mergeUrl: null })
      get().pollMergeStatus()
    } catch (e: unknown) { toast.error((e as Error).message) }
  },

  pollMergeStatus: async () => {
    const { episode } = get()
    if (!episode) return
    for (let i = 0; i < 120; i++) {
      await sleep(3000)
      try {
        const merge: EpisodeMergeStatusResponse | null = await mergeAPI.status(episode.id)
        const mergedUrl = merge?.merged_url || null
        if (merge?.status === 'completed' && mergedUrl) {
          set({ mergeStatus: merge, mergeUrl: mergedUrl })
          toast.success('\u5408\u5e76\u5b8c\u6210\uff01')
          return
        }
        if (merge?.status === 'failed' || merge?.status === 'canceled') {
          set({ mergeStatus: merge })
          toast.error(merge.status === 'canceled' ? '\u5408\u5e76\u5df2\u53d6\u6d88' : '\u5408\u5e76\u5931\u8d25')
          return
        }
      } catch { /* ignore poll errors */ }
    }
  },

  updateField: async (sb: Storyboard, field: string, value: unknown) => {
    try {
      await storyboardAPI.update(sb.id, { [field]: value })
      const updated = get().storyboards.map(s => s.id === sb.id ? { ...s, [field]: value } : s) as Storyboard[]
      set({ storyboards: updated, selectedStoryboard: { ...sb, [field]: value } as Storyboard })
    } catch (e: unknown) { toast.error((e as Error).message) }
  },

  toggleStoryboardCharacter: async (sb: Storyboard, charId: number) => {
    const current = (sb.characters || []) as Character[]
    const has = current.some(c => c.id === charId)
    const updated: Character[] = has ? current.filter(c => c.id !== charId) : [...current, { id: charId } as Character]
    const updatedIds = updated.map((character) => character.id)

    try {
      await storyboardAPI.update(sb.id, { character_ids: updatedIds })
      const sbs = get().storyboards.map(s => s.id === sb.id ? { ...s, characters: updated, character_ids: updatedIds } : s) as Storyboard[]
      set({ storyboards: sbs, selectedStoryboard: { ...sb, characters: updated, character_ids: updatedIds } as Storyboard })
    } catch (e: unknown) {
      toast.error((e as Error).message)
    }
  },

  requestDeleteShot: (sb: Storyboard) => set({ pendingDeleteStoryboard: sb }),
  cancelDeleteShot: () => set({ pendingDeleteStoryboard: null }),
  confirmDeleteShot: async () => {
    const sb = get().pendingDeleteStoryboard
    if (!sb) return
    try {
      await storyboardAPI.del(sb.id)
      const sbs = get().storyboards.filter(s => s.id !== sb.id)
      set({ storyboards: sbs, selectedStoryboard: sbs[0] || null, pendingDeleteStoryboard: null })
      toast.success('已删除')
    } catch (e: unknown) { toast.error((e as Error).message) }
  },

  openImageViewer: (src, title = '') => set({ viewerOpen: true, viewerSrc: src, viewerTitle: title }),
  closeImageViewer: () => set({ viewerOpen: false }),

  pipelineProgress: () => {
    const { characters, scenes, storyboards } = get()
    const visualCharacters = characters.filter(isVisualCharacter)
    const ttsEligible = storyboards.filter((storyboard) => !!getStoryboardTtsDialogue(storyboard))
    let prog = 0
    if (get().episode?.content?.trim()) prog++
    if (characters.length) prog++
    if (characters.length && characters.every(c => c.voice_style)) prog++
    if (storyboards.length) prog++
    if (characters.length > 0 && (visualCharacters.length === 0 || visualCharacters.every(c => c.image_url))) prog++
    if (storyboards.length > 0 && (scenes.length === 0 || scenes.every(s => s.image_url))) prog++
    if (storyboards.length > 0 && (ttsEligible.length === 0 || ttsEligible.every(s => s.tts_audio_url))) prog++
    if (storyboards.length > 0 && storyboards.every(hasCompleteShotFrames)) prog++
    if (storyboards.length > 0 && storyboards.every(s => s.video_url)) prog++
    if (storyboards.length > 0 && storyboards.every(s => s.composed_video_url)) prog++
    if (get().mergeUrl) prog++
    return prog
  },

  charsVoiced: () => get().characters.filter(c => c.voice_style).length,
  totalDuration: () => get().storyboards.reduce((sum: number, s) => sum + (s.duration || 10), 0),
}))
