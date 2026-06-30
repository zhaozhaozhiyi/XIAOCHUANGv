import { BadRequestException, Controller, Get, Inject, Param, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { DatabaseService } from '../../db/database.service'
import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { requireOwnedEpisode } from '../images/images.ownership'
import { MergeService } from './merge.service'

function parsePositiveId(value: string, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`invalid ${label}`)
  }
  return id
}

@ApiTags('merge')
@Controller('merge')
@UseGuards(SessionAuthGuard)
export class MergeController {
  constructor(
    @Inject(MergeService) private readonly mergeService: MergeService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}

  @Get('episodes/:id/merge')
  async getEpisodeMerge(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parsePositiveId(id, 'episode id')
    await requireOwnedEpisode(this.databaseService, episodeId, currentUser.id)
    return this.mergeService.getLatestEpisodeMerge(episodeId)
  }

  @Post('episodes/:id/merge')
  async mergeEpisode(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parsePositiveId(id, 'episode id')
    const episode = await requireOwnedEpisode(this.databaseService, episodeId, currentUser.id)
    const mergeId = await this.mergeService.enqueueEpisodeMerge(episodeId, episode.dramaId, currentUser.id)

    return { merge_id: mergeId, status: 'queued' }
  }
}
