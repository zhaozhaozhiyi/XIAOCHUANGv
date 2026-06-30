import { Controller, Get, Inject, Param, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, count, desc, eq, ilike, isNull, or } from 'drizzle-orm'
import { z } from 'zod'

import { DatabaseService } from '../../db/database.service'
import { dramas, organizationMembers, organizations, subscriptions, users } from '../../db/schema'
import { Roles } from '../auth/roles.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'

const usersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  status: z.string().trim().optional(),
})

@ApiTags('admin')
@Controller('admin/users')
@UseGuards(SessionAuthGuard)
@Roles('admin', 'super_admin')
export class AdminUsersController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get()
  async listUsers(@Query() query: Record<string, unknown>) {
    const parsed = usersQuerySchema.parse(query)
    const conditions = [isNull(users.deletedAt)]

    if (parsed.status && parsed.status !== 'all') {
      conditions.push(eq(users.status, parsed.status))
    }

    if (parsed.search) {
      const keyword = `%${parsed.search}%`
      conditions.push(
        or(
          ilike(users.displayName, keyword),
          ilike(users.email, keyword),
          ilike(users.phone, keyword),
        )!,
      )
    }

    const where = and(...conditions)
    const offset = (parsed.page - 1) * parsed.pageSize

    const [summary] = await this.databaseService.db
      .select({ total: count() })
      .from(users)
      .where(where)

    const items = await this.databaseService.db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        phone: users.phone,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
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

  @Get(':id')
  async getUserDetail(@Param('id') id: string) {
    const userId = Number(id)
    if (!Number.isInteger(userId) || userId <= 0) {
      return {
        error: 'invalid_user_id',
      }
    }

    const [user] = await this.databaseService.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))

    if (!user) {
      return {
        error: 'user_not_found',
      }
    }

    const userDramas = await this.databaseService.db
      .select({
        id: dramas.id,
        title: dramas.title,
        status: dramas.status,
        totalEpisodes: dramas.totalEpisodes,
        createdAt: dramas.createdAt,
      })
      .from(dramas)
      .where(and(eq(dramas.userId, userId), isNull(dramas.deletedAt)))
      .orderBy(desc(dramas.createdAt))
      .limit(10)

    const [subscription] = await this.databaseService.db
      .select({
        id: subscriptions.id,
        planName: subscriptions.planName,
        status: subscriptions.status,
        startedAt: subscriptions.startedAt,
        expiresAt: subscriptions.expiresAt,
      })
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId))
      .orderBy(desc(subscriptions.createdAt))
      .limit(1)

    const [organization] = await this.databaseService.db
      .select({
        id: organizations.id,
        name: organizations.name,
        plan: organizations.plan,
      })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, userId))
      .limit(1)

    return {
      user,
      subscription: subscription ?? null,
      organization: organization ?? null,
      dramas: userDramas,
    }
  }
}
