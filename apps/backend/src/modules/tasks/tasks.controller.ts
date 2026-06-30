import { Body, Controller, Delete, Get, Inject, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, eq, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { toPublicMediaUrl } from '../../common/media-url'
import { toSnakeCase } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import { tasks } from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import { Roles } from '../auth/roles.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { TaskExecutionService } from './task-execution.service'
import { TasksService } from './tasks.service'

const taskListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().trim().optional(),
  status: z.string().trim().optional(),
  type: z.string().trim().optional(),
  source_type: z.string().trim().optional(),
  drama_id: z.coerce.number().int().positive().optional(),
  episode_id: z.coerce.number().int().positive().optional(),
  sort: z.enum(['created_at', 'updated_at']).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

const taskRecoverQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).default(20),
  dry_run: z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const normalized = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false
    return value
  }, z.boolean().default(false)),
})

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeResultSummary(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value

  const result = { ...(value as Record<string, unknown>) }
  for (const key of ['video_url', 'image_url', 'audio_url', 'provider_url', 'thumbnail_url']) {
    if (Object.prototype.hasOwnProperty.call(result, key)) {
      result[key] = toPublicMediaUrl(result[key] as string | null | undefined)
    }
  }
  return result
}

function serializeTask(task: typeof tasks.$inferSelect) {
  return {
    ...toSnakeCase(task as unknown as Record<string, unknown>),
    payload: parseJsonValue(task.payloadJson),
    result_summary: normalizeResultSummary(parseJsonValue(task.resultSummaryJson)),
    error_details: parseJsonValue(task.errorDetailsJson),
  }
}

function parseTaskId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error('invalid task id')
  }
  return id
}

@ApiTags('tasks')
@Controller('tasks')
@UseGuards(SessionAuthGuard)
export class TasksController {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(TasksService) private readonly tasksService: TasksService,
    @Inject(TaskExecutionService) private readonly taskExecutionService: TaskExecutionService,
  ) {}

  @Get()
  async listTasks(@Query() query: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const parsed = taskListQuerySchema.parse(query)
    let rows = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, currentUser.id), isNull(tasks.deletedAt)))

    const typeFilter = new Set(
      String(parsed.type || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    const sourceTypeFilter = new Set(
      String(parsed.source_type || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )
    const statusFilter = new Set(
      String(parsed.status || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean),
    )

    if (typeFilter.size) rows = rows.filter((row) => typeFilter.has(row.type))
    if (sourceTypeFilter.size) rows = rows.filter((row) => sourceTypeFilter.has(row.sourceType))
    if (statusFilter.size) rows = rows.filter((row) => statusFilter.has(row.status))
    if (parsed.drama_id) rows = rows.filter((row) => row.dramaId === parsed.drama_id)
    if (parsed.episode_id) rows = rows.filter((row) => row.episodeId === parsed.episode_id)

    if (parsed.q) {
      const keyword = parsed.q.toLowerCase()
      rows = rows.filter((row) => String(row.title || '').toLowerCase().includes(keyword))
    }

    const sortKey = parsed.sort === 'created_at' ? 'createdAt' : 'updatedAt'
    rows.sort((left, right) => {
      const leftValue = String(left[sortKey] || '')
      const rightValue = String(right[sortKey] || '')
      return parsed.order === 'asc'
        ? leftValue.localeCompare(rightValue)
        : rightValue.localeCompare(leftValue)
    })

    const total = rows.length
    const items = rows
      .slice((parsed.page - 1) * parsed.page_size, parsed.page * parsed.page_size)
      .map(serializeTask)

    return {
      items,
      total,
      page: parsed.page,
      page_size: parsed.page_size,
    }
  }

  @Get(':id')
  async getTask(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const taskId = parseTaskId(id)
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, currentUser.id), isNull(tasks.deletedAt)))

    if (!task) {
      return { error: 'task_not_found' }
    }

    return serializeTask(task)
  }

  @Post('recover')
  @Roles('admin', 'super_admin')
  async recoverTasks(@Query() query: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const parsed = taskRecoverQuerySchema.parse(query)
    return this.taskExecutionService.recoverPendingTasks(
      parsed.limit,
      parsed.dry_run,
      `api-${currentUser.id}-${Date.now()}`,
    )
  }

  @Delete(':id')
  async deleteTask(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const taskId = parseTaskId(id)
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.userId, currentUser.id), isNull(tasks.deletedAt)))

    if (!task) {
      return { error: 'task_not_found' }
    }

    await this.databaseService.db
      .update(tasks)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId))

    return { success: true }
  }

  @Post(':id/retry')
  async retryTask(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const taskId = parseTaskId(id)
    const result = await this.tasksService.retryTask(taskId, currentUser)
    await this.tasksService.refreshTaskPresentation(taskId)
    return result
  }

  @Post(':id/cancel')
  async cancelTask(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const taskId = parseTaskId(id)
    const result = await this.tasksService.cancelTask(taskId, currentUser)
    await this.tasksService.refreshTaskPresentation(taskId)
    return result
  }

  @Get(':id/logs')
  async listTaskLogs(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const taskId = parseTaskId(id)
    return this.tasksService.listTaskLogs(taskId)
  }

  @Post(':id/logs')
  async appendTaskLog(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const taskId = parseTaskId(id)
    await this.tasksService.appendTaskLog({
      taskId,
      userId: currentUser.id,
      level: String(body.level || 'info').trim() || 'info',
      message: String(body.message || '').trim(),
      metadata: body.metadata as Record<string, unknown> | undefined,
    })
    return { success: true }
  }
}
