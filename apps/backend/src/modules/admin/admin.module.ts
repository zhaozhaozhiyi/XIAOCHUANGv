import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AdminDashboardController } from './admin-dashboard.controller'
import { AdminDramasController } from './admin-dramas.controller'
import { AdminSubscriptionsController } from './admin-subscriptions.controller'
import { AdminUsersController } from './admin-users.controller'

@Module({
  imports: [AuthModule],
  controllers: [
    AdminDashboardController,
    AdminDramasController,
    AdminSubscriptionsController,
    AdminUsersController,
  ],
})
export class AdminModule {}
