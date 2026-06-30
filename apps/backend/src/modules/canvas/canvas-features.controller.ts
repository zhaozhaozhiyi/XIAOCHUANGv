import { Body, Controller, Get, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'

import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { CanvasAssetService } from './canvas-asset.service'
import { CanvasChatAgentService } from './canvas-chat-agent.service'
import { CanvasNodeResultService } from './canvas-node-result.service'
import { CanvasSkillOperation, CanvasSkillService } from './canvas-skill.service'
import { CanvasUploadService } from './canvas-upload.service'

@ApiTags('canvas')
@Controller('canvases')
@UseGuards(SessionAuthGuard)
export class CanvasFeaturesController {
  constructor(
    @Inject(CanvasUploadService) private readonly uploadService: CanvasUploadService,
    @Inject(CanvasAssetService) private readonly assetService: CanvasAssetService,
    @Inject(CanvasNodeResultService) private readonly nodeResultService: CanvasNodeResultService,
    @Inject(CanvasChatAgentService) private readonly chatAgentService: CanvasChatAgentService,
    @Inject(CanvasSkillService) private readonly skillService: CanvasSkillService,
  ) {}

  @Post(':id/uploads')
  async upload(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @CurrentUser() user: CurrentUserType,
  ) {
    const data = await this.uploadService.uploadToCanvas(id, user.id, request)
    return { code: 0, message: 'ok', data }
  }

  @Post(':id/assets')
  async saveAsset(
    @Param('id') id: string,
    @Body() body: { node_id: string; result_id?: string; title?: string },
    @CurrentUser() user: CurrentUserType,
  ) {
    const data = await this.assetService.createAssetFromNodeResult(id, user.id, body)
    return { code: 0, message: 'ok', data }
  }

  @Get(':id/nodes/:nodeId/results')
  async listResults(@Param('id') id: string, @Param('nodeId') nodeId: string) {
    const data = await this.nodeResultService.listResults(id, nodeId)
    return { code: 0, message: 'ok', data }
  }

  @Post(':id/nodes/:nodeId/results/:resultId/select')
  async selectResult(
    @Param('id') id: string,
    @Param('nodeId') nodeId: string,
    @Param('resultId') resultId: string,
  ) {
    const data = await this.nodeResultService.selectResult(id, nodeId, resultId)
    return { code: 0, message: 'ok', data }
  }

  @Post(':id/chat')
  async chat(
    @Param('id') id: string,
    @Body() body: { message: string; selected_node_ids?: string[] },
    @CurrentUser() user: CurrentUserType,
    @Res() reply: FastifyReply,
  ) {
    const result = await this.chatAgentService.handle(id, user.id, body)
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    })
    reply.raw.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`)
    reply.raw.write(`event: done\ndata: {}\n\n`)
    reply.raw.end()
  }

  @Post(':id/chat/plan/apply')
  async applyPlan(
    @Param('id') id: string,
    @Body() body: { operations: CanvasSkillOperation[] },
    @CurrentUser() user: CurrentUserType,
  ) {
    const data = await this.skillService.applyPlan(id, user.id, body.operations || [])
    return { code: 0, message: 'ok', data }
  }
}
