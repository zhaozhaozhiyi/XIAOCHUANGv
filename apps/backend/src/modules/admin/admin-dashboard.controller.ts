import { Controller, Get, Inject, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { count, desc, eq, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { dramas, subscriptions, users } from '../../db/schema'
import { Roles } from '../auth/roles.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'

@ApiTags('admin')
@Controller('admin/overview')
@UseGuards(SessionAuthGuard)
@Roles('admin', 'super_admin')
export class AdminDashboardController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get()
  async getOverview() {
    const [userCountResult] = await this.databaseService.db
      .select({ count: count() })
      .from(users)
      .where(isNull(users.deletedAt))

    const [dramaCountResult] = await this.databaseService.db
      .select({ count: count() })
      .from(dramas)
      .where(isNull(dramas.deletedAt))

    const [subscriptionCountResult] = await this.databaseService.db
      .select({ count: count() })
      .from(subscriptions)
      .where(eq(subscriptions.status, 'active'))

    const recentUsers = await this.databaseService.db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        phone: users.phone,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(isNull(users.deletedAt))
      .orderBy(desc(users.createdAt))
      .limit(10)

    return {
      stats: {
        userCount: userCountResult?.count ?? 0,
        dramaCount: dramaCountResult?.count ?? 0,
        activeSubscriptionCount: subscriptionCountResult?.count ?? 0,
      },
      recentUsers,
    }
  }
}
