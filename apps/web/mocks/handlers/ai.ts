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
import { buildLocalStoryboardResult } from '@/lib/canvas/api/pipeline'

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

    const result = buildLocalStoryboardResult(message)
    return HttpResponse.json({
      type: 'done',
      text: JSON.stringify(result),
      references: [],
      actions: [],
    })
  }),
]
