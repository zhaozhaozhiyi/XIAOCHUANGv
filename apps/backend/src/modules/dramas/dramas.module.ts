import { Module } from '@nestjs/common'

import { AiConfigsModule } from '../ai-configs/ai-configs.module'
import { AuthModule } from '../auth/auth.module'
import { SkillsModule } from '../skills/skills.module'
import { StoryboardsModule } from '../storyboards/storyboards.module'
import { DramaAgentSchemaValidator, DramaAgentService, RemoteDramaAgentAdapter } from './drama-agent.service'
import { DramaAiFirstService } from './drama-ai-first.service'
import { DramaStoryGraphEmbeddingService } from './drama-story-graph-embedding.service'
import { DramaStoryGraphIndexService } from './drama-story-graph-index.service'
import { DramaStoryGraphService } from './drama-story-graph.service'
import { DramaStoryboardBreakdownService } from './drama-storyboard-breakdown.service'
import { DramasController } from './dramas.controller'

@Module({
  imports: [AuthModule, AiConfigsModule, SkillsModule, StoryboardsModule],
  controllers: [DramasController],
  providers: [
    DramaAiFirstService,
    DramaStoryGraphEmbeddingService,
    DramaStoryGraphIndexService,
    DramaStoryGraphService,
    DramaStoryboardBreakdownService,
    DramaAgentSchemaValidator,
    RemoteDramaAgentAdapter,
    DramaAgentService,
  ],
  exports: [
    DramaAiFirstService,
    DramaStoryGraphService,
    DramaStoryboardBreakdownService,
  ],
})
export class DramasModule {}
