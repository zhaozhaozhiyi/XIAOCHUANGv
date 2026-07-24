import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { StoryboardsController } from './storyboards.controller'
import { StoryboardSetsService } from './storyboard-sets.service'

@Module({
  imports: [AuthModule],
  controllers: [StoryboardsController],
  providers: [StoryboardSetsService],
  exports: [StoryboardSetsService],
})
export class StoryboardsModule {}
