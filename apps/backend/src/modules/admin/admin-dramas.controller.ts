import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, count, desc, eq, ilike, isNull } from 'drizzle-orm'
import { z } from 'zod'

import { DatabaseService } from '../../db/database.service'
import { dramas, users } from '../../db/schema'
import { Roles } from '../auth/roles.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'

const dramasQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().trim().optional(),
  genre: z.string().trim().optional(),
  search: z.string().trim().optional(),
})

@ApiTags('admin')
@Controller('admin/dramas')
@UseGuards(SessionAuthGuard)
@Roles('admin', 'super_admin')
export class AdminDramasController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get()
  async listDramas(@Query() query: Record<string, unknown>) {
    const parsed = dramasQuerySchema.parse(query)
    const conditions = [isNull(dramas.deletedAt)]

    if (parsed.status && parsed.status !== 'all') {
      conditions.push(eq(dramas.status, parsed.status))
    }

    if (parsed.genre && parsed.genre !== 'all') {
      conditions.push(eq(dramas.genre, parsed.genre))
    }

    if (parsed.search) {
      conditions.push(ilike(dramas.title, `%${parsed.search}%`))
    }

    const where = and(...conditions)
    const offset = (parsed.page - 1) * parsed.pageSize

    const [summary] = await this.databaseService.db
      .select({ total: count() })
      .from(dramas)
      .where(where)

    const items = await this.databaseService.db
      .select({
        id: dramas.id,
        title: dramas.title,
        genre: dramas.genre,
        status: dramas.status,
        totalEpisodes: dramas.totalEpisodes,
        reviewStatus: dramas.reviewStatus,
        createdAt: dramas.createdAt,
        authorId: users.id,
        authorDisplayName: users.displayName,
      })
      .from(dramas)
      .leftJoin(users, eq(users.id, dramas.userId))
      .where(where)
      .orderBy(desc(dramas.createdAt))
      .limit(parsed.pageSize)
      .offset(offset)

    return {
      items,
      pagination: {
        page: parsed.page,
        pageSize: parsed.pageSize,
        total: summary?.total ?? 0,
      },
    }
  }
}
