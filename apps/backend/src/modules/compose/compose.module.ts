import { Module } from '@nestjs/common'

import { AudioModule } from '../audio/audio.module'
import { AuthModule } from '../auth/auth.module'
import { DramaProductionBackfillModule } from '../drama-workspace/drama-production-backfill.module'
import { ComposeController } from './compose.controller'
import { ComposeService } from './compose.service'

@Module({
  imports: [AuthModule, AudioModule, DramaProductionBackfillModule],
  controllers: [ComposeController],
  providers: [ComposeService],
  exports: [ComposeService],
})
export class ComposeModule {}
