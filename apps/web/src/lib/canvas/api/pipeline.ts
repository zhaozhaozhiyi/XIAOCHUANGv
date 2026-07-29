/**
 * 画布对话编排 — 文本转分镜（v2.2 PR-B）
 *
 * 调用统一 AI 运行时 `POST /api/v1/ai/runs`（skill = storyboard_from_text，非流式），
 * 把一段文本结构化为「大纲 + 角色 + 场景 + 分镜」内联返回。
 *
 * 注意：该端点返回的是「裸」对象 { type:'done', text }（不走画布的 {code,data}
 * envelope），所以这里单独用 fetch，不复用 canvasClient。
 *
 * 任意失败（未登录 401 / 未配置 AI / 网络异常 / JSON 不可解析）都返回 null，
 * 由 usePipelineOrchestrator 回退到本地启发式草稿，保证「一定有结果」。
 */

export interface PipelineCharacter {
  name: string
  role?: string
  description?: string
}

export interface PipelineScene {
  location: string
  time?: string
  description?: string
}

export interface PipelineShot {
  title: string
  shotType?: string
  cameraMove?: string
  description?: string
  duration?: number
}

export interface PipelineResult {
  outline: string
  characters: PipelineCharacter[]
  scenes: PipelineScene[]
  shots: PipelineShot[]
}

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

function isGenericTitle(title: string): boolean {
  return /^(?:分镜|镜头|shot)\s*#?\s*\d*$/i.test(title)
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

function repairShots(input: PipelineShot[], sourceText: string): PipelineShot[] {
  const sourceShots = input.slice(0, 8)
  const total = Math.min(8, Math.max(3, sourceShots.length))
  const descriptionCounts = new Map<string, number>()
  const titleCounts = new Map<string, number>()

  for (const shot of sourceShots) {
    const descriptionKey = normalizedKey(safeString(shot?.description))
    const titleKey = normalizedKey(safeString(shot?.title))
    if (descriptionKey) descriptionCounts.set(descriptionKey, (descriptionCounts.get(descriptionKey) ?? 0) + 1)
    if (titleKey) titleCounts.set(titleKey, (titleCounts.get(titleKey) ?? 0) + 1)
  }

  const sourceKey = normalizedKey(sourceText)
  return Array.from({ length: total }, (_, index) => {
    const shot = sourceShots[index]
    const beat = selectBeat(index, total)
    const originalDescription = safeString(shot?.description)
    const descriptionKey = normalizedKey(originalDescription)
    const rewriteDescription = !originalDescription
      || originalDescription.length < 12
      || descriptionKey === sourceKey
      || (descriptionCounts.get(descriptionKey) ?? 0) > 1
    const originalTitle = safeString(shot?.title)
    const titleKey = normalizedKey(originalTitle)
    const rewriteTitle = !originalTitle
      || isGenericTitle(originalTitle)
      || (titleCounts.get(titleKey) ?? 0) > 1
    const content = sourceForBeat(originalDescription || sourceText, index, total) || '围绕用户创意推进剧情'

    return {
      title: rewriteTitle ? beat.title : originalTitle,
      shotType: rewriteDescription ? beat.shotType : (safeString(shot?.shotType) || beat.shotType),
      cameraMove: rewriteDescription ? beat.cameraMove : (safeString(shot?.cameraMove) || beat.cameraMove),
      description: rewriteDescription ? `${beat.direction}。画面内容：${content}。` : originalDescription,
      duration: typeof shot?.duration === 'number' && shot.duration > 0
        ? Math.min(15, Math.max(1, Math.round(shot.duration)))
        : 4,
    }
  })
}

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?])|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function extractLocalCharacters(text: string): PipelineCharacter[] {
  const matches = text.matchAll(/女孩|男孩|少女|少年|女人|男人|青年|老人|店员|医生|警察|母亲|父亲|妈妈|爸爸|姐姐|哥哥|弟弟|妹妹/g)
  return [...new Set(Array.from(matches, (match) => match[0]))]
    .slice(0, 4)
    .map((name) => ({ name, role: '主要人物', description: '故事中的主要人物，外观与性格待细化' }))
}

function extractLocalScenes(text: string): PipelineScene[] {
  const candidates: Array<[RegExp, string]> = [
    [/便利店|超市|商店/, '便利店'],
    [/街道|街头|马路/, '城市街道'],
    [/客厅/, '客厅'],
    [/卧室|房间/, '房间'],
    [/学校|教室/, '学校'],
    [/医院|病房/, '医院'],
    [/办公室|公司/, '办公室'],
  ]
  const time = /深夜|夜晚|夜里|雨夜/.test(text) ? '夜晚' : /清晨|早晨/.test(text) ? '清晨' : /黄昏|傍晚/.test(text) ? '傍晚' : undefined
  return candidates
    .filter(([pattern]) => pattern.test(text))
    .slice(0, 4)
    .map(([, location]) => ({ location, time, description: '故事的主要发生地，环境细节待细化' }))
}

/** AI 不可达或开发环境使用的确定性分镜草稿。 */
export function buildLocalStoryboardResult(text: string): PipelineResult {
  const sourceText = text.trim()
  const sentences = splitSentences(sourceText)
  const total = Math.min(8, Math.max(3, Math.ceil(sentences.length / 2) || 3))
  const shots = Array.from({ length: total }, (_, index) => {
    const start = sentences.length >= total ? Math.floor((index * sentences.length) / total) : 0
    const end = sentences.length >= total ? Math.floor(((index + 1) * sentences.length) / total) : sentences.length
    return {
      title: `分镜 ${index + 1}`,
      description: sentences.slice(start, end).join(' ').trim() || sourceText,
      duration: 4,
    }
  })

  return {
    outline: sourceText.slice(0, 200),
    characters: extractLocalCharacters(sourceText),
    scenes: extractLocalScenes(sourceText),
    shots: repairShots(shots, sourceText),
  }
}

/** 对真实 AI 或旧版 Mock 返回做最后一道质量防御。 */
export function repairPipelineResult(result: PipelineResult, sourceText: string): PipelineResult {
  return {
    outline: safeString(result?.outline) || sourceText.slice(0, 200),
    characters: Array.isArray(result?.characters) ? result.characters : [],
    scenes: Array.isArray(result?.scenes) ? result.scenes : [],
    shots: repairShots(Array.isArray(result?.shots) ? result.shots : [], sourceText),
  }
}

export async function splitStoryIntoStoryboard(
  text: string,
  options?: { signal?: AbortSignal },
): Promise<PipelineResult | null> {
  try {
    const resp = await fetch('/api/v1/ai/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        skill_id: 'storyboard_from_text',
        mode: 'pipeline',
        scene: 'canvas',
        target: { type: 'canvas' },
        input: { message: text },
        options: { stream: false },
      }),
      signal: options?.signal,
    })
    if (!resp.ok) return null

    const raw = (await resp.json()) as { code?: number; data?: { type?: string; text?: string }; type?: string; text?: string }
    // Next 代理会把后端裸 JSON 包进 { code, data } envelope
    const payload = raw?.data ?? raw
    if (!payload?.text) return null

    const parsed = JSON.parse(payload.text) as PipelineResult
    if (!parsed || !Array.isArray(parsed.shots) || parsed.shots.length === 0) return null
    return repairPipelineResult(parsed, text)
  } catch {
    return null
  }
}
