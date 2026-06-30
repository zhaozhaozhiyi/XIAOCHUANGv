import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { VideosService } from './videos.service'

function parseId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException('invalid video generation id')
  }
  return id
}

@ApiTags('videos')
@Controller()
@UseGuards(SessionAuthGuard)
export class VideosController {
  constructor(@Inject(VideosService) private readonly videosService: VideosService) {}

  @Get('videos')
  async listVideos(
    @Query('drama_id') dramaId: string | undefined,
    @Query('storyboard_id') storyboardId: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const rows = await this.videosService.listOwnedVideoGenerations(currentUser.id, {
      dramaId: dramaId ? Number(dramaId) : undefined,
      storyboardId: storyboardId ? Number(storyboardId) : undefined,
    })
    return rows.map((row) => this.videosService.serializeVideoGeneration(row))
  }

  @Get('videos/:id')
  async getVideo(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const record = await this.videosService.loadOwnedVideoGeneration(parseId(id), currentUser.id)
    return record ? this.videosService.serializeVideoGeneration(record) : null
  }

  @Post('videos')
  async createVideo(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const params = await this.videosService.buildVideoRequest(body, currentUser.id)
    const id = await this.videosService.enqueueVideoGeneration(params)

    const record = await this.videosService.loadOwnedVideoGeneration(id, currentUser.id)
    return record ? this.videosService.serializeVideoGeneration(record) : null
  }

  @Delete('videos/:id')
  async deleteVideo(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    await this.videosService.deleteOwnedVideoGeneration(parseId(id), currentUser.id)
    return null
  }

  @Post('quick-videos')
  async createQuickVideo(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    return this.videosService.createQuickVideo(body, currentUser.id, false)
  }
}
