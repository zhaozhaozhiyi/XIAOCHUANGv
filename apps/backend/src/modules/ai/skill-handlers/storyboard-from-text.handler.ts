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

const MAX_SHOTS = 8
const MIN_SHOTS = 3

interface ShotBeat {
  title: string
  shotType: string
  cameraMove: string
  direction: string
}

const SHOT_BEATS: ShotBeat[] = [
  { title: '环境建立', shotType: '全景', cameraMove: '推', direction: '以全景交代时间、地点和整体氛围，明确人物所在位置' },
  { title: '人物入场', shotType: '中景', cameraMove: '跟', direction: '以中景呈现人物入场、状态和行动方向，保持空间关系清楚' },
  { title: '关键动作', shotType: '中景', cameraMove: '跟', direction: '聚焦推动剧情的关键动作，让事件在画面中明确发生' },
  { title: '线索显现', shotType: '近景', cameraMove: '推', direction: '靠近关键物件或信息，让观众清楚看到新线索' },
  { title: '冲突升级', shotType: '近景', cameraMove: '摇', direction: '强化人物与事件的冲突，用构图变化提升紧张感' },
  { title: '情绪反应', shotType: '近景', cameraMove: '固定', direction: '捕捉人物得知信息后的即时表情和身体反应' },
  { title: '结果揭示', shotType: '特写', cameraMove: '推', direction: '以特写揭示决定剧情走向的结果或关键细节' },
  { title: '悬念收束', shotType: '特写', cameraMove: '固定', direction: '停留在关键细节或人物反应上，在结尾留下明确悬念' },
]

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

function normalizedKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
}

function selectBeat(index: number, total: number): ShotBeat {
  const shortMappings: Record<number, number[]> = {
    3: [0, 2, 7],
    4: [0, 2, 5, 7],
    5: [0, 1, 2, 5, 7],
  }
  const mapped = shortMappings[total]?.[index]
  const beatIndex = mapped ?? Math.round((index * (SHOT_BEATS.length - 1)) / Math.max(1, total - 1))
  return SHOT_BEATS[beatIndex] ?? SHOT_BEATS[SHOT_BEATS.length - 1]
}

function describeBeat(beat: ShotBeat, source: string): string {
  const content = source.replace(/[。！？!?\s]+$/g, '').trim() || '围绕用户创意推进剧情'
  return `${beat.direction}。画面内容：${content}。`
}

function sourceForBeat(text: string, index: number, total: number): string {
  const content = text.replace(/[。！？!?\s]+$/g, '').trim()
  if (total !== 3) return content

  const event = content.match(/^(.{1,100}?)(发现|看到|听到|拿起|打开|收到|找到|遇见|推开|进入|走进|回头|醒来|意识到)(.{1,100})$/)
  if (!event) {
    return [
      `事件发生前的环境与人物状态：${content}`,
      `推动剧情的关键动作：${content}`,
      `事件后的关键细节与人物反应：${content}`,
    ][index] ?? content
  }

  const before = event[1].replace(/[，,\s]+$/g, '')
  const action = event[2]
  const object = event[3].replace(/^[，,\s]+/g, '')
  const actors = Array.from(before.matchAll(/女孩|男孩|少女|少年|女人|男人|青年|老人|店员|医生|警察|母亲|父亲|妈妈|爸爸|姐姐|哥哥|弟弟|妹妹/g))
  const actor = actors[actors.length - 1]?.[0] || '人物'
  return [
    `${before}处于事件发生前的状态，关键线索尚未出现`,
    `${before}${action}${object}，关键动作在画面中完整发生`,
    `${object}占据画面视觉中心，${actor}的即时反应与其形成对照`,
  ][index] ?? content
}

function isGenericTitle(title: string): boolean {
  return /^(?:分镜|镜头|shot)\s*#?\s*\d*$/i.test(title)
}

function extractCharactersHeuristically(text: string): PipelineCharacter[] {
  const banned = new Set(['旁白', '画外音', '字幕', '音效', '系统', 'OS', 'VO', 'BGM', 'SFX'])
  const matches = text.matchAll(/^([^\s：:()（）]{1,16})\s*[：:]/gm)
  const seen = new Set<string>()
  const result: PipelineCharacter[] = []
  for (const match of matches) {
    const name = (match[1] || '').replace(/\s+/g, '').trim()
    if (!name || banned.has(name) || seen.has(name)) continue
    if (/^【?(?:场景|时间|地点|镜头)/.test(name)) continue
    if (/^S\d+$/i.test(name)) continue
    seen.add(name)
    result.push({ name, role: '', description: '由文本自动识别，待细化' })
  }

  const roleMatches = text.matchAll(/女孩|男孩|少女|少年|女人|男人|青年|老人|店员|医生|警察|母亲|父亲|妈妈|爸爸|姐姐|哥哥|弟弟|妹妹/g)
  for (const match of roleMatches) {
    const name = match[0]
    if (seen.has(name)) continue
    seen.add(name)
    result.push({ name, role: '主要人物', description: '故事中的主要人物，外观与性格待细化' })
    if (result.length >= 4) break
  }
  return result
}

function extractScenesHeuristically(text: string): PipelineScene[] {
  const headingScenes: PipelineScene[] = []
  const seen = new Set<string>()
  const headingMatches = text.matchAll(/【场景(?:\s*[：:]\s*([^】]+))?】\s*([^\r\n]*)/g)
  for (const match of headingMatches) {
    const raw = safeString(match[1]) || safeString(match[2])
    const location = raw
      .replace(/\s+(?:日|夜|清晨|早晨|黄昏|傍晚)(?:\s+(?:内|外)(?:\/(?:内|外))?)?\s*$/g, '')
      .trim()
    if (!location || seen.has(location)) continue
    seen.add(location)
    const time = /夜|傍晚/.test(raw) ? '夜晚' : /清晨|早晨/.test(raw) ? '清晨' : /黄昏/.test(raw) ? '黄昏' : /日/.test(raw) ? '白天' : ''
    headingScenes.push({ location, time, description: '由剧本场景标题自动识别' })
  }

  const candidates: Array<[RegExp, string]> = [
    [/便利店|超市|商店/, '便利店'],
    [/街道|街头|马路/, '城市街道'],
    [/客厅/, '客厅'],
    [/卧室|房间/, '房间'],
    [/学校|教室/, '学校'],
    [/医院|病房/, '医院'],
    [/办公室|公司/, '办公室'],
  ]
  const time = /深夜|夜晚|夜里|雨夜/.test(text) ? '夜晚' : /清晨|早晨/.test(text) ? '清晨' : /黄昏|傍晚/.test(text) ? '傍晚' : ''
  const keywordScenes = candidates
    .filter(([pattern]) => pattern.test(text))
    .map(([, location]) => ({ location, time, description: '故事的主要发生地，环境细节待细化' }))
    .filter((scene) => !seen.has(scene.location))

  return [...headingScenes, ...keywordScenes].slice(0, 4)
}

/** 补足镜头并修复空白、过短或重复的 AI 结果。 */
export function ensureUsefulShots(input: PipelineShot[], fallbackText: string): PipelineShot[] {
  const sourceShots = input.slice(0, MAX_SHOTS)
  const total = Math.min(MAX_SHOTS, Math.max(MIN_SHOTS, sourceShots.length))
  const descriptionCounts = new Map<string, number>()
  const titleCounts = new Map<string, number>()

  for (const shot of sourceShots) {
    const descriptionKey = normalizedKey(safeString(shot?.description))
    const titleKey = normalizedKey(safeString(shot?.title))
    if (descriptionKey) descriptionCounts.set(descriptionKey, (descriptionCounts.get(descriptionKey) ?? 0) + 1)
    if (titleKey) titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1)
  }

  const fallbackKey = normalizedKey(fallbackText)
  return Array.from({ length: total }, (_, index) => {
    const shot = sourceShots[index]
    const beat = selectBeat(index, total)
    const originalDescription = safeString(shot?.description)
    const descriptionKey = normalizedKey(originalDescription)
    const rewriteDescription = !originalDescription
      || originalDescription.length < 12
      || descriptionKey === fallbackKey
      || (descriptionCounts.get(descriptionKey) ?? 0) > 1

    const originalTitle = safeString(shot?.title)
    const titleKey = normalizedKey(originalTitle)
    const rewriteTitle = !originalTitle
      || isGenericTitle(originalTitle)
      || (titleCounts.get(titleKey) ?? 0) > 1

    return {
      title: rewriteTitle ? beat.title : originalTitle,
      shotType: rewriteDescription ? beat.shotType : (safeString(shot?.shotType) || beat.shotType),
      cameraMove: rewriteDescription ? beat.cameraMove : (safeString(shot?.cameraMove) || beat.cameraMove),
      description: rewriteDescription
        ? describeBeat(beat, sourceForBeat(originalDescription || fallbackText, index, total))
        : originalDescription,
      duration: typeof shot?.duration === 'number' && shot.duration > 0
        ? Math.min(15, Math.max(1, Math.round(shot.duration)))
        : 4,
    }
  })
}

/** AI 不可用时的兜底：把整段文本按句子切成若干分镜草稿。 */
export function buildHeuristicResult(text: string): PipelineResult {
  const sentences = splitSentences(text)
  const total = Math.min(MAX_SHOTS, Math.max(MIN_SHOTS, Math.ceil(sentences.length / 2) || MIN_SHOTS))

  const shots = Array.from({ length: total }, (_, index) => {
    const start = sentences.length >= total ? Math.floor((index * sentences.length) / total) : 0
    const end = sentences.length >= total ? Math.floor(((index + 1) * sentences.length) / total) : sentences.length
    return { title: `分镜 ${index + 1}`, description: sentences.slice(start, end).join(' ').trim() || text, duration: 4 }
  })

  return {
    outline: text.slice(0, 200),
    characters: extractCharactersHeuristically(text),
    scenes: extractScenesHeuristically(text),
    shots: ensureUsefulShots(shots, text),
  }
}

function buildUserMessage(text: string): string {
  return `请把下面这段「故事 / 大纲 / 剧本」拆解为可拍摄的分镜草稿。

【原文】
${text.slice(0, 12000)}`
}

export function normalizeResult(raw: Partial<PipelineResult> | null | undefined, fallbackText: string): PipelineResult {
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
    shots: ensureUsefulShots(shots, fallbackText),
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
