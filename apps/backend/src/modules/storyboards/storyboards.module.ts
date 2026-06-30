import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { StoryboardsController } from './storyboards.controller'

@Module({
  imports: [AuthModule],
  controllers: [StoryboardsController],
})
export class StoryboardsModule {}
