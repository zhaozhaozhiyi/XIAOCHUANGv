import { Controller, HttpCode, HttpStatus, Inject, Post, Req, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'

import { SessionAuthGuard } from '../auth/session-auth.guard'
import { UploadsService } from './uploads.service'

@ApiTags('upload')
@Controller('upload')
@UseGuards(SessionAuthGuard)
export class UploadsController {
  constructor(@Inject(UploadsService) private readonly uploadsService: UploadsService) {}

  @Post('image')
  @HttpCode(HttpStatus.OK)
  async uploadImage(@Req() request: FastifyRequest) {
    return this.uploadsService.uploadImage(request)
  }
}
