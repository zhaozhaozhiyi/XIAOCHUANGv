import { BadRequestException } from '@nestjs/common'

import { readStoryboardContext, saveStoryboardsForEpisode } from '../../agents/agents.storyboard'
import type { StoryboardSaveInput } from '../../agents/agents.types'
import { requireOwnedDrama, requireOwnedEpisode } from '../../images/images.ownership'
import {
  completeAiRunTask,
  createSseTransform,
  failAiRunTask,
  persistAiRun,
  requestJsonObject,
  sendSseReply,
  startAiRunTask,
} from './_shared'
import type { SkillHandler, SkillHandlerContext } from './types'

/**
 * storyboard_breaker — 分镜拆解
 *
 * 取代 AgentsService.buildStoryboardBreakdownStream (agents.service.ts:1172-1249).
 * 复用 agents.storyboard.ts 中的 readStoryboardContext 与 saveStoryboardsForEpisode
 * —— 那两个函数是纯工具，没有依赖 AgentsService 内部状态，T5 删 Controller 时
 * 这个文件保留。
 *
 * 与前三个 handler 的差异：
 *   - 没有"启发式回退"。分镜拆解的 schema 复杂度太高，AI 失败时硬性报错让前端提示用户重试，
 *     而不是给一个"假分镜"误导后续生产链路
 *   - 整集 DELETE + 重建，不是增量更新；这一行为已在前端的"拆解分镜"按钮文案里说明
 */

interface StoryboardParams {
  dramaId: number
  episodeId: number
  userId: number
  message: string
}

function parseParams(payload: any, userId: number): StoryboardParams {
  const dramaId = Number(payload?.target?.drama_id)
  const episodeId = Number(payload?.target?.episode_id)
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    throw new BadRequestException('target.drama_id is required for skill=storyboard_breaker')
  }
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    throw new BadRequestException('target.episode_id is required for skill=storyboard_breaker')
  }
  return {
    dramaId,
    episodeId,
    userId,
    message: typeof payload?.input?.message === 'string' ? payload.input.message : '',
  }
}

function buildStoryboardUserMessage(args: {
  context: Record<string, unknown>
  message: string
}) {
  const request = args.message.trim() || '拆解分镜'
  // Truncate script to 8000 chars to keep prompt under context window for most providers.
  // Matches legacy agents.service.ts:1228-1232.
  const compactContext = {
    ...args.context,
    script: typeof args.context.script === 'string'
      ? (args.context.script as string).slice(0, 8000)
      : args.context.script,
  }
  return `【用户要求】${request}

【上下文】
${JSON.stringify(compactContext)}`
}

export const storyboardBreakerHandler: SkillHandler = async (ctx) => {
  const params = parseParams(ctx.payload, ctx.currentUser.id)
  await requireOwnedDrama(ctx.databaseService, params.dramaId, params.userId)
  const episode = await requireOwnedEpisode(ctx.databaseService, params.episodeId, params.userId)
  if (episode.dramaId !== params.dramaId) {
    throw new BadRequestException('episode_id 与 drama_id 不匹配')
  }

  const context = await readStoryboardContext(ctx.databaseService, params.episodeId, params.dramaId)
  if ('error' in context) {
    throw new BadRequestException(String(context.error))
  }

  if (!ctx.stream) {
    const result = await runBreakdown({ ctx, params, context })
    return {
      response: {
        type: 'done' as const,
        text: result.statusText,
        references: [],
        actions: [],
      },
    }
  }

  const { stream, emitter } = createSseTransform()
  const taskHandle = await startAiRunTask(ctx.databaseService, {
    userId: ctx.currentUser.id,
    skillId: 'storyboard_breaker',
    mode: String(ctx.payload?.mode || 'breakdown'),
    scene: String(ctx.payload?.scene || 'workbench'),
    targetType: 'episode',
    targetId: params.episodeId,
    dramaId: params.dramaId,
    episodeId: params.episodeId,
    userMessage: params.message || '拆解分镜',
    assistantMessage: '',
  })

  void (async () => {
    try {
      await emitter.writeRaw(':ok\n\n')
      const result = await runBreakdown({ ctx, params, context, emitter, skipPersist: true })
      await completeAiRunTask(ctx.databaseService, taskHandle, {
        assistantMessage: result.statusText,
        resultSummary: {
          skill_id: 'storyboard_breaker',
          count: result.count,
        },
      })
      await emitter.send({ type: 'status', text: result.statusText }, 'message').catch(() => undefined)
      await emitter.send({ type: 'done', task_id: taskHandle.taskId, tools_called: ['backend_json_storyboard_save'] }, 'message').catch(() => undefined)
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

async function runBreakdown(args: {
  ctx: SkillHandlerContext
  params: StoryboardParams
  context: Record<string, unknown>
  emitter?: { send: (data: unknown, event?: string) => Promise<void> }
  skipPersist?: boolean
}) {
  const { ctx, params, context, emitter } = args
  await emitter?.send({ type: 'status', text: '正在读取剧本、角色和场景...' }, 'message')
  await emitter?.send({ type: 'status', text: '正在生成并保存分镜...' }, 'message')

  const userMessage = buildStoryboardUserMessage({ context, message: params.message })
  const parsed = await requestJsonObject<{ storyboards?: StoryboardSaveInput[] }>({
    databaseService: ctx.databaseService,
    systemPrompt: ctx.skillPrompt,
    userMessage,
    temperature: 0.4,
    maxTokens: 16384,
    shape: '{"storyboards":[...]}',
  })

  const storyboardsPayload = Array.isArray(parsed?.storyboards) ? parsed.storyboards : []
  const saved = await saveStoryboardsForEpisode(
    ctx.databaseService,
    params.episodeId,
    params.dramaId,
    storyboardsPayload,
  )

  const statusText = `分镜已保存：${saved.count} 条`

  if (!args.skipPersist) {
    await persistAiRun(ctx.databaseService, {
      userId: ctx.currentUser.id,
      skillId: 'storyboard_breaker',
      mode: String(ctx.payload?.mode || 'breakdown'),
      scene: String(ctx.payload?.scene || 'workbench'),
      targetType: 'episode',
      targetId: params.episodeId,
      userMessage: params.message || '拆解分镜',
      assistantMessage: statusText,
    })
  }

  return { statusText, count: saved.count }
}
