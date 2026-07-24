import { Module } from "@nestjs/common";

import { AiConfigsModule } from "../ai-configs/ai-configs.module";
import { DramasModule } from "../dramas/dramas.module";
import { SkillsModule } from "../skills/skills.module";
import { StoryboardsModule } from "../storyboards/storyboards.module";
import { AgentExecutionService } from "./agent-execution.service";
import { AgentRuntimeService } from "./agent-runtime.service";
import { CapabilityRefreshController } from "./capability-refresh.controller";
import { CapabilityRefreshService } from "./capability-refresh.service";
import { CapabilityTokenService } from "./capability-token.service";
import { CapabilityTokenRevocationService } from "./capability-token-revocation.service";
import { ConcurrencyBudgetService } from "./concurrency-budget.service";
import { HermesAgentClient } from "./hermes-agent.client";
import { HermesPoolRegistry } from "./hermes-pool.registry";
import { HermesRuntimeAdapter } from "./hermes-runtime.adapter";
import { ModelGatewayController } from "./model-gateway.controller";
import { ModelGatewayService } from "./model-gateway.service";
import { RunProfileValidator } from "./run-profile-validator.service";
import { SkillManifestService } from "./skill-manifest.service";
import { XiaochuangDramaMcpController } from "./xiaochuang-drama-mcp.controller";
import { XiaochuangDramaMcpService } from "./xiaochuang-drama-mcp.service";

@Module({
  imports: [AiConfigsModule, SkillsModule, DramasModule, StoryboardsModule],
  controllers: [
    CapabilityRefreshController,
    XiaochuangDramaMcpController,
    ModelGatewayController,
  ],
  providers: [
    AgentExecutionService,
    AgentRuntimeService,
    CapabilityRefreshService,
    CapabilityTokenService,
    CapabilityTokenRevocationService,
    ConcurrencyBudgetService,
    HermesAgentClient,
    HermesPoolRegistry,
    HermesRuntimeAdapter,
    ModelGatewayService,
    RunProfileValidator,
    SkillManifestService,
    XiaochuangDramaMcpService,
  ],
  exports: [
    AgentExecutionService,
    AgentRuntimeService,
    XiaochuangDramaMcpService,
  ],
})
export class AgentRuntimeModule {}
