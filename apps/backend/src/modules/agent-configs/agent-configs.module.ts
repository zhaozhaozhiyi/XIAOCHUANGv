import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { AgentConfigsController } from './agent-configs.controller'

@Module({
  imports: [AuthModule],
  controllers: [AgentConfigsController],
})
export class AgentConfigsModule {}
