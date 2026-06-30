/**
 * AI Runtime MSW handlers（v2.2 PR-B）
 *
 * 拦截 POST /api/v1/ai/runs（storyboard_from_text），在 MSW 模式下本地启发式拆解，
 * 避免请求穿透到真实后端（dev 免登录 / DI 热重载不稳定）。
 *
 * 响应形态与后端 handler 非流式一致：{ type: 'done', text: '<JSON string>' }
 * （不经 { code, data } envelope，与 workbench fetchSSE 一致）
 */

import { HttpResponse, http } from 'msw'

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

function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/(?<=[。！？!?])|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function extractCharacters(text: string): PipelineCharacter[] {
  const banned = new Set(['旁白', '画外音', '字幕', '音效', '系统'])
  const matches = text.matchAll(/([^\s，,。！？!?：:()（）]{2,8})/g)
  const seen = new Set<string>()
  const result: PipelineCharacter[] = []
  for (const match of matches) {
    const name = (match[1] || '').trim()
    if (!name || banned.has(name) || seen.has(name)) continue
    if (/^(一个|一位|这家|两人|决定|遇到|深夜|店员)/.test(name)) continue
    seen.add(name)
    result.push({ name, description: '由文本自动识别，待细化' })
    if (result.length >= 4) break
  }
  return result
}

function extractScenes(text: string): PipelineScene[] {
  const scenes: PipelineScene[] = []
  if (/便利店|超市|商店/.test(text)) {
    scenes.push({ location: '便利店', time: '深夜', description: '主要发生地' })
  }
  if (/城市|街道|夜景/.test(text)) {
    scenes.push({ location: '城市街道', time: '夜晚', description: '外景建立' })
  }
  if (/室内|客厅|房间/.test(text)) {
    scenes.push({ location: '室内', time: '夜', description: '内景' })
  }
  if (!scenes.length) {
    scenes.push({ location: '主要场景', description: '由文本推断，待细化' })
  }
  return scenes.slice(0, 4)
}

function buildHeuristicResult(text: string): PipelineResult {
  const sentences = splitSentences(text)
  const total = Math.min(8, Math.max(3, Math.ceil(sentences.length / 2) || 3))
  const perShot = Math.max(1, Math.ceil(sentences.length / total))

  const shots: PipelineShot[] = []
  for (let i = 0; i < total; i += 1) {
    const chunk = sentences.slice(i * perShot, (i + 1) * perShot).join(' ').trim()
    shots.push({
      title: chunk ? chunk.slice(0, 12) : `分镜 ${i + 1}`,
      shotType: SHOT_TYPES[i % SHOT_TYPES.length],
      cameraMove: CAMERA_MOVES[i % CAMERA_MOVES.length],
      description: chunk || `第 ${i + 1} 段剧情`,
      duration: 4,
    })
  }

  return {
    outline: text.slice(0, 120),
    characters: extractCharacters(text),
    scenes: extractScenes(text),
    shots,
  }
}

export const aiHandlers = [
  http.post('/api/v1/ai/runs', async ({ request }) => {
    let body: Record<string, unknown> = {}
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return HttpResponse.json({ type: 'error', message: 'invalid body' }, { status: 400 })
    }

    const skillId = String(body.skill_id || '')
    if (skillId !== 'storyboard_from_text') {
      // 其他 skill 不在 MSW 范围，放行给真实后端
      return
    }

    const input = (body.input as Record<string, unknown> | undefined) ?? {}
    const message = typeof input.message === 'string' ? input.message.trim() : ''
    if (!message) {
      return HttpResponse.json({ type: 'error', message: 'input.message is required' }, { status: 400 })
    }

    // 模拟 LLM 延迟
    await new Promise((r) => setTimeout(r, 600))

    const result = buildHeuristicResult(message)
    return HttpResponse.json({
      type: 'done',
      text: JSON.stringify(result),
      references: [],
      actions: [],
    })
  }),
]
