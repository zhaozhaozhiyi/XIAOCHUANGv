import { BadRequestException, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { DatabaseService } from '../../db/database.service'
import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { requireOwnedEpisode, requireOwnedStoryboard } from '../images/images.ownership'
import { ComposeService } from './compose.service'

function parsePositiveId(value: string, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`invalid ${label}`)
  }
  return id
}

@ApiTags('compose')
@Controller('compose')
@UseGuards(SessionAuthGuard)
export class ComposeController {
  constructor(
    @Inject(ComposeService) private readonly composeService: ComposeService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  @Get('episodes/:id/compose-status')
  async getEpisodeComposeStatus(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parsePositiveId(id, 'episode id')
    await requireOwnedEpisode(this.databaseService, episodeId, currentUser.id)
    return this.composeService.getEpisodeComposeStatus(episodeId)
  }

  @Post('storyboards/:id/compose')
  async composeStoryboard(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const storyboardId = parsePositiveId(id, 'storyboard id')
    await requireOwnedStoryboard(this.databaseService, storyboardId, currentUser.id)

    const taskId = await this.composeService.enqueueStoryboardCompose(storyboardId, currentUser.id)
    return { id: storyboardId, task_id: taskId, status: 'queued' }
  }

  @Post('episodes/:id/compose-all')
  async composeEpisode(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parsePositiveId(id, 'episode id')
    await requireOwnedEpisode(this.databaseService, episodeId, currentUser.id)

    return this.composeService.enqueueEpisodeCompose(episodeId, currentUser.id)
  }
}
