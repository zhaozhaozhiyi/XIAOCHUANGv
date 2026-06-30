import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ScenesController } from './scenes.controller'

@Module({
  imports: [AuthModule],
  controllers: [ScenesController],
})
export class ScenesModule {}
