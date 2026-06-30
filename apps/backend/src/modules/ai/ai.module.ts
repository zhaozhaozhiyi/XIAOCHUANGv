import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { GridModule } from '../grid/grid.module'
import { AiController } from './ai.controller'
import { AiService } from './ai.service'

@Module({
  imports: [AuthModule, GridModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
