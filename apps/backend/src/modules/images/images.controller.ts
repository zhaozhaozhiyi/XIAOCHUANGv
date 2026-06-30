import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { ImagesService } from './images.service'

function parseId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException('invalid image generation id')
  }
  return id
}

@ApiTags('images')
@Controller('images')
@UseGuards(SessionAuthGuard)
export class ImagesController {
  constructor(@Inject(ImagesService) private readonly imagesService: ImagesService) {}

  @Get()
  async listImages(
    @Query('drama_id') dramaId: string | undefined,
    @Query('storyboard_id') storyboardId: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const rows = await this.imagesService.listOwnedImageGenerations(currentUser.id, {
      dramaId: dramaId ? Number(dramaId) : undefined,
      storyboardId: storyboardId ? Number(storyboardId) : undefined,
    })
    return rows.map((row) => this.imagesService.serializeImageGeneration(row))
  }

  @Get(':id')
  async getImage(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const record = await this.imagesService.loadOwnedImageGeneration(parseId(id), currentUser.id)
    return record ? this.imagesService.serializeImageGeneration(record) : null
  }

  @Post()
  async createImage(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const params = await this.imagesService.buildImageRequest(body, currentUser.id)
    const id = await this.imagesService.enqueueImageGeneration(params)

    const record = await this.imagesService.loadOwnedImageGeneration(id, currentUser.id)
    return record ? this.imagesService.serializeImageGeneration(record) : null
  }

  @Delete(':id')
  async deleteImage(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    await this.imagesService.deleteOwnedImageGeneration(parseId(id), currentUser.id)
    return null
  }
}
