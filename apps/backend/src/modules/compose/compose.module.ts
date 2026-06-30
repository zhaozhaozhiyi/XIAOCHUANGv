import { Module } from '@nestjs/common'

import { AudioModule } from '../audio/audio.module'
import { AuthModule } from '../auth/auth.module'
import { ComposeController } from './compose.controller'
import { ComposeService } from './compose.service'

@Module({
  imports: [AuthModule, AudioModule],
  controllers: [ComposeController],
  providers: [ComposeService],
  exports: [ComposeService],
})
export class ComposeModule {}
