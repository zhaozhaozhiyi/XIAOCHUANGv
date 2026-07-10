import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { DramasModule } from '../dramas/dramas.module'
import { EpisodesController } from './episodes.controller'

@Module({
  imports: [AuthModule, DramasModule],
  controllers: [EpisodesController],
})
export class EpisodesModule {}
