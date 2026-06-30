import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { DramasController } from './dramas.controller'

@Module({
  imports: [AuthModule],
  controllers: [DramasController],
})
export class DramasModule {}
