import { Module } from '@nestjs/common'

import { AiConfigsModule } from '../ai-configs/ai-configs.module'
import { AuthModule } from '../auth/auth.module'
import { DramaAgentSchemaValidator, DramaAgentService, RemoteDramaAgentAdapter } from './drama-agent.service'
import { DramaAiFirstService } from './drama-ai-first.service'
import { DramasController } from './dramas.controller'

@Module({
  imports: [AuthModule, AiConfigsModule],
  controllers: [DramasController],
  providers: [
    DramaAiFirstService,
    DramaAgentSchemaValidator,
    RemoteDramaAgentAdapter,
    DramaAgentService,
  ],
  exports: [DramaAiFirstService],
})
export class DramasModule {}
