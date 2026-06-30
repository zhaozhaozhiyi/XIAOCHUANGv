/**
 * pipelineStore — 对话编排 / 流程栏临时状态（v2.2 PR-A）
 *
 * 对齐 Oii「对话驱动 + 流程清单」体验，但只放 UI 编排态，不进数据库：
 * - canvasMode：智能画布（对话优先）↔ 导演模式（手动连线），双视图共用同一 store
 * - chatOpen / railOpen：两条悬浮栏的收起/展开
 * - messages：对话流（工种 Agent 接力的话术）
 * - steps：右侧流程清单（剧本 → 角色 → 场景 → 分镜 → 画面 → 成片）
 * - running：编排流水线是否进行中
 *
 * 真正的 addNode / addEdge 落在 nodesStore / edgesStore（见 usePipelineOrchestrator）。
 */

import { create } from 'zustand'

/** 画布双视图：chat = 智能画布（对话优先）；director = 导演模式（手动连线） */
export type CanvasMode = 'chat' | 'director'

export type PipelineStepStatus = 'pending' | 'active' | 'done'

/** 工种 Agent 人格（对齐 Oii：每个阶段一个虚拟角色接力） */
export interface PipelinePersona {
  /** 工种 key，与 step.agent 对应 */
  key: string
  name: string
  /** emoji 头像，零依赖、跨主题稳定 */
  avatar: string
}

export interface PipelineStep {
  id: string
  title: string
  /** 负责该步的工种 persona.key */
  agent: string
  status: PipelineStepStatus
  hint?: string
}

export type ChatRole = 'agent' | 'user' | 'system'

export interface ChatMessage {
  id: string
  role: ChatRole
  /** role === 'agent' 时指向 persona.key */
  agent?: string
  text: string
  at: number
}

/** 默认工种人格（一期固定流程 + 话术；二期可换真 LLM Agent 自由编排） */
export const PIPELINE_PERSONAS: Record<string, PipelinePersona> = {
  director: { key: 'director', name: '艺术总监', avatar: '🎬' },
  writer: { key: 'writer', name: '编剧', avatar: '✍️' },
  character: { key: 'character', name: '角色设计师', avatar: '🎭' },
  art: { key: 'art', name: '美术指导', avatar: '🏞️' },
  storyboard: { key: 'storyboard', name: '分镜师', avatar: '🎞️' },
  dop: { key: 'dop', name: '摄影指导', avatar: '📷' },
  editor: { key: 'editor', name: '剪辑师', avatar: '✂️' },
}

/** 默认短剧流水线步骤（设计阶段 → 执行阶段） */
function defaultSteps(): PipelineStep[] {
  return [
    { id: 'script', title: '剧本拆解', agent: 'writer', status: 'pending' },
    { id: 'character', title: '角色设定', agent: 'character', status: 'pending' },
    { id: 'scene', title: '场景设定', agent: 'art', status: 'pending' },
    { id: 'storyboard', title: '分镜脚本', agent: 'storyboard', status: 'pending' },
    { id: 'render', title: '生成画面', agent: 'dop', status: 'pending' },
    { id: 'compose', title: '成片合成', agent: 'editor', status: 'pending' },
  ]
}

function welcomeMessage(): ChatMessage {
  return {
    id: 'msg_welcome',
    role: 'agent',
    agent: 'director',
    text: '输入故事或大纲，我来帮你拆成分镜。',
    at: Date.now(),
  }
}

interface PipelineState {
  canvasMode: CanvasMode
  chatOpen: boolean
  railOpen: boolean
  running: boolean
  steps: PipelineStep[]
  messages: ChatMessage[]

  setCanvasMode: (mode: CanvasMode) => void
  toggleCanvasMode: () => void
  setChatOpen: (open: boolean) => void
  toggleChat: () => void
  setRailOpen: (open: boolean) => void
  toggleRail: () => void

  setRunning: (running: boolean) => void
  setSteps: (steps: PipelineStep[]) => void
  updateStep: (id: string, patch: Partial<PipelineStep>) => void
  pushMessage: (msg: Omit<ChatMessage, 'id' | 'at'> & { id?: string; at?: number }) => void
  reset: () => void
}

export const usePipelineStore = create<PipelineState>((set) => ({
  canvasMode: 'chat',
  chatOpen: true,
  railOpen: true,
  running: false,
  steps: defaultSteps(),
  messages: [welcomeMessage()],

  setCanvasMode: (mode) => set({ canvasMode: mode }),
  toggleCanvasMode: () =>
    set((s) => ({ canvasMode: s.canvasMode === 'chat' ? 'director' : 'chat' })),
  setChatOpen: (open) => set({ chatOpen: open }),
  toggleChat: () => set((s) => ({ chatOpen: !s.chatOpen })),
  setRailOpen: (open) => set({ railOpen: open }),
  toggleRail: () => set((s) => ({ railOpen: !s.railOpen })),

  setRunning: (running) => set({ running }),
  setSteps: (steps) => set({ steps }),
  updateStep: (id, patch) =>
    set((s) => ({
      steps: s.steps.map((step) => (step.id === id ? { ...step, ...patch } : step)),
    })),
  pushMessage: (msg) =>
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: msg.id ?? `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
          at: msg.at ?? Date.now(),
          role: msg.role,
          agent: msg.agent,
          text: msg.text,
        },
      ],
    })),
  reset: () =>
    set({ running: false, steps: defaultSteps(), messages: [welcomeMessage()] }),
}))
