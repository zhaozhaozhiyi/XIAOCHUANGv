import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { HermesPoolRegistry } from "./hermes-pool.registry";
import { RunProfileValidator } from "./run-profile-validator.service";
import { SkillManifestService } from "./skill-manifest.service";

const skillContent = [
  "---",
  "name: drama_adaptation_copilot",
  "description: Short drama adaptation workflow.",
  "---",
  "",
  "Use only xiaochuang-drama MCP tools.",
].join("\n");

const skillSha256 = createHash("sha256")
  .update(skillContent, "utf8")
  .digest("hex");

function createValidator(overrides: Record<string, unknown> = {}) {
  const pools = [
    {
      name: "drama-source-pool",
      toolProfile: "xiaochuang-drama-source",
      skillBundle: "drama-source@1.0.0",
      skillManifest: [
        {
          ref: "drama_adaptation_copilot@1.0.0",
          sha256: skillSha256,
        },
      ],
      allowedTools: [
        "get_task_context",
        "list_source_chunks",
        "get_source_chunk",
        "submit_source_chunk_analysis",
        "submit_source_analysis",
        "report_progress",
        "complete_execution",
        "fail_execution",
      ],
      modelProfile: "xiaochuang-text-project",
      maxConcurrentRuns: 10,
      maxConcurrentRunsPerUser: 2,
      instances: [
        {
          name: "hermes-source-1",
          baseUrl: "http://127.0.0.1:8642/",
        },
      ],
      ...overrides,
    },
  ];
  const poolRegistry = new HermesPoolRegistry({
    get: <T>(key: string) => {
      if (key !== "HERMES_RUNTIME_POOLS_JSON") return undefined as T;
      return JSON.stringify({ pools }) as T;
    },
  } as any);
  const skillManifestService = new SkillManifestService({
    getSkillContent: (id: string[]) => {
      if (id.join("/") !== "drama_adaptation_copilot") {
        throw new Error("Skill not found");
      }
      return skillContent;
    },
  } as any);
  return new RunProfileValidator(poolRegistry, skillManifestService);
}

describe("RunProfileValidator", () => {
  it("prepares a run only with the pool-published skill manifest and tool profile", async () => {
    const validator = createValidator();

    await expect(
      validator.prepare({
        taskId: 42,
        userId: 7,
        organizationId: 3,
        dramaId: 282,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: [
          "drama_adaptation_copilot@1.0.0",
          "drama_adaptation_copilot@1.0.0",
        ],
        instruction: "Run source analysis.",
      }),
    ).resolves.toMatchObject({
      profile: {
        taskId: 42,
        userId: 7,
        organizationId: 3,
        dramaId: 282,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: ["drama_adaptation_copilot@1.0.0"],
      },
      pool: {
        name: "drama-source-pool",
        allowedTools: [
          "get_task_context",
          "list_source_chunks",
          "get_source_chunk",
          "submit_source_chunk_analysis",
          "submit_source_analysis",
          "report_progress",
          "complete_execution",
          "fail_execution",
        ],
      },
      skillManifest: [
        {
          ref: "drama_adaptation_copilot@1.0.0",
          id: "drama_adaptation_copilot",
          version: "1.0.0",
          sha256: skillSha256,
        },
      ],
    });
  });

  it("rejects a pool that grants tools outside its tool profile", async () => {
    const validator = createValidator({
      allowedTools: ["get_task_context", "submit_storyboard_batch"],
    });

    await expect(
      validator.prepare({
        taskId: 42,
        userId: 7,
        dramaId: 282,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: ["drama_adaptation_copilot@1.0.0"],
        instruction: "Run source analysis.",
      }),
    ).rejects.toThrow("hermes_runtime_pool_config_invalid");
  });

  it("rejects skill refs not published by the selected pool", async () => {
    const validator = createValidator();

    await expect(
      validator.prepare({
        taskId: 42,
        userId: 7,
        dramaId: 282,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: ["drama_storyboard_planning@1.0.0"],
        instruction: "Run source analysis.",
      }),
    ).rejects.toThrow(
      "agent_runtime_skill_not_allowed:drama_storyboard_planning@1.0.0",
    );
  });

  it("rejects a skill whose local content no longer matches the published manifest", async () => {
    const validator = createValidator({
      skillManifest: [
        {
          ref: "drama_adaptation_copilot@1.0.0",
          sha256: "b".repeat(64),
        },
      ],
    });

    await expect(
      validator.prepare({
        taskId: 42,
        userId: 7,
        dramaId: 282,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: ["drama_adaptation_copilot@1.0.0"],
        instruction: "Run source analysis.",
      }),
    ).rejects.toThrow(
      "agent_runtime_skill_hash_mismatch:drama_adaptation_copilot@1.0.0",
    );
  });

  it("rejects a model profile that does not match the selected pool", async () => {
    const validator = createValidator();

    await expect(
      validator.prepare({
        taskId: 42,
        userId: 7,
        dramaId: 282,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "hermes-local-text",
        skillRefs: ["drama_adaptation_copilot@1.0.0"],
        instruction: "Run source analysis.",
      }),
    ).rejects.toThrow("agent_runtime_model_profile_mismatch");
  });
});
