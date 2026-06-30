import { BadRequestException } from '@nestjs/common'

import { requireOwnedDrama, requireOwnedEpisode } from '../../images/images.ownership'
import {
  createSseTransform,
  persistAiRun,
  sendSseReply,
} from './_shared'
import type { SkillHandler, SkillHandlerContext } from './types'

/**
 * grid_prompt_generator — 宫格图提示词生成
 *
 * 取代 AgentsService.buildGridPromptStream (agents.service.ts:1251-1274). 这个
 * skill 是一个 backend-tool-only skill — 不调任何 LLM，handler 只是把
 * GridService.buildGridPromptPayload(...) 的结果包成 SSE 返回。SKILL.md 仍然
 * 被加载到 ctx.skillPrompt，但当前未使用（保留为未来若要加 LLM 重排时的接入点）。
 *
 * 输入参数从前端的 payload.input 里读取：
 *   storyboard_ids: number[]   - 选中的分镜 id 列表（必须非空）
 *   rows / cols:    number     - 网格尺寸，必须正整数
 *   mode:           string     - 'continuous_motion' | 'multi_ref' (GridService 内部校验)
 *
 * target.drama_id / target.episode_id 用于权限校验和 ai_runs 落库。
 */

interface GridParams {
  dramaId: number
  episodeId: number
  userId: number
  storyboardIds: number[]
  rows: number
  cols: number
  mode?: string
}

function parseStoryboardIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => Number(item))
    .filter((item, index, array) => Number.isInteger(item) && item > 0 && array.indexOf(item) === index)
}

function parsePositiveInt(value: unknown, fieldName: string, fallback?: number) {
  if ((value == null || value === '') && fallback !== undefined) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive integer`)
  }
  return parsed
}

function parseParams(payload: any, userId: number): GridParams {
  const dramaId = Number(payload?.target?.drama_id)
  const episodeId = Number(payload?.target?.episode_id)
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    throw new BadRequestException('target.drama_id is required for skill=grid_prompt_generator')
  }
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    throw new BadRequestException('target.episode_id is required for skill=grid_prompt_generator')
  }

  const input = payload?.input || {}
  const storyboardIds = parseStoryboardIds(input.storyboard_ids)
  if (!storyboardIds.length) {
    throw new BadRequestException('input.storyboard_ids must be a non-empty array')
  }
  const rows = parsePositiveInt(input.rows, 'input.rows', 2)
  const cols = parsePositiveInt(input.cols, 'input.cols', 2)
  const mode = typeof input.mode === 'string' && input.mode.trim() ? input.mode.trim() : undefined

  return { dramaId, episodeId, userId, storyboardIds, rows, cols, mode }
}

export const gridPromptHandler: SkillHandler = async (ctx) => {
  const params = parseParams(ctx.payload, ctx.currentUser.id)
  await requireOwnedDrama(ctx.databaseService, params.dramaId, params.userId)
  await requireOwnedEpisode(ctx.databaseService, params.episodeId, params.userId)

  if (!ctx.stream) {
    const payload = await computeGridPayload(ctx, params)
    await recordRun(ctx, params, payload)
    return {
      response: {
        type: 'done' as const,
        text: payload.grid_prompt,
        references: [],
        actions: [],
      },
    }
  }

  const { stream, emitter } = createSseTransform()

  void (async () => {
    try {
      await emitter.writeRaw(':ok\n\n')
      await emitter.send({ type: 'status', text: '正在读取分镜与参考素材...' }, 'message')
      const payload = await computeGridPayload(ctx, params)
      await recordRun(ctx, params, payload)
      await emitter.send({ type: 'status', text: '宫格提示词已生成' }, 'message')
      await emitter.send({
        type: 'done',
        payload,
        tools_called: ['backend_grid_prompt_payload'],
      }, 'message')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Grid prompt generation failed'
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

async function computeGridPayload(ctx: SkillHandlerContext, params: GridParams) {
  return ctx.services.gridService.buildGridPromptPayload({
    userId: params.userId,
    dramaId: params.dramaId,
    episodeId: params.episodeId,
    storyboardIds: params.storyboardIds,
    rows: params.rows,
    cols: params.cols,
    mode: params.mode,
  })
}

async function recordRun(
  ctx: SkillHandlerContext,
  params: GridParams,
  payload: { grid_prompt: string },
) {
  await persistAiRun(ctx.databaseService, {
    userId: ctx.currentUser.id,
    skillId: 'grid_prompt_generator',
    mode: String(ctx.payload?.mode || 'grid_prompt'),
    scene: String(ctx.payload?.scene || 'grid_tool'),
    targetType: 'episode',
    targetId: params.episodeId,
    userMessage: typeof ctx.payload?.input?.message === 'string'
      ? ctx.payload.input.message
      : '生成宫格提示词',
    // Truncate prompt to avoid bloating ai_runs.assistant_message; the full
    // payload (with cell_prompts) lives in the SSE 'done' event the frontend
    // already captured and renders.
    assistantMessage: String(payload.grid_prompt || '').slice(0, 4000),
  })
}
