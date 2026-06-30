import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { EpisodesController } from './episodes.controller'

@Module({
  imports: [AuthModule],
  controllers: [EpisodesController],
})
export class EpisodesModule {}
