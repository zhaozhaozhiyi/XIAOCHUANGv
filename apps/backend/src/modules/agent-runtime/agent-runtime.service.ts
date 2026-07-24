import { Inject, Injectable } from "@nestjs/common";

import type { AgentRunProfile } from "./agent-runtime.types";
import { HermesRuntimeAdapter } from "./hermes-runtime.adapter";

@Injectable()
export class AgentRuntimeService {
  constructor(
    @Inject(HermesRuntimeAdapter)
    private readonly hermesRuntimeAdapter: HermesRuntimeAdapter,
  ) {}

  isEnabled() {
    return this.hermesRuntimeAdapter.isEnabled();
  }

  run(profile: AgentRunProfile) {
    return this.hermesRuntimeAdapter.run(profile);
  }

  stop(executionId: number, userId: number) {
    return this.hermesRuntimeAdapter.stop(executionId, userId);
  }

  reconcileActive(limit: number) {
    return this.hermesRuntimeAdapter.reconcileActive(limit);
  }
}
