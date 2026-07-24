import { Module } from '@nestjs/common'

import { AiConfigsModule } from '../ai-configs/ai-configs.module'
import { AssetsModule } from '../assets/assets.module'
import { AuthModule } from '../auth/auth.module'
import { DramaProductionBackfillModule } from '../drama-workspace/drama-production-backfill.module'
import { ImagesController } from './images.controller'
import { ImagesService } from './images.service'
import { ImagesTasksService } from './images.tasks'

@Module({
  imports: [AuthModule, AiConfigsModule, AssetsModule, DramaProductionBackfillModule],
  controllers: [ImagesController],
  providers: [ImagesService, ImagesTasksService],
  exports: [ImagesService, ImagesTasksService],
})
export class ImagesModule {}
