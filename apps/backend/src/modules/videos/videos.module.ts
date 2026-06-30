import { Module } from '@nestjs/common'

import { AiConfigsModule } from '../ai-configs/ai-configs.module'
import { AssetsModule } from '../assets/assets.module'
import { AuthModule } from '../auth/auth.module'
import { VideosController } from './videos.controller'
import { VideosService } from './videos.service'
import { VideosTasksService } from './videos.tasks'

@Module({
  imports: [AuthModule, AiConfigsModule, AssetsModule],
  controllers: [VideosController],
  providers: [VideosService, VideosTasksService],
  exports: [VideosService, VideosTasksService],
})
export class VideosModule {}
