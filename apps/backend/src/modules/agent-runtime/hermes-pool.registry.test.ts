import { describe, expect, it } from "vitest";

import { HermesPoolRegistry } from "./hermes-pool.registry";

const skillHash = "a".repeat(64);

function createRegistry(pools: unknown, dedicatedPools?: unknown) {
  return new HermesPoolRegistry({
    get: <T>(key: string) => {
      if (key !== "HERMES_RUNTIME_POOLS_JSON") return undefined as T;
      return JSON.stringify({ pools, dedicatedPools }) as T;
    },
  } as any);
}

describe("HermesPoolRegistry", () => {
  it("routes a verified profile to its matching configured pool", () => {
    const registry = createRegistry([
      {
        name: "drama-source-pool",
        toolProfile: "xiaochuang-drama-source",
        skillBundle: "drama-source@1.0.0",
        skillManifest: [
          { ref: "drama_adaptation_copilot@1.0.0", sha256: skillHash },
        ],
        allowedTools: ["get_task_context", "get_source_chunk"],
        modelProfile: "xiaochuang-text-project",
        maxConcurrentRuns: 10,
        maxConcurrentRunsPerUser: 2,
        instances: [
          { name: "hermes-source-1", baseUrl: "http://127.0.0.1:8642" },
        ],
      },
    ]);

    expect(
      registry.resolve({
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: ["drama_adaptation_copilot@1.0.0"],
      }),
    ).toMatchObject({
      name: "drama-source-pool",
      allowedTools: ["get_task_context", "get_source_chunk"],
      skillManifest: [
        { ref: "drama_adaptation_copilot@1.0.0", sha256: skillHash },
      ],
    });
  });

  it("does not allow a dedicated pool to expand its tool profile", () => {
    const registry = createRegistry(
      [
        {
          name: "org-1001-plan-pool",
          toolProfile: "xiaochuang-drama-plan",
          skillBundle: "drama-plan@1.0.0",
          skillManifest: [
            { ref: "drama_adaptation_copilot@1.0.0", sha256: skillHash },
          ],
          allowedTools: ["get_task_context", "submit_blueprint_batch"],
          modelProfile: "xiaochuang-text-project",
          maxConcurrentRuns: 10,
          maxConcurrentRunsPerUser: 2,
          instances: [
            { name: "hermes-plan-1", baseUrl: "http://127.0.0.1:8642" },
          ],
        },
      ],
      { "org:1001": "org-1001-plan-pool" },
    );

    expect(() =>
      registry.resolve({
        organizationId: 1001,
        toolProfile: "xiaochuang-drama-source",
        modelProfile: "xiaochuang-text-project",
        skillRefs: ["drama_adaptation_copilot@1.0.0"],
      }),
    ).toThrow("agent_runtime_dedicated_pool_profile_mismatch");
  });
});
