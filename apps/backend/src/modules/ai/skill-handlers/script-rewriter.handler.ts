import { BadRequestException, NotFoundException } from '@nestjs/common'
import { eq } from 'drizzle-orm'

import type { DatabaseService } from '../../../db/database.service'
import { episodes } from '../../../db/schema'
import { requireOwnedDrama, requireOwnedEpisode } from '../../images/images.ownership'
import {
  createSseTransform,
  completeAiRunTask,
  extractStreamingText,
  failAiRunTask,
  getTextConfig,
  getTextProviderBaseUrl,
  parseSseDataBlock,
  persistAiRun,
  sendSseReply,
  startAiRunTask,
} from './_shared'
import type { SkillHandler } from './types'

/**
 * script_rewriter — 短剧剧本改写
 *
 * 取代 AgentsService.buildScriptRewriteStream（已于本次收口删除硬编码 prompt）。
 * Prompt 真相源现在是 skills/script_rewriter/SKILL.md，由 _shared 工具加载并作为
 * system prompt 注入；handler 只负责拼 user message、流式接管、清洗、写库。
 *
 * 流式策略说明：
 *   - 即使 SKILL.md 已明确"直接从 ## S01 开始输出"，部分模型仍会先吐"以下是改写结果：\n"。
 *     handler 维护 scriptStarted 状态，命中第一个 ## S\d+ 之前的 delta 全部丢弃，
 *     从而保证前端 onDelta 收到的第一段就是真正的剧本头。
 */

function buildUserMessage(source: string, userRequest: string) {
  const extra = userRequest.trim() && userRequest.trim() !== '改写以下内容'
    ? `\n\n【用户补充要求】\n${userRequest.trim()}`
    : ''
  return `【原始剧本】\n${source}\n\n【用户要求】\n${userRequest.trim() || '改写以下内容'}${extra}`
}

function sanitizeFormattedScript(raw: string) {
  const text = String(raw || '').trimStart()
  const match = /(^|\n)##\s*S\d+/m.exec(text)
  if (!match) return text.trim()
  const startIdx = match.index + (match[1]?.length ?? 0)
  return text.slice(startIdx).trim()
}

interface ScriptRewriteParams {
  dramaId: number
  episodeId: number
  userId: number
  message: string
}

function parseParams(payload: any, userId: number): ScriptRewriteParams {
  const dramaId = Number(payload?.target?.drama_id)
  const episodeId = Number(payload?.target?.episode_id)
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    throw new BadRequestException('target.drama_id is required for skill=script_rewriter')
  }
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    throw new BadRequestException('target.episode_id is required for skill=script_rewriter')
  }
  return {
    dramaId,
    episodeId,
    userId,
    message: typeof payload?.input?.message === 'string' ? payload.input.message : '',
  }
}

async function loadEpisodeSource(databaseService: DatabaseService, params: ScriptRewriteParams) {
  await requireOwnedDrama(databaseService, params.dramaId, params.userId)
  const episode = await requireOwnedEpisode(databaseService, params.episodeId, params.userId)
  if (episode.dramaId !== params.dramaId) {
    throw new NotFoundException('episode_not_in_drama')
  }
  const source = episode.content || episode.scriptContent || ''
  if (!source.trim()) {
    throw new BadRequestException('Episode has no content to rewrite')
  }
  return source
}

export const scriptRewriterHandler: SkillHandler = async (ctx) => {
  const params = parseParams(ctx.payload, ctx.currentUser.id)
  const source = await loadEpisodeSource(ctx.databaseService, params)
  const userMessage = buildUserMessage(source, params.message)

  // script_rewriter only meaningfully exists as a streaming experience —
  // the workbench shows the script writing itself live. Non-stream callers
  // are kept compatible by buffering deltas internally; the response shape
  // mirrors what the AiService default path returns.
  if (!ctx.stream) {
    return runNonStream({ ctx, params, source, userMessage })
  }

  return runStream({ ctx, params, source, userMessage })
}

async function runStream(args: {
  ctx: Parameters<SkillHandler>[0]
  params: ScriptRewriteParams
  source: string
  userMessage: string
}) {
  const { ctx, params, userMessage } = args
  const config = await getTextConfig(ctx.databaseService)
  const url = `${getTextProviderBaseUrl(config).replace(/\/+$/, '')}/chat/completions`
  const { stream, emitter } = createSseTransform()
  const taskHandle = await startAiRunTask(ctx.databaseService, {
    userId: ctx.currentUser.id,
    skillId: 'script_rewriter',
    mode: String(ctx.payload?.mode || 'rewrite'),
    scene: String(ctx.payload?.scene || 'episode_script_workspace'),
    targetType: 'episode',
    targetId: params.episodeId,
    dramaId: params.dramaId,
    episodeId: params.episodeId,
    userMessage,
    assistantMessage: '',
  })

  void (async () => {
    let generated = ''
    try {
      await emitter.writeRaw(':ok\n\n')
      await emitter.send({ type: 'status', text: '正在改写剧本...' }, 'message')

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0.7,
          stream: true,
          messages: [
            { role: 'system', content: ctx.skillPrompt },
            { role: 'user', content: userMessage },
          ],
        }),
      })

      if (!response.ok) {
        const message = await response.text().catch(() => '')
        throw new Error(message || `AI 请求失败（${response.status}）`)
      }
      if (!response.body) throw new Error('AI 流式响应为空')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let scriptStarted = false
      let scriptBuffer = ''
      let sawModelOutput = false
      const scriptStartRe = /(^|\n)##\s*S\d+/m

      const consumeBlock = async (block: string) => {
        const payload = parseSseDataBlock(block)
        if (!payload) return
        const delta = extractStreamingText(payload)
        if (!delta) return
        generated += delta
        if (!sawModelOutput) {
          sawModelOutput = true
          await emitter.send({ type: 'status', text: 'AI 已开始输出，正在定位剧本开头...' }, 'message')
        }

        if (!scriptStarted) {
          scriptBuffer += delta
          const match = scriptStartRe.exec(scriptBuffer)
          if (!match) return
          scriptStarted = true
          await emitter.send({ type: 'status', text: '正在流式写入剧本...' }, 'message')
          const startIdx = match.index + (match[1]?.length ?? 0)
          const body = scriptBuffer.slice(startIdx)
          scriptBuffer = ''
          if (body) await emitter.send({ type: 'delta', text: body }, 'message')
          return
        }
        await emitter.send({ type: 'delta', text: delta }, 'message')
      }

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split(/\n\n/)
        buffer = blocks.pop() || ''
        for (const block of blocks) await consumeBlock(block)
      }
      buffer += decoder.decode()
      if (buffer.trim()) await consumeBlock(buffer)

      const cleaned = sanitizeFormattedScript(generated)
      if (!cleaned) throw new Error('AI 未返回有效剧本内容')

      await ctx.databaseService.db
        .update(episodes)
        .set({ scriptContent: cleaned, updatedAt: new Date() })
        .where(eq(episodes.id, params.episodeId))

      await completeAiRunTask(ctx.databaseService, taskHandle, {
        assistantMessage: cleaned,
        resultSummary: {
          skill_id: 'script_rewriter',
          chars: cleaned.length,
        },
      })

      await emitter.send({ type: 'done', task_id: taskHandle.taskId, tools_called: ['direct_script_rewrite'] }, 'message').catch(() => undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI execution failed'
      await failAiRunTask(ctx.databaseService, taskHandle, error)
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

async function runNonStream(args: {
  ctx: Parameters<SkillHandler>[0]
  params: ScriptRewriteParams
  source: string
  userMessage: string
}) {
  const { ctx, params, userMessage } = args
  const config = await getTextConfig(ctx.databaseService)
  const url = `${getTextProviderBaseUrl(config).replace(/\/+$/, '')}/chat/completions`

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: ctx.skillPrompt },
        { role: 'user', content: userMessage },
      ],
    }),
  })
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    throw new BadRequestException(message || `AI 请求失败（${response.status}）`)
  }
  const payload = await response.json() as any
  const raw = payload?.choices?.[0]?.message?.content
  const text = typeof raw === 'string' ? raw : ''
  const cleaned = sanitizeFormattedScript(text)
  if (!cleaned) throw new BadRequestException('AI 未返回有效剧本内容')

  await ctx.databaseService.db
    .update(episodes)
    .set({ scriptContent: cleaned, updatedAt: new Date() })
    .where(eq(episodes.id, params.episodeId))

  await persistAiRun(ctx.databaseService, {
    userId: ctx.currentUser.id,
    skillId: 'script_rewriter',
    mode: String(ctx.payload?.mode || 'rewrite'),
    scene: String(ctx.payload?.scene || 'episode_script_workspace'),
    targetType: 'episode',
    targetId: params.episodeId,
    userMessage,
    assistantMessage: cleaned,
  })

  return {
    response: { type: 'done' as const, text: cleaned, references: [], actions: [] },
  }
}
