import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, count, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { DatabaseService } from '../../db/database.service'
import { subscriptionPlans, subscriptions, users } from '../../db/schema'
import { Roles } from '../auth/roles.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'

const subscriptionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  status: z.string().trim().optional(),
})

@ApiTags('admin')
@Controller('admin/subscriptions')
@UseGuards(SessionAuthGuard)
@Roles('admin', 'super_admin')
export class AdminSubscriptionsController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get()
  async listSubscriptions(@Query() query: Record<string, unknown>) {
    const parsed = subscriptionsQuerySchema.parse(query)
    const conditions = []

    if (parsed.status && parsed.status !== 'all') {
      conditions.push(eq(subscriptions.status, parsed.status))
    }

    const where = conditions.length > 0 ? and(...conditions) : undefined
    const offset = (parsed.page - 1) * parsed.pageSize

    const [summary] = await this.databaseService.db
      .select({ total: count() })
      .from(subscriptions)
      .where(where)

    const items = await this.databaseService.db
      .select({
        id: subscriptions.id,
        userId: subscriptions.userId,
        planName: subscriptions.planName,
        status: subscriptions.status,
        startedAt: subscriptions.startedAt,
        expiresAt: subscriptions.expiresAt,
        createdAt: subscriptions.createdAt,
        userDisplayName: users.displayName,
        userEmail: users.email,
      })
      .from(subscriptions)
      .leftJoin(users, eq(users.id, subscriptions.userId))
      .where(where)
      .orderBy(desc(subscriptions.createdAt))
      .limit(parsed.pageSize)
      .offset(offset)

    const plans = await this.databaseService.db
      .select({
        id: subscriptionPlans.id,
        name: subscriptionPlans.name,
        displayName: subscriptionPlans.displayName,
        price: subscriptionPlans.price,
        priceUnit: subscriptionPlans.priceUnit,
      })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.isActive, true))
      .orderBy(subscriptionPlans.sortOrder)

    return {
      items,
      plans,
      pagination: {
        page: parsed.page,
        pageSize: parsed.pageSize,
        total: summary?.total ?? 0,
      },
    }
  }
}
