import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type {
  AgentRunProfile,
  HermesPoolInstance,
  HermesRuntimePool,
} from "./agent-runtime.types";

type HermesRuntimeConfig = {
  pools?: unknown;
  dedicatedPools?: unknown;
  dedicated_pools?: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((item) => stringValue(item)).filter(Boolean))]
    : [];
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

const TOOL_PROFILE_ALLOWED_TOOLS: Record<string, Set<string>> = {
  "xiaochuang-drama-source": new Set([
    "get_task_context",
    "list_source_chunks",
    "get_source_chunk",
    "submit_source_chunk_analysis",
    "submit_source_analysis",
    "report_progress",
    "complete_execution",
    "fail_execution",
  ]),
  "xiaochuang-drama-plan": new Set([
    "get_task_context",
    "list_source_chunks",
    "get_source_chunk",
    "submit_blueprint_batch",
    "report_progress",
    "complete_execution",
    "fail_execution",
  ]),
  "xiaochuang-drama-script": new Set([
    "get_task_context",
    "list_source_chunks",
    "get_source_chunk",
    "submit_episode_script",
    "report_progress",
    "complete_execution",
    "fail_execution",
  ]),
  "xiaochuang-drama-graph": new Set([
    "get_task_context",
    "list_episode_scripts",
    "get_episode_script",
    "submit_story_graph_batch",
    "report_progress",
    "complete_execution",
    "fail_execution",
  ]),
  "xiaochuang-drama-storyboard": new Set([
    "get_storyboard_task_context",
    "list_episode_script_segments",
    "get_episode_script_segment",
    "get_storyboard_assets",
    "submit_storyboard_batch",
    "report_progress",
    "complete_execution",
    "fail_execution",
  ]),
};

function skillManifest(value: unknown) {
  if (!Array.isArray(value)) return [];
  const entries = value.map((item) => {
    const raw = record(item);
    return {
      ref: stringValue(raw.ref),
      sha256: stringValue(raw.sha256).toLowerCase(),
    };
  });
  if (
    entries.some((item) => !item.ref || !/^[a-f0-9]{64}$/.test(item.sha256)) ||
    new Set(entries.map((item) => item.ref)).size !== entries.length
  ) {
    return [];
  }
  return entries;
}

function normalizeBaseUrl(value: unknown) {
  const baseUrl = stringValue(value).replace(/\/+$/, "");
  try {
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return baseUrl;
  } catch {
    return "";
  }
}

@Injectable()
export class HermesPoolRegistry {
  private readonly nextInstanceIndex = new Map<string, number>();

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  resolve(
    profile: Pick<
      AgentRunProfile,
      "toolProfile" | "modelProfile" | "skillRefs" | "organizationId"
    >,
  ) {
    const config = this.loadConfig();
    const dedicatedPoolName = this.findDedicatedPoolName(
      config,
      profile.organizationId,
    );
    const pools = this.parsePools(config.pools);
    const pool = dedicatedPoolName
      ? pools.find((candidate) => candidate.name === dedicatedPoolName)
      : pools.find(
          (candidate) => candidate.toolProfile === profile.toolProfile,
        );

    if (!pool) {
      throw new BadRequestException(
        `agent_runtime_unknown_tool_profile:${profile.toolProfile}`,
      );
    }
    if (pool.toolProfile !== profile.toolProfile) {
      throw new BadRequestException(
        `agent_runtime_dedicated_pool_profile_mismatch:${pool.name}`,
      );
    }
    if (pool.modelProfile !== profile.modelProfile) {
      throw new BadRequestException(
        `agent_runtime_model_profile_mismatch:${profile.modelProfile}`,
      );
    }

    const unsupportedSkill = profile.skillRefs.find(
      (skillRef) => !pool.skillRefs.includes(skillRef),
    );
    if (unsupportedSkill) {
      throw new BadRequestException(
        `agent_runtime_skill_not_allowed:${unsupportedSkill}`,
      );
    }
    return pool;
  }

  getCandidateInstances(pool: HermesRuntimePool) {
    const offset = this.nextInstanceIndex.get(pool.name) ?? 0;
    this.nextInstanceIndex.set(pool.name, (offset + 1) % pool.instances.length);
    return pool.instances.map(
      (_, index) => pool.instances[(offset + index) % pool.instances.length],
    );
  }

  findInstance(poolName: string, instanceName: string) {
    const config = this.loadConfig();
    const pool = this.parsePools(config.pools).find(
      (candidate) => candidate.name === poolName,
    );
    if (!pool) return null;
    const instance = pool.instances.find(
      (candidate) => candidate.name === instanceName,
    );
    return instance ? { pool, instance } : null;
  }

  private loadConfig(): HermesRuntimeConfig {
    const raw = this.configService.get<string>("HERMES_RUNTIME_POOLS_JSON");
    if (!raw?.trim()) {
      throw new ServiceUnavailableException(
        "hermes_runtime_pool_config_missing",
      );
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const value = record(parsed);
      if (!Object.keys(value).length) throw new Error("not_object");
      return value as HermesRuntimeConfig;
    } catch {
      throw new ServiceUnavailableException(
        "hermes_runtime_pool_config_invalid",
      );
    }
  }

  private findDedicatedPoolName(
    config: HermesRuntimeConfig,
    organizationId: number | null | undefined,
  ) {
    if (!organizationId) return "";
    const pools = record(config.dedicatedPools ?? config.dedicated_pools);
    return stringValue(pools[`org:${organizationId}`]);
  }

  private parsePools(value: unknown): HermesRuntimePool[] {
    if (!Array.isArray(value)) {
      throw new ServiceUnavailableException(
        "hermes_runtime_pool_config_invalid",
      );
    }

    const pools = value.map((item) => this.parsePool(item));
    if (
      !pools.length ||
      new Set(pools.map((pool) => pool.name)).size !== pools.length
    ) {
      throw new ServiceUnavailableException(
        "hermes_runtime_pool_config_invalid",
      );
    }
    return pools;
  }

  private parsePool(value: unknown): HermesRuntimePool {
    const raw = record(value);
    const name = stringValue(raw.name);
    const toolProfile = stringValue(raw.toolProfile ?? raw.tool_profile);
    const skillBundle = stringValue(raw.skillBundle ?? raw.skill_bundle);
    const manifest = skillManifest(raw.skillManifest ?? raw.skill_manifest);
    const skillRefs = manifest.map((item) => item.ref);
    const allowedTools = stringArray(raw.allowedTools ?? raw.allowed_tools);
    const profileAllowedTools = TOOL_PROFILE_ALLOWED_TOOLS[toolProfile];
    const unsupportedTool = allowedTools.find(
      (tool) => !profileAllowedTools?.has(tool),
    );
    const modelProfile = stringValue(raw.modelProfile ?? raw.model_profile);
    const maxConcurrentRuns = positiveInteger(
      raw.maxConcurrentRuns ?? raw.max_concurrent_runs,
    );
    const maxConcurrentRunsPerUser = positiveInteger(
      raw.maxConcurrentRunsPerUser ?? raw.max_concurrent_runs_per_user,
    );
    const instances = Array.isArray(raw.instances)
      ? raw.instances
          .map((item) => this.parseInstance(item))
          .filter((item): item is HermesPoolInstance => !!item)
      : [];

    if (
      !name ||
      !toolProfile ||
      !skillBundle ||
      !skillRefs.length ||
      !allowedTools.length ||
      !profileAllowedTools ||
      unsupportedTool ||
      !modelProfile ||
      !maxConcurrentRuns ||
      !maxConcurrentRunsPerUser ||
      !instances.length
    ) {
      throw new ServiceUnavailableException(
        "hermes_runtime_pool_config_invalid",
      );
    }

    return {
      name,
      toolProfile,
      skillBundle,
      skillRefs,
      skillManifest: manifest,
      allowedTools,
      modelProfile,
      maxConcurrentRuns,
      maxConcurrentRunsPerUser,
      instances,
    };
  }

  private parseInstance(value: unknown): HermesPoolInstance | null {
    const raw = record(value);
    const name = stringValue(raw.name);
    const baseUrl = normalizeBaseUrl(raw.baseUrl ?? raw.base_url);
    return name && baseUrl ? { name, baseUrl } : null;
  }
}
