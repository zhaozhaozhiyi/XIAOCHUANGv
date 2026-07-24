import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { HermesPoolRegistry } from "./hermes-pool.registry";

type ReleasePool = {
  name: string;
  toolProfile: string;
  skillManifest: Array<{ ref: string; sha256: string }>;
};

const workspaceRoot = resolve(process.cwd(), "..", "..");
const poolsPath = resolve(
  workspaceRoot,
  "deploy/hermes/pools.example.json",
);

function loadReleasePools() {
  return JSON.parse(readFileSync(poolsPath, "utf8")) as {
    pools: ReleasePool[];
  };
}

describe("Hermes release pool manifest", () => {
  it("pins every image-baked phase Skill to its exact workspace bytes", () => {
    const release = loadReleasePools();

    expect(release.pools).toHaveLength(5);
    expect(release.pools.map((pool) => pool.toolProfile)).toEqual([
      "xiaochuang-drama-source",
      "xiaochuang-drama-plan",
      "xiaochuang-drama-script",
      "xiaochuang-drama-graph",
      "xiaochuang-drama-storyboard",
    ]);

    for (const pool of release.pools) {
      expect(pool.skillManifest).toHaveLength(2);
      for (const skill of pool.skillManifest) {
        const [skillId] = skill.ref.split("@");
        const contents = readFileSync(
          resolve(workspaceRoot, "skills", skillId, "SKILL.md"),
        );
        const digest = createHash("sha256").update(contents).digest("hex");
        expect(digest).toBe(skill.sha256);
      }
    }
  });

  it("is accepted by the same pool validator used at runtime", () => {
    const release = loadReleasePools();
    const registry = new HermesPoolRegistry({
      get: <T>(key: string) =>
        key === "HERMES_RUNTIME_POOLS_JSON"
          ? (JSON.stringify(release) as T)
          : (undefined as T),
    } as any);

    for (const pool of release.pools) {
      expect(
        registry.resolve({
          toolProfile: pool.toolProfile,
          modelProfile: "xiaochuang-text-project",
          skillRefs: pool.skillManifest.map((skill) => skill.ref),
          organizationId: null,
        }),
      ).toMatchObject({
        name: pool.name,
        toolProfile: pool.toolProfile,
        skillManifest: pool.skillManifest,
      });
    }
  });
});
