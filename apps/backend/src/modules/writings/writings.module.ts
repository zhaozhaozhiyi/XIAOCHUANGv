import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AiModule } from '../ai/ai.module'
import { WritingAgentController } from './writing-agent.controller'
import { WritingsController } from './writings.controller'

@Module({
  imports: [AuthModule, AiModule],
  controllers: [WritingsController, WritingAgentController],
})
export class WritingsModule {}
