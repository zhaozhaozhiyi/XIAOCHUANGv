import { BadRequestException, Body, Controller, Inject, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { AudioService } from './audio.service'

function parsePositiveId(value: string, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`invalid ${label}`)
  }
  return id
}

@ApiTags('audio')
@Controller()
@UseGuards(SessionAuthGuard)
export class AudioController {
  constructor(@Inject(AudioService) private readonly audioService: AudioService) {}

  @Post('audio/generate')
  async generateAudio(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = this.audioService.parseQuickAudioRequest(body)
    return this.audioService.generateQuickAudio({
      userId: currentUser.id,
      ...parsed,
    })
  }

  @Post('characters/:id/generate-voice-sample')
  async generateVoiceSample(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const characterId = parsePositiveId(id, 'character id')
    const episodeId = Number(body.episode_id)
    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      throw new BadRequestException('episode_id is required')
    }

    return this.audioService.generateVoiceSample({
      userId: currentUser.id,
      characterId,
      episodeId,
    })
  }

  @Post('storyboards/:id/generate-tts')
  async generateStoryboardTts(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const storyboardId = parsePositiveId(id, 'storyboard id')
    return this.audioService.generateStoryboardTts({
      userId: currentUser.id,
      storyboardId,
    })
  }
}
