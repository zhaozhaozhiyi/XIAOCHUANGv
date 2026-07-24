import { Module } from '@nestjs/common'

import { AiConfigsModule } from '../ai-configs/ai-configs.module'
import { AssetsModule } from '../assets/assets.module'
import { AuthModule } from '../auth/auth.module'
import { DramaProductionBackfillModule } from '../drama-workspace/drama-production-backfill.module'
import { ContinuityProductionService } from './continuity-production.service'
import { ContinuityTailFrameService } from './continuity-tail-frame.service'
import { VideosController } from './videos.controller'
import { VideosService } from './videos.service'
import { VideosTasksService } from './videos.tasks'

@Module({
  imports: [AuthModule, AiConfigsModule, AssetsModule, DramaProductionBackfillModule],
  controllers: [VideosController],
  providers: [
    ContinuityTailFrameService,
    ContinuityProductionService,
    VideosService,
    VideosTasksService,
  ],
  exports: [
    ContinuityProductionService,
    VideosService,
    VideosTasksService,
  ],
})
export class VideosModule {}
