import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { DramaShotProductionService } from './drama-shot-production.service'

function parsePositiveId(value: string, code: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(code)
  return id
}

@ApiTags('drama-workspace')
@Controller('dramas/:dramaId/shots')
@UseGuards(SessionAuthGuard)
export class DramaShotProductionController {
  constructor(@Inject(DramaShotProductionService) private readonly service: DramaShotProductionService) {}

  @Get()
  async list(
    @Param('dramaId') dramaIdValue: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.service.listShots(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id, query)
  }

  @Post('batch-preview')
  async preview(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.service.previewBatch(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id, body)
  }

  @Post('batch-generate')
  async generate(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.service.batchGenerate(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id, body)
  }
}
