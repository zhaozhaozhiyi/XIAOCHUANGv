import { BadRequestException, Body, Controller, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../auth/current-user.decorator'
import { SessionAuthGuard } from '../../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../../auth/auth.types'
import { CanvasRunService } from '../canvas-run.service'
import { CanvasService } from '../canvas.service'

@ApiTags('canvas')
@Controller('canvases')
@UseGuards(SessionAuthGuard)
export class CanvasRunController {
  constructor(
    @Inject(CanvasRunService) private readonly canvasRunService: CanvasRunService,
    @Inject(CanvasService) private readonly canvasService: CanvasService,
  ) {}

  // POST /canvases/:id/run
  @Post(':id/run')
  async run(@Param('id') id: string, @Body() body: { versionLabel?: string }, @CurrentUser() user: CurrentUserType) {
    await this.canvasService.requireOwnedCanvas(id, user.id)
    const result = await this.canvasRunService.triggerRun(id, user.id, body?.versionLabel)
    return { code: 0, message: 'ok', data: result }
  }

  // GET /canvases/:id/run-status
  @Get(':id/run-status')
  async runStatus(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    await this.canvasService.requireOwnedCanvas(id, user.id)
    const result = await this.canvasRunService.getRunStatus(id)
    return { code: 0, message: 'ok', data: result }
  }

  // POST /canvases/:id/run/cancel
  @Post(':id/run/cancel')
  async cancelRun(@Param('id') id: string, @CurrentUser() user: CurrentUserType) {
    await this.canvasService.requireOwnedCanvas(id, user.id)
    const result = await this.canvasRunService.cancelRun(id)
    return { code: 0, message: 'ok', data: result }
  }

  // GET /canvases/:id/versions
  @Get(':id/versions')
  async versions(@Param('id') id: string, @Query('type') type: string | undefined, @CurrentUser() user: CurrentUserType) {
    await this.canvasService.requireOwnedCanvas(id, user.id)
    const result = await this.canvasRunService.listVersions(id, type)
    return { code: 0, message: 'ok', data: result }
  }

  // GET /canvases/:id/versions/:vid
  @Get(':id/versions/:vid')
  async versionDetail(@Param('id') id: string, @Param('vid') vid: string, @CurrentUser() user: CurrentUserType) {
    await this.canvasService.requireOwnedCanvas(id, user.id)
    const result = await this.canvasRunService.getVersionDetail(vid, id)
    return { code: 0, message: 'ok', data: result }
  }

  // POST /canvases/:id/snapshots
  @Post(':id/snapshots')
  async createSnapshot(@Param('id') id: string, @Body() body: { label: string }, @CurrentUser() user: CurrentUserType) {
    if (!body.label?.trim()) throw new BadRequestException('snapshot label is required')
    await this.canvasService.requireOwnedCanvas(id, user.id)
    const result = await this.canvasRunService.createSnapshot(id, body.label.trim())
    return { code: 0, message: 'ok', data: { snapshot: result } }
  }

  // POST /canvases/:id/snapshots/:sid/restore
  @Post(':id/snapshots/:sid/restore')
  async restoreSnapshot(@Param('id') id: string, @Param('sid') sid: string, @CurrentUser() user: CurrentUserType) {
    await this.canvasService.requireOwnedCanvas(id, user.id)
    const result = await this.canvasRunService.restoreSnapshot(sid, id)
    return { code: 0, message: 'ok', data: result }
  }
}
