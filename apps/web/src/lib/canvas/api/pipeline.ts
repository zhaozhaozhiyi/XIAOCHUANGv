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
    return parsed
  } catch {
    return null
  }
}
