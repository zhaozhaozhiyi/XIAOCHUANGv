import { BadRequestException, Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { CurrentUser } from '../../auth/current-user.decorator'
import { SessionAuthGuard } from '../../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../../auth/auth.types'
import { CanvasService } from '../canvas.service'
import { BusinessActionService } from './business-action.service'

@ApiTags('canvas')
@Controller('canvases')
@UseGuards(SessionAuthGuard)
export class CanvasBusinessActionController {
  constructor(
    @Inject(BusinessActionService) private readonly businessActionService: BusinessActionService,
    @Inject(CanvasService) private readonly canvasService: CanvasService,
  ) {}

  // POST /canvases/:id/business-action
  // 前端期望: { code:0, data: { hidden_node_id, run_id } }
  @Post(':id/business-action')
  async trigger(
    @Param('id') id: string,
    @Body() body: {
      actionLabel: string
      sourceNodeId?: string
      sourceNodeDefId?: string
      userInput: string
      style?: string
      output_mode?: 'current_node' | 'insert_new_node'
      position_x?: number
      position_y?: number
      target_node_type?: string
    },
    @CurrentUser() user: CurrentUserType,
  ) {
    await this.canvasService.requireOwnedCanvas(id, user.id)
    if (!body.actionLabel) throw new BadRequestException('actionLabel 必填')

    const result = await this.businessActionService.triggerAction(id, user.id, {
      sourceNodeId: body.sourceNodeId,
      actionLabel: body.actionLabel,
      userInput: body.userInput || '',
      renderedPrompt: body.userInput || '',
      outputMode: body.output_mode,
      positionX: body.position_x,
      positionY: body.position_y,
      targetNodeType: body.target_node_type,
    })
    return { code: 0, message: 'ok', data: result }
  }
}
