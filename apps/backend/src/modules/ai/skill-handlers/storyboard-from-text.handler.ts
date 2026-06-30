import { BadRequestException } from '@nestjs/common'

import {
  createSseTransform,
  requestJsonObject,
  sendSseReply,
} from './_shared'
import type { SkillHandler } from './types'

/**
 * storyboard_from_text — 一段文本 → 结构化分镜草稿（画布对话编排专用）
 *
 * 与 storyboard_breaker / extractor 不同：
 *   - 不需要 drama_id / episode_id，不写任何业务表；
 *   - 把「大纲 + 角色 + 场景 + 分镜」一次性结构化「内联返回」给前端
 *     （放在 done.text 里的 JSON 字符串），由画布编排器落成节点。
 *
 * 容错策略对齐 extractor：先走 AI（requestJsonObject），AI 不可达 / 未配置 /
 * 解析失败时回退到本地启发式切分，保证前端永远拿到「可用草稿」。
 */

interface PipelineCharacter {
  name: string
  role?: string
  description?: string
}

interface PipelineScene {
  location: string
  time?: string
  description?: string
}

interface PipelineShot {
  title: string
  shotType?: string
  cameraMove?: string
  description?: string
  duration?: number
}

interface PipelineResult {
  outline: string
  characters: PipelineCharacter[]
  scenes: PipelineScene[]
  shots: PipelineShot[]
}

const SHOT_TYPES = ['全景', '中景', '近景', '远景']
const CAMERA_MOVES = ['推', '跟', '摇', '固定']
const MAX_SHOTS = 8
const MIN_SHOTS = 3

function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function parseScript(payload: any): string {
  const message = safeString(payload?.input?.message)
  if (!message) {
    throw new BadRequestException('input.message is required for skill=storyboard_from_text')
  }
  return message
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function extractCharactersHeuristically(text: string): PipelineCharacter[] {
  const banned = new Set(['旁白', '画外音', '字幕', '音效', '系统', 'OS', 'VO', 'BGM', 'SFX'])
  const matches = text.matchAll(/^([^\s：:()（）]{1,16})\s*[：:]/gm)
  const seen = new Set<string>()
  const result: PipelineCharacter[] = []
  for (const match of matches) {
    const name = (match[1] || '').replace(/\s+/g, '').trim()
    if (!name || banned.has(name) || seen.has(name)) continue
    if (/^S\d+$/i.test(name)) continue
    seen.add(name)
    result.push({ name, role: '', description: '由文本自动识别，待细化' })
  }
  return result
}

/** AI 不可用时的兜底：把整段文本按句子切成若干分镜草稿。 */
function buildHeuristicResult(text: string): PipelineResult {
  const sentences = splitSentences(text)
  const total = Math.min(MAX_SHOTS, Math.max(MIN_SHOTS, Math.ceil(sentences.length / 2) || MIN_SHOTS))
  const perShot = Math.max(1, Math.ceil(sentences.length / total))

  const shots: PipelineShot[] = []
  for (let i = 0; i < total; i += 1) {
    const chunk = sentences.slice(i * perShot, (i + 1) * perShot).join(' ').trim()
    const description = chunk || `第 ${i + 1} 段剧情`
    shots.push({
      title: chunk ? chunk.slice(0, 12) : `分镜 ${i + 1}`,
      shotType: SHOT_TYPES[i % SHOT_TYPES.length],
      cameraMove: CAMERA_MOVES[i % CAMERA_MOVES.length],
      description,
      duration: 4,
    })
  }
  if (!shots.length) {
    shots.push({ title: '开场镜头', shotType: '全景', cameraMove: '推', description: text.slice(0, 60), duration: 4 })
  }

  return {
    outline: text.slice(0, 200),
    characters: extractCharactersHeuristically(text),
    scenes: [],
    shots,
  }
}

function buildUserMessage(text: string): string {
  return `请把下面这段「故事 / 大纲 / 剧本」拆解为可拍摄的分镜草稿。

【原文】
${text.slice(0, 12000)}`
}

function normalizeResult(raw: Partial<PipelineResult> | null | undefined, fallbackText: string): PipelineResult {
  const shots = Array.isArray(raw?.shots) ? raw!.shots : []
  if (!shots.length) return buildHeuristicResult(fallbackText)

  return {
    outline: safeString(raw?.outline) || fallbackText.slice(0, 200),
    characters: (Array.isArray(raw?.characters) ? raw!.characters : [])
      .map((c) => ({ name: safeString(c?.name), role: safeString(c?.role), description: safeString(c?.description) }))
      .filter((c) => c.name),
    scenes: (Array.isArray(raw?.scenes) ? raw!.scenes : [])
      .map((s) => ({ location: safeString(s?.location), time: safeString(s?.time), description: safeString(s?.description) }))
      .filter((s) => s.location),
    shots: shots
      .slice(0, MAX_SHOTS)
      .map((s, i) => ({
        title: safeString(s?.title) || `分镜 ${i + 1}`,
        shotType: safeString(s?.shotType) || SHOT_TYPES[i % SHOT_TYPES.length],
        cameraMove: safeString(s?.cameraMove) || CAMERA_MOVES[i % CAMERA_MOVES.length],
        description: safeString(s?.description),
        duration: typeof s?.duration === 'number' && s.duration > 0 ? s.duration : 4,
      })),
  }
}

async function resolveResult(ctx: Parameters<SkillHandler>[0], text: string): Promise<PipelineResult> {
  try {
    const parsed = await requestJsonObject<Partial<PipelineResult>>({
      databaseService: ctx.databaseService,
      systemPrompt: ctx.skillPrompt,
      userMessage: buildUserMessage(text),
      temperature: 0.4,
      maxTokens: 8192,
      shape: '{"outline":"...","characters":[...],"scenes":[...],"shots":[...]}',
    })
    return normalizeResult(parsed, text)
  } catch {
    // AI 未配置 / 不可达 / 解析失败 —— 回退到启发式切分
    return buildHeuristicResult(text)
  }
}

export const storyboardFromTextHandler: SkillHandler = async (ctx) => {
  const text = parseScript(ctx.payload)

  if (!ctx.stream) {
    const result = await resolveResult(ctx, text)
    return {
      response: {
        type: 'done' as const,
        text: JSON.stringify(result),
        references: [],
        actions: [],
      },
    }
  }

  const { stream, emitter } = createSseTransform()

  void (async () => {
    try {
      await emitter.writeRaw(':ok\n\n')
      await emitter.send({ type: 'status', text: '正在拆解文本为分镜草稿...' }, 'message')
      const result = await resolveResult(ctx, text)
      await emitter.send({ type: 'done', text: JSON.stringify(result), tools_called: ['storyboard_from_text'] }, 'message')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI execution failed'
      try {
        await emitter.send({ type: 'error', message }, 'message')
      } catch {
        // ignore
      }
    } finally {
      await emitter.close()
    }
  })()

  return { response: sendSseReply(ctx.reply, stream) }
}
