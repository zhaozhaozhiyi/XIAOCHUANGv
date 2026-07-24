import { Module } from '@nestjs/common'

import { AiConfigsModule } from '../ai-configs/ai-configs.module'
import { AssetsModule } from '../assets/assets.module'
import { DramaProductionBackfillModule } from '../drama-workspace/drama-production-backfill.module'
import { AudioController } from './audio.controller'
import { DialogueContinuityService } from './dialogue-continuity.service'
import { AudioService } from './audio.service'

@Module({
  imports: [AssetsModule, AiConfigsModule, DramaProductionBackfillModule],
  controllers: [AudioController],
  providers: [AudioService, DialogueContinuityService],
  exports: [AudioService, DialogueContinuityService],
})
export class AudioModule {}
