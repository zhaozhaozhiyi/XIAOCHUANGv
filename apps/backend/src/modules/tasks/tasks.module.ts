import { Module } from '@nestjs/common'

import { AudioModule } from '../audio/audio.module'
import { AuthModule } from '../auth/auth.module'
import { ComposeModule } from '../compose/compose.module'
import { ImagesModule } from '../images/images.module'
import { MergeModule } from '../merge/merge.module'
import { VideosModule } from '../videos/videos.module'
import { ImageGenerationTaskHandler } from './domain-handlers/image-generation-task.handler'
import { StoryboardComposeTaskHandler } from './domain-handlers/storyboard-compose-task.handler'
import { StoryboardTtsTaskHandler } from './domain-handlers/storyboard-tts-task.handler'
import { VideoGenerationTaskHandler } from './domain-handlers/video-generation-task.handler'
import { VideoMergeTaskHandler } from './domain-handlers/video-merge-task.handler'
import { TaskDomainRegistry } from './task-domain.registry'
import { TaskExecutionService } from './task-execution.service'
import { TasksController } from './tasks.controller'
import { TasksService } from './tasks.service'

@Module({
  imports: [AuthModule, ImagesModule, VideosModule, AudioModule, ComposeModule, MergeModule],
  controllers: [TasksController],
  providers: [
    TasksService,
    TaskExecutionService,
    TaskDomainRegistry,
    ImageGenerationTaskHandler,
    VideoGenerationTaskHandler,
    StoryboardTtsTaskHandler,
    StoryboardComposeTaskHandler,
    VideoMergeTaskHandler,
  ],
  exports: [TasksService, TaskExecutionService, TaskDomainRegistry],
})
export class TasksModule {}
