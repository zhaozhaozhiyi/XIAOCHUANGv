import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { MergeController } from './merge.controller'
import { MergeService } from './merge.service'

@Module({
  imports: [AuthModule],
  controllers: [MergeController],
  providers: [MergeService],
  exports: [MergeService],
})
export class MergeModule {}
