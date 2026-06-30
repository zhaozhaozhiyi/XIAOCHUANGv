import { Body, Controller, Get, Inject, Param, Post, Query, Res, UseGuards } from '@nestjs/common'
import { ApiBody, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import type { FastifyReply } from 'fastify'
import { z } from 'zod'

import { DatabaseService } from '../../db/database.service'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { AiService } from './ai.service'



class AiRuntimeApplyActionDto {
  @ApiProperty({ type: Number })
  action_index!: number
}

class AiRuntimeTargetDto {
  @ApiProperty({ type: String })
  type!: string

  @ApiPropertyOptional({ type: Number })
  writing_id?: number

  @ApiPropertyOptional({ type: Number })
  document_id?: number
}

class AiRuntimeInputDto {
  @ApiProperty({ type: String })
  message!: string

  @ApiPropertyOptional({ type: String, nullable: true })
  selection?: string | null
}

class AiRuntimeOptionsDto {
  @ApiPropertyOptional({ type: Boolean })
  stream?: boolean
}

class AiRuntimeRunDto {
  @ApiProperty({ type: String })
  skill_id!: string

  @ApiPropertyOptional({ type: String })
  mode?: string

  @ApiPropertyOptional({ type: String })
  scene?: string

  @ApiProperty({ type: AiRuntimeTargetDto })
  target!: AiRuntimeTargetDto

  @ApiProperty({ type: AiRuntimeInputDto })
  input!: AiRuntimeInputDto

  @ApiPropertyOptional({ type: AiRuntimeOptionsDto })
  options?: AiRuntimeOptionsDto
}

const listRunsQuerySchema = z.object({
  target_type: z.string().min(1),
  target_id: z.coerce.number().int().positive(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  before_id: z.coerce.number().int().positive().optional(),
  mode: z.string().min(1).optional(),
})

const applyActionSchema = z.object({
  action_index: z.number().int().nonnegative(),
})

// Target/input schemas are intentionally open. Per-skill handlers in
// apps/backend/src/modules/ai/skill-handlers/ validate the exact id shape
// they need (script_rewriter wants drama_id+episode_id, writing_copilot
// wants writing_id, grid_prompt wants storyboard_ids/rows/cols, etc).
// Keeping this layer permissive avoids a controller change every time a
// new skill comes online.
const runSchema = z.object({
  skill_id: z.string().min(1),
  mode: z.string().min(1).optional().default('continuation'),
  scene: z.string().min(1).optional().default('default'),
  target: z.object({
    type: z.string().min(1),
    writing_id: z.number().int().positive().optional(),
    document_id: z.number().int().positive().optional(),
    drama_id: z.number().int().positive().optional(),
    episode_id: z.number().int().positive().optional(),
    session_id: z.number().int().positive().optional(),
  }).passthrough(),
  input: z.object({
    message: z.string().min(1),
    selection: z.string().nullable().optional(),
  }).passthrough(),
  options: z.object({
    stream: z.boolean().optional().default(false),
  }).optional().default({ stream: false }),
})

@ApiTags('ai')
@Controller('ai')
@UseGuards(SessionAuthGuard)
export class AiController {
  constructor(
    @Inject(AiService) private readonly aiService: AiService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
  ) {}



  @Get('runs')
  async listRuns(
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const parsed = listRunsQuerySchema.parse(query)
    return this.aiService.listRuns({
      currentUser,
      databaseService: this.databaseService,
      targetType: parsed.target_type,
      targetId: parsed.target_id,
      limit: parsed.limit,
      beforeId: parsed.before_id,
      mode: parsed.mode,
    })
  }

  @Post('result-actions/:runId/apply')
  @ApiBody({ type: AiRuntimeApplyActionDto })
  async applyAction(
    @Param('runId') runId: string,
    @Body() body: AiRuntimeApplyActionDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const payload = applyActionSchema.parse(body)
    return this.aiService.applyAction({
      currentUser,
      databaseService: this.databaseService,
      runId: Number(runId),
      actionIndex: payload.action_index,
    })
  }

  @Post('runs')
  @ApiBody({ type: AiRuntimeRunDto })
  async run(
    @Body() body: AiRuntimeRunDto,
    @Query('stream') streamQuery: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const payload = runSchema.parse(body)
    const stream = payload.options.stream || streamQuery === '1'
    return this.aiService.run({ payload, stream, reply, currentUser, databaseService: this.databaseService })
  }
}
