import { BadRequestException, Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, asc, count, desc, eq, ilike, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { toSnakeCase } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import { dramas, episodes, storyboards, tasks } from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { buildDramaWorkspaceHref, resolveDramaWorkspaceTaskStage } from './drama-workspace-routing'

const taskQuerySchema = z.object({
  episode_id: z.coerce.number().int().positive().optional(),
  storyboard_id: z.coerce.number().int().positive().optional(),
  type: z.string().trim().optional(),
  status: z.string().trim().optional(),
  q: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(50),
  sort: z.enum(['created_at', 'updated_at']).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

function parsePositiveId(value: string, code: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) throw new BadRequestException(code)
  return id
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function serializeTask(task: typeof tasks.$inferSelect, episodeNumber?: number | null) {
  const payload = parseJsonValue(task.payloadJson) as Record<string, unknown> | null
  const stage = resolveDramaWorkspaceTaskStage(task)
  const sourceRoute = task.dramaId
    ? buildDramaWorkspaceHref(task.dramaId, stage, {
      episodeNumber,
      shotId: task.storyboardId,
      taskId: task.id,
      origin: 'task',
    })
    : null

  return {
    ...toSnakeCase(task as unknown as Record<string, unknown>),
    payload,
    result_summary: parseJsonValue(task.resultSummaryJson),
    error_details: parseJsonValue(task.errorDetailsJson),
    task_group_id: typeof payload?.task_group_id === 'string' ? payload.task_group_id : null,
    source_route: sourceRoute,
    source_stage: stage,
  }
}

function parseCsvFilter(value: string | undefined) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

@ApiTags('drama-workspace')
@Controller('dramas/:dramaId/tasks')
@UseGuards(SessionAuthGuard)
export class DramaProjectTasksController {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  @Get()
  async list(
    @Param('dramaId') dramaIdValue: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parsePositiveId(dramaIdValue, 'invalid_drama_id')
    const [drama] = await this.db.db
      .select({ id: dramas.id })
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id), isNull(dramas.deletedAt)))
    if (!drama) throw new BadRequestException('drama_not_found')

    const parsed = taskQuerySchema.parse(query)
    const conditions = [eq(tasks.userId, currentUser.id), eq(tasks.dramaId, dramaId), isNull(tasks.deletedAt)]
    if (parsed.episode_id) conditions.push(eq(tasks.episodeId, parsed.episode_id))
    if (parsed.storyboard_id) conditions.push(eq(tasks.storyboardId, parsed.storyboard_id))
    if (parsed.type) conditions.push(eq(tasks.type, parsed.type))
    const statusFilter = parseCsvFilter(parsed.status)
    if (statusFilter.length) conditions.push(inArray(tasks.status, statusFilter))
    if (parsed.q) conditions.push(ilike(tasks.title, `%${parsed.q}%`))

    const where = and(...conditions)
    const sortColumn = parsed.sort === 'created_at' ? tasks.createdAt : tasks.updatedAt
    const orderBy = parsed.order === 'asc' ? asc(sortColumn) : desc(sortColumn)
    const offset = (parsed.page - 1) * parsed.page_size

    const [summary] = await this.db.db.select({ total: count() }).from(tasks).where(where)
    const rows = await this.db.db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(orderBy)
      .limit(parsed.page_size)
      .offset(offset)

    const directEpisodeIds = rows
      .map((task) => task.episodeId)
      .filter((id): id is number => typeof id === 'number')
    const storyboardIds = rows
      .map((task) => task.storyboardId)
      .filter((id): id is number => typeof id === 'number')
    const storyboardRows = storyboardIds.length
      ? await this.db.db
        .select({ id: storyboards.id, episodeId: storyboards.episodeId })
        .from(storyboards)
        .where(inArray(storyboards.id, storyboardIds))
      : []
    const storyboardEpisodeById = new Map(storyboardRows.map((row) => [row.id, row.episodeId]))
    const episodeIds = [...new Set([
      ...directEpisodeIds,
      ...storyboardRows.map((row) => row.episodeId),
    ])]
    const episodeRows = episodeIds.length
      ? await this.db.db
        .select({ id: episodes.id, episodeNumber: episodes.episodeNumber })
        .from(episodes)
        .where(and(inArray(episodes.id, episodeIds), isNull(episodes.deletedAt)))
      : []
    const episodeNumberById = new Map(episodeRows.map((row) => [row.id, row.episodeNumber]))

    return {
      items: rows.map((task) => serializeTask(
        task,
        episodeNumberById.get(task.episodeId ?? storyboardEpisodeById.get(task.storyboardId ?? -1) ?? -1),
      )),
      total: Number(summary?.total ?? 0),
      page: parsed.page,
      page_size: parsed.page_size,
    }
  }
}
