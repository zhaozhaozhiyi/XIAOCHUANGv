import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { z } from 'zod'

import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { DramaCanvasProjectionService } from './drama-canvas-projection.service'

const canvasListQuerySchema = z.object({
  episode_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
})

const createCanvasSchema = z.object({
  title: z.string().trim().optional(),
  scope: z.enum(['project', 'episode', 'storyboard']).default('project'),
  episode_id: z.coerce.number().int().positive().optional(),
  storyboard_id: z.coerce.number().int().positive().optional(),
  mode: z.enum(['blank', 'from_episode']).default('blank'),
})

const createFromEpisodeSchema = z.object({
  episode_id: z.coerce.number().int().positive(),
  title: z.string().trim().optional(),
  sync_mode: z.enum(['append_missing', 'rebuild_projection']).default('append_missing'),
  include: z.array(z.enum(['characters', 'scenes', 'storyboards', 'execution_nodes'])).optional(),
  layout: z.enum(['timeline', 'columns']).default('columns'),
})

const syncCanvasSchema = z.object({
  episode_id: z.coerce.number().int().positive().optional(),
  sync_mode: z.enum(['append_missing', 'rebuild_projection']).default('append_missing'),
  preserve_user_nodes: z.boolean().optional(),
  include: z.array(z.enum(['characters', 'scenes', 'storyboards', 'execution_nodes'])).optional(),
  layout: z.enum(['timeline', 'columns']).optional(),
})

function parsePositiveId(value: string, code: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(code)
  return id
}

@ApiTags('drama-workspace')
@Controller('dramas/:dramaId/canvases')
@UseGuards(SessionAuthGuard)
export class DramaCanvasController {
  constructor(@Inject(DramaCanvasProjectionService) private readonly service: DramaCanvasProjectionService) {}

  @Get()
  async list(
    @Param('dramaId') dramaIdValue: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = canvasListQuerySchema.parse(query)
    return this.service.listCanvases(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id, {
      episodeId: parsed.episode_id,
      page: parsed.page,
      pageSize: parsed.page_size,
    })
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = createCanvasSchema.parse(body)
    return this.service.createCanvas(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id, {
      title: parsed.title,
      scope: parsed.scope,
      episodeId: parsed.episode_id,
      storyboardId: parsed.storyboard_id,
      mode: parsed.mode,
    })
  }

  @Post('from-episode')
  @HttpCode(HttpStatus.CREATED)
  async createFromEpisode(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = createFromEpisodeSchema.parse(body)
    return this.service.createCanvasFromEpisode(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id, {
      episodeId: parsed.episode_id,
      title: parsed.title,
      syncMode: parsed.sync_mode,
      include: parsed.include,
      layout: parsed.layout,
    })
  }

  @Post(':canvasId/sync')
  async sync(
    @Param('dramaId') dramaIdValue: string,
    @Param('canvasId') canvasId: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = syncCanvasSchema.parse(body)
    return this.service.syncEpisodeToCanvas(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id, canvasId, {
      episodeId: parsed.episode_id,
      syncMode: parsed.sync_mode,
      preserveUserNodes: parsed.preserve_user_nodes,
      include: parsed.include,
      layout: parsed.layout,
    })
  }
}
