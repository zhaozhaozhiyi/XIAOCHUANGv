import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'

import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { sendSseReply } from '../ai/skill-handlers/_shared'
import { GridService } from './grid.service'

function parsePositiveInteger(value: unknown, field: string) {
  if (value == null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`invalid ${field}`)
  }
  return parsed
}

function parseRequiredPositiveInteger(value: string, field: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`invalid ${field}`)
  }
  return parsed
}

function parseStoryboardIds(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => (typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN))
    .filter((item, index, array) => Number.isInteger(item) && item > 0 && array.indexOf(item) === index)
}

function parseAssignments(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map((item) => {
    const row = item && typeof item === 'object' ? item as Record<string, unknown> : {}
    return {
      storyboard_id: parsePositiveInteger(row.storyboard_id, 'storyboard_id') ?? null,
      frame_type: typeof row.frame_type === 'string' ? row.frame_type : 'reference',
    }
  })
}

@ApiTags('grid')
@Controller('grid')
@UseGuards(SessionAuthGuard)
export class GridController {
  constructor(private readonly gridService: GridService) {}

  @Get('status/:id')
  async getStatus(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.gridService.getGridGenerationStatus(parseRequiredPositiveInteger(id, 'grid generation id'), currentUser.id)
  }

  @Post('prompt')
  async buildPrompt(
    @Body() body: Record<string, unknown>,
    @Query('stream') stream: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const params = {
      userId: currentUser.id,
      storyboardIds: parseStoryboardIds(body.storyboard_ids),
      dramaId: parsePositiveInteger(body.drama_id, 'drama_id'),
      episodeId: parsePositiveInteger(body.episode_id, 'episode_id'),
      rows: parsePositiveInteger(body.rows, 'rows') ?? 0,
      cols: parsePositiveInteger(body.cols, 'cols') ?? 0,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
    }

    if (stream === '1') {
      const encoder = new TextEncoder()
      const transform = new TransformStream()
      const writer = transform.writable.getWriter()
      const send = async (data: unknown, event?: string) => {
        const prefix = event ? `event: ${event}\n` : ''
        await writer.write(encoder.encode(`${prefix}data: ${JSON.stringify(data)}\n\n`))
      }

      void (async () => {
        try {
          await writer.write(encoder.encode(':ok\n\n'))
          await send({ type: 'status', message: '正在生成宫格提示词...' }, 'message')
          const payload = await this.gridService.buildGridPromptPayload(params)
          await send({ type: 'done', payload }, 'message')
        } catch (error) {
          const message = error instanceof Error ? error.message : '生成提示词失败'
          try {
            await send({ type: 'error', message }, 'message')
          } catch {
            // ignore
          }
        } finally {
          try {
            await writer.close()
          } catch {
            // ignore
          }
        }
      })()

      return sendSseReply(reply, transform.readable)
    }

    return this.gridService.buildGridPromptPayload(params)
  }

  @Post('generate')
  async generate(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.gridService.generateGridImage({
      userId: currentUser.id,
      storyboardIds: parseStoryboardIds(body.storyboard_ids),
      dramaId: parsePositiveInteger(body.drama_id, 'drama_id'),
      episodeId: parsePositiveInteger(body.episode_id, 'episode_id'),
      rows: parsePositiveInteger(body.rows, 'rows') ?? 0,
      cols: parsePositiveInteger(body.cols, 'cols') ?? 0,
      mode: typeof body.mode === 'string' ? body.mode : undefined,
      customPrompt: typeof body.custom_prompt === 'string' ? body.custom_prompt : undefined,
    })
  }

  @Post('split')
  async split(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.gridService.splitGeneratedGrid({
      userId: currentUser.id,
      generationId: parsePositiveInteger(body.generation_id, 'generation_id') ?? null,
      imageGenerationId: parsePositiveInteger(body.image_generation_id, 'image_generation_id') ?? null,
      imageUrl: typeof body.image_url === 'string' ? body.image_url : null,
      rows: parsePositiveInteger(body.rows, 'rows') ?? 0,
      cols: parsePositiveInteger(body.cols, 'cols') ?? 0,
      assignments: parseAssignments(body.assignments),
    })
  }
}
