import { Module } from '@nestjs/common'

import { AudioModule } from '../audio/audio.module'
import { AuthModule } from '../auth/auth.module'
import { ComposeModule } from '../compose/compose.module'
import { ImagesModule } from '../images/images.module'
import { MergeModule } from '../merge/merge.module'
import { VideosModule } from '../videos/videos.module'
import { TaskExecutionService } from './task-execution.service'
import { TasksController } from './tasks.controller'
import { TasksService } from './tasks.service'

@Module({
  imports: [AuthModule, ImagesModule, VideosModule, AudioModule, ComposeModule, MergeModule],
  controllers: [TasksController],
  providers: [TasksService, TaskExecutionService],
  exports: [TasksService, TaskExecutionService],
})
export class TasksModule {}
