import { Body, Controller, Delete, Get, Inject, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { toSnakeCase, toSnakeCaseArray } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import { agentConfigs } from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'

const agentCreateSchema = z.object({
  agent_type: z.string().trim(),
  name: z.string().trim().optional(),
  description: z.string().trim().optional(),
  model: z.string().trim().optional(),
  system_prompt: z.string().trim().optional(),
  temperature: z.coerce.number().optional(),
  max_tokens: z.coerce.number().optional(),
  max_iterations: z.coerce.number().optional(),
  is_active: z.coerce.boolean().optional(),
})

const agentUpdateSchema = z.object({
  name: z.string().trim().optional(),
  description: z.string().trim().optional(),
  model: z.string().trim().optional(),
  system_prompt: z.string().trim().optional(),
  temperature: z.coerce.number().optional(),
  max_tokens: z.coerce.number().optional(),
  max_iterations: z.coerce.number().optional(),
  is_active: z.coerce.boolean().optional(),
})

function now() {
  return new Date()
}

function parseId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('invalid agent config id')
  }
  return id
}

function toOptionalString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function toOptionalNumber(value: unknown) {
  return typeof value === 'number' ? value : null
}

function toOptionalBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && (value === 0 || value === 1)) return Boolean(value)
  return null
}

@ApiTags('agent-configs')
@Controller('agent-configs')
@UseGuards(SessionAuthGuard)
export class AgentConfigsController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get()
  async list(@CurrentUser() currentUser: CurrentUserType) {
    const rows = await this.databaseService.db
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.userId, currentUser.id), isNull(agentConfigs.deletedAt)))

    rows.sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
    return toSnakeCaseArray(rows as unknown as Record<string, unknown>[])
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const agentId = parseId(id)
    const [row] = await this.databaseService.db
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.id, agentId), eq(agentConfigs.userId, currentUser.id), isNull(agentConfigs.deletedAt)))

    if (!row) {
      return { error: 'not_found' }
    }

    return toSnakeCase(row as unknown as Record<string, unknown>)
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const payload = agentCreateSchema.parse(body)
    const [existing] = await this.databaseService.db
      .select()
      .from(agentConfigs)
      .where(and(eq(agentConfigs.agentType, payload.agent_type), eq(agentConfigs.userId, currentUser.id), isNull(agentConfigs.deletedAt)))

    const ts = now()

    if (existing) {
      await this.databaseService.db.update(agentConfigs)
        .set({
          name: payload.name ?? existing.name,
          description: payload.description ?? existing.description,
          model: payload.model ?? existing.model,
          systemPrompt: payload.system_prompt ?? existing.systemPrompt,
          temperature: payload.temperature ?? existing.temperature,
          maxTokens: payload.max_tokens ?? existing.maxTokens,
          maxIterations: payload.max_iterations ?? existing.maxIterations,
          isActive: payload.is_active ?? true,
          deletedAt: null,
          updatedAt: ts,
        })
        .where(eq(agentConfigs.id, existing.id))

      const [row] = await this.databaseService.db
        .select()
        .from(agentConfigs)
        .where(and(eq(agentConfigs.id, existing.id), eq(agentConfigs.userId, currentUser.id)))
      return toSnakeCase(row as unknown as Record<string, unknown>)
    }

    const [row] = await this.databaseService.db
      .insert(agentConfigs)
      .values({
        userId: currentUser.id,
        agentType: payload.agent_type,
        name: payload.name ?? '',
        description: payload.description ?? '',
        model: payload.model ?? '',
        systemPrompt: payload.system_prompt ?? '',
        temperature: payload.temperature ?? 0.7,
        maxTokens: payload.max_tokens ?? 4096,
        maxIterations: payload.max_iterations ?? 10,
        isActive: payload.is_active ?? true,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    return toSnakeCase(row as unknown as Record<string, unknown>)
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const agentId = parseId(id)
    const payload = agentUpdateSchema.parse(body)
    const updates: Partial<typeof agentConfigs.$inferInsert> = { updatedAt: now() }
    let hasUpdates = false

    if ('model' in payload && payload.model !== undefined) {
      updates.model = payload.model
      hasUpdates = true
    }
    if ('temperature' in payload && payload.temperature !== undefined) {
      updates.temperature = payload.temperature
      hasUpdates = true
    }
    if ('max_tokens' in payload && payload.max_tokens !== undefined) {
      updates.maxTokens = payload.max_tokens
      hasUpdates = true
    }
    if ('max_iterations' in payload && payload.max_iterations !== undefined) {
      updates.maxIterations = payload.max_iterations
      hasUpdates = true
    }
    if ('is_active' in payload && payload.is_active !== undefined) {
      updates.isActive = payload.is_active
      hasUpdates = true
    }
    if ('system_prompt' in payload && payload.system_prompt !== undefined) {
      updates.systemPrompt = payload.system_prompt
      hasUpdates = true
    }
    if ('name' in payload && payload.name !== undefined) {
      updates.name = payload.name
      hasUpdates = true
    }
    if ('description' in payload && payload.description !== undefined) {
      updates.description = payload.description
      hasUpdates = true
    }

    if (!hasUpdates) {
      return { error: 'no_valid_fields' }
    }

    const result = await this.databaseService.db
      .update(agentConfigs)
      .set(updates)
      .where(and(eq(agentConfigs.id, agentId), eq(agentConfigs.userId, currentUser.id)))
      .returning()

    const row = result[0]
    if (!row) {
      return { error: 'not_found' }
    }

    return toSnakeCase(row as unknown as Record<string, unknown>)
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const agentId = parseId(id)
    const result = await this.databaseService.db
      .update(agentConfigs)
      .set({ deletedAt: now() })
      .where(and(eq(agentConfigs.id, agentId), eq(agentConfigs.userId, currentUser.id)))
      .returning({ id: agentConfigs.id })

    if (!result.length) {
      return { error: 'not_found' }
    }

    return { success: true }
  }
}
