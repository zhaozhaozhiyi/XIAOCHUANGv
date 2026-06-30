import { BadRequestException } from '@nestjs/common'

import { requestChatCompletion } from './_shared'
import type { SkillHandler } from './types'

/**
 * quick-video-session-title — 快速成片会话自动命名
 *
 * 取代 quick-video-sessions.ai.ts:generateSessionTitleViaAi。本 skill 与其他
 * episode-domain skill 的关键差异：
 *
 *   1. 不写 ai_runs ledger。命名调用属于后台静默动作（用户没有"我请你给我起个名"
 *      的主观意图），若写 ai_runs 会让前端 AI 历史列表被命名调用刷屏。这是一个
 *      明确的产品决策（详见 SKILL.md "副作用"段）。
 *   2. 不读任何 DB context。调用方（QuickVideoSessionsController.renameViaAi）
 *      已经把 round 列表序列化进 input.message，handler 只是把 system prompt
 *      （SKILL.md）+ user message 拼起来发出去
 *   3. 没有 stream 支持。命名是单次请求-单次响应，stream 模式没有意义
 *   4. 输出做了清洗：去引号、去换行、去末尾标点、截到 18 字符（按汉字算大约 18
 *      个，因为有些模型会输出 9-10 字标题，再让 controller 截到 8 字）
 */

interface RoundLike {
  prompt: string
  operationType: string
}

function operationLabel(op: string) {
  if (op === 'video') return '视频'
  if (op === 'audio') return '音频'
  return '图片'
}

/**
 * Build the standardized "[创作历史]\n1. [图片] ...\n2. [视频] ..." block.
 * Callers (currently only QuickVideoSessionsController) use this helper
 * instead of formatting locally so any future tweak to the prompt structure
 * happens in one place.
 */
export function buildSessionTitleHistoryText(rounds: RoundLike[]): string {
  if (!rounds.length) throw new Error('没有可用的创作记录')
  const lines = rounds
    .map((r, idx) => {
      const compact = String(r.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 120)
      if (!compact) return ''
      return `${idx + 1}. [${operationLabel(r.operationType)}] ${compact}`
    })
    .filter(Boolean)
    .join('\n')

  return `【创作历史】\n${lines}`
}

function cleanTitle(raw: string): string {
  // Mirror of quick-video-sessions.ai.ts cleanup so behavior is unchanged.
  return raw
    .replace(/^["'「『"'""]+|["'」』"'""]+$/g, '')
    .replace(/[\r\n]+/g, '')
    .replace(/[。.!！?？]$/g, '')
    .trim()
}

export const quickVideoSessionTitleHandler: SkillHandler = async (ctx) => {
  // Stream mode is unsupported for this skill — naming is an atomic
  // request/response. Stream callers shouldn't reach here in practice,
  // but reject loudly so the misuse is obvious.
  if (ctx.stream) {
    throw new BadRequestException('quick-video-session-title does not support stream mode')
  }

  const userMessage = typeof ctx.payload?.input?.message === 'string'
    ? ctx.payload.input.message
    : ''
  if (!userMessage.trim()) {
    throw new BadRequestException('input.message must contain the rendered creation history')
  }

  const raw = await requestChatCompletion({
    databaseService: ctx.databaseService,
    systemPrompt: ctx.skillPrompt,
    userMessage,
    temperature: 0.3,
    maxTokens: 64,
  })
  const cleaned = cleanTitle(raw)
  if (!cleaned) {
    throw new BadRequestException('AI 未返回有效标题')
  }

  // Intentionally do NOT persistAiRun — see header comment & SKILL.md.
  return {
    response: {
      type: 'done' as const,
      text: cleaned,
      references: [],
      actions: [],
    },
  }
}
