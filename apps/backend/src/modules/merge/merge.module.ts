import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { EpisodeEditPlanService } from './episode-edit-plan.service'
import { MergeController } from './merge.controller'
import { MergeService } from './merge.service'

@Module({
  imports: [AuthModule],
  controllers: [MergeController],
  providers: [MergeService, EpisodeEditPlanService],
  exports: [MergeService, EpisodeEditPlanService],
})
export class MergeModule {}
