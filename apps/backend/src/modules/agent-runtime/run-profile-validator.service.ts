import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import type {
  AgentRunProfile,
  PreparedAgentRunProfile,
} from "./agent-runtime.types";
import { HermesPoolRegistry } from "./hermes-pool.registry";
import { SkillManifestService } from "./skill-manifest.service";

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`agent_runtime_invalid_${label}`);
  }
  return parsed;
}

function nullablePositiveInteger(value: unknown, label: string) {
  if (value == null) return null;
  return positiveInteger(value, label);
}

function cleanText(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`agent_runtime_invalid_${label}`);
  return text;
}

@Injectable()
export class RunProfileValidator {
  constructor(
    @Inject(HermesPoolRegistry)
    private readonly poolRegistry: HermesPoolRegistry,
    @Inject(SkillManifestService)
    private readonly skillManifestService: SkillManifestService,
  ) {}

  async prepare(input: AgentRunProfile): Promise<PreparedAgentRunProfile> {
    const skillRefs = [
      ...new Set(
        (input.skillRefs || [])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
      ),
    ];
    const profile: AgentRunProfile = {
      taskId: positiveInteger(input.taskId, "task_id"),
      userId: positiveInteger(input.userId, "user_id"),
      organizationId: nullablePositiveInteger(
        input.organizationId,
        "organization_id",
      ),
      dramaId: nullablePositiveInteger(input.dramaId, "drama_id"),
      toolProfile: cleanText(input.toolProfile, "tool_profile"),
      modelProfile: cleanText(input.modelProfile, "model_profile"),
      skillRefs,
      instruction: cleanText(input.instruction, "instruction"),
    };
    if (!profile.skillRefs.length)
      throw new BadRequestException("agent_runtime_skill_refs_required");

    const pool = this.poolRegistry.resolve(profile);
    const skillManifest = await this.skillManifestService.resolve(
      profile.skillRefs,
      pool.skillManifest,
    );
    return { profile, pool, skillManifest };
  }
}
