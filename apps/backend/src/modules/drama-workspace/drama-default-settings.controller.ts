import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { DramaDefaultSettingsService } from './drama-default-settings.service'

function parsePositiveId(value: string, code: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(code)
  return id
}

@ApiTags('drama-workspace')
@Controller('dramas/:dramaId/default-settings')
@UseGuards(SessionAuthGuard)
export class DramaDefaultSettingsController {
  constructor(@Inject(DramaDefaultSettingsService) private readonly service: DramaDefaultSettingsService) {}

  @Get()
  async get(
    @Param('dramaId') dramaIdValue: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.service.getResolvedSettings(parsePositiveId(dramaIdValue, 'invalid_drama_id'), currentUser.id)
  }

  @Patch()
  async update(
    @Param('dramaId') dramaIdValue: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const { version, ...patch } = body
    return this.service.updateSettings(
      parsePositiveId(dramaIdValue, 'invalid_drama_id'),
      currentUser.id,
      patch,
      typeof version === 'string' ? version : null,
    )
  }
}
