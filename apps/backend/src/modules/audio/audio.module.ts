import { Module } from '@nestjs/common'

import { AiConfigsModule } from '../ai-configs/ai-configs.module'
import { AssetsModule } from '../assets/assets.module'
import { AudioController } from './audio.controller'
import { AudioService } from './audio.service'

@Module({
  imports: [AssetsModule, AiConfigsModule],
  controllers: [AudioController],
  providers: [AudioService],
  exports: [AudioService],
})
export class AudioModule {}
