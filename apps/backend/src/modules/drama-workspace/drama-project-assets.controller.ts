import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { z } from 'zod'

import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { DramaProjectAssetsService, PROJECT_MEDIA_KINDS } from './drama-project-assets.service'

const assetQuerySchema = z.object({
  kind: z.enum(PROJECT_MEDIA_KINDS).optional(),
  scope: z.string().trim().optional(),
  status: z.string().trim().optional(),
  review_status: z.string().trim().optional(),
  quality_status: z.string().trim().optional(),
  needs_attention: z.coerce.boolean().optional(),
  role: z.string().trim().optional(),
  episode_id: z.coerce.number().int().positive().optional(),
  storyboard_id: z.coerce.number().int().positive().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(50),
})

const createFromCanvasSchema = z.object({
  canvas_id: z.string().trim().min(1),
  node_id: z.string().trim().min(1),
  result_id: z.string().trim().optional(),
  asset_scope: z.enum(['project', 'episode', 'storyboard', 'canvas']).default('project'),
  asset_role: z.string().trim().min(1).default('reference'),
  episode_id: z.coerce.number().int().positive().optional(),
  storyboard_id: z.coerce.number().int().positive().optional(),
  target_type: z.enum(['character', 'scene', 'storyboard', 'episode', 'drama']).optional(),
  target_id: z.string().trim().optional(),
  target_field: z.string().trim().optional(),
  title: z.string().trim().optional(),
})

const commitSchema = z.object({
  target_type: z.enum(['character', 'scene', 'storyboard', 'episode', 'drama']),
  target_id: z.string().trim().min(1),
  target_field: z.string().trim().min(1),
  commit_scope: z.enum(['project', 'episode', 'storyboard']).default('project'),
  replace_existing: z.boolean().optional(),
})

function parsePositiveId(value: string, code: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(code)
  return id
}

@ApiTags('drama-workspace')
@Controller('dramas/:dramaId/project-assets')
@UseGuards(SessionAuthGuard)
export class DramaProjectAssetsController {
  constructor(@Inject(DramaProjectAssetsService) private readonly service: DramaProjectAssetsService) {}

  @Get()
  async list(
    @Param('dramaId') dramaIdValue: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parsePositiveId(dramaIdValue, 'invalid_drama_id')
    const parsed = assetQuerySchema.parse(query)
    return this.service.listProjectAssets(dramaId, currentUser.id, {
      kind: parsed.kind,
      scope: parsed.scope,
      status: parsed.status,
      reviewStatus: parsed.review_status,
      qualityStatus: parsed.quality_status,
      needsAttention: parsed.needs_attention,
      role: parsed.role,
      episodeId: parsed.episode_id,
      storyboardId: parsed.storyboard_id,
      q: parsed.q,
      page: parsed.page,
      pageSize: parsed.page_size,
    })
  }

  @Post('from-canvas-result')
  @HttpCode(HttpStatus.CREATED)
  async createFromCanvasResult(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parsePositiveId(dramaIdValue, 'invalid_drama_id')
    const parsed = createFromCanvasSchema.parse(body)
    return this.service.createCandidateFromCanvasResult(dramaId, currentUser.id, {
      canvasId: parsed.canvas_id,
      nodeId: parsed.node_id,
      resultId: parsed.result_id,
      assetScope: parsed.asset_scope,
      assetRole: parsed.asset_role,
      episodeId: parsed.episode_id,
      storyboardId: parsed.storyboard_id,
      targetType: parsed.target_type,
      targetId: parsed.target_id,
      targetField: parsed.target_field,
      title: parsed.title,
    })
  }

  @Post(':assetId/commit')
  async commit(
    @Param('dramaId') dramaIdValue: string,
    @Param('assetId') assetIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parsePositiveId(dramaIdValue, 'invalid_drama_id')
    const assetId = parsePositiveId(assetIdValue, 'invalid_asset_id')
    const parsed = commitSchema.parse(body)
    return this.service.commitProjectAsset(dramaId, currentUser.id, assetId, {
      targetType: parsed.target_type,
      targetId: parsed.target_id,
      targetField: parsed.target_field,
      commitScope: parsed.commit_scope,
      replaceExisting: parsed.replace_existing,
    })
  }

  @Post(':assetId/reject')
  async reject(
    @Param('dramaId') dramaIdValue: string,
    @Param('assetId') assetIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.service.rejectProjectAsset(
      parsePositiveId(dramaIdValue, 'invalid_drama_id'),
      currentUser.id,
      parsePositiveId(assetIdValue, 'invalid_asset_id'),
    )
  }

  @Post(':assetId/archive')
  async archive(
    @Param('dramaId') dramaIdValue: string,
    @Param('assetId') assetIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.service.archiveProjectAsset(
      parsePositiveId(dramaIdValue, 'invalid_drama_id'),
      currentUser.id,
      parsePositiveId(assetIdValue, 'invalid_asset_id'),
    )
  }
}
