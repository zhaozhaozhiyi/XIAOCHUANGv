import { BadRequestException, Body, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { z } from 'zod'

import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { DramaProjectAssetsService } from './drama-project-assets.service'
import { DramaReviewService } from './drama-review.service'

const confirmSchema = z.object({
  subject_type: z.enum(['asset_link', 'episode_script', 'storyboard_set', 'episode_final']),
  subject_id: z.string().trim().optional(),
  asset_link_id: z.coerce.number().int().positive().optional(),
  version_key: z.string().trim().min(1),
  note: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.subject_type === 'asset_link' && !value.asset_link_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['asset_link_id'], message: 'asset_link_id_required' })
  }
  if (value.subject_type !== 'asset_link' && !value.subject_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subject_id'], message: 'subject_id_required' })
  }
})

const batchConfirmSchema = z.object({
  asset_link_ids: z.array(z.coerce.number().int().positive()).min(1).max(200),
  version_keys: z.record(z.string().min(1)),
})

const reworkSchema = z.object({
  subject_type: z.enum(['asset_link', 'episode_script', 'storyboard_set', 'episode_final']),
  subject_id: z.string().trim().optional(),
  asset_link_id: z.coerce.number().int().positive().optional(),
  reason_code: z.string().trim().min(1).max(80),
  note: z.string().trim().max(2000).optional(),
}).superRefine((value, ctx) => {
  if (value.subject_type === 'asset_link' && !value.asset_link_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['asset_link_id'], message: 'asset_link_id_required' })
  }
  if (value.subject_type !== 'asset_link' && !value.subject_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subject_id'], message: 'subject_id_required' })
  }
})

function parsePositiveId(value: string, code: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(code)
  return id
}

@ApiTags('drama-workspace')
@Controller('dramas/:dramaId/reviews')
@UseGuards(SessionAuthGuard)
export class DramaReviewController {
  constructor(
    @Inject(DramaProjectAssetsService) private readonly assetsService: DramaProjectAssetsService,
    @Inject(DramaReviewService) private readonly reviewService: DramaReviewService,
  ) {}

  @Get('summary')
  async summary(
    @Param('dramaId') dramaIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.reviewService.getSummary(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id)
  }

  @Post('confirm')
  async confirm(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = confirmSchema.parse(body)
    if (parsed.subject_type !== 'asset_link') {
      return this.reviewService.confirm(
        parsePositiveId(dramaIdValue, 'invalid_drama_id'),
        currentUser.id,
        parsed.subject_type,
        parsed.subject_id!,
        parsed.version_key,
        parsed.note,
      )
    }
    return this.assetsService.confirmProjectAssetLink(
      parsePositiveId(dramaIdValue, 'invalid_drama_id'),
      currentUser.id,
      parsed.asset_link_id!,
      parsed.version_key,
      parsed.note,
    )
  }

  @Post('batch-confirm')
  async batchConfirm(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = batchConfirmSchema.parse(body)
    return this.assetsService.batchConfirmProjectAssetLinks(
      parsePositiveId(dramaIdValue, 'invalid_drama_id'),
      currentUser.id,
      { linkIds: parsed.asset_link_ids, versionKeys: parsed.version_keys },
    )
  }

  @Post('rework')
  async rework(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = reworkSchema.parse(body)
    if (parsed.subject_type !== 'asset_link') {
      return this.reviewService.requireRework(
        parsePositiveId(dramaIdValue, 'invalid_drama_id'),
        currentUser.id,
        parsed.subject_type,
        parsed.subject_id!,
        parsed.reason_code,
        parsed.note,
      )
    }
    return this.assetsService.requireProjectAssetRework(
      parsePositiveId(dramaIdValue, 'invalid_drama_id'),
      currentUser.id,
      parsed.asset_link_id!,
      parsed.reason_code,
      parsed.note,
    )
  }
}
