import { describe, expect, it, vi } from "vitest";

import { AgentExecutionService } from "./agent-execution.service";

const preparedProfile = {
  profile: {
    taskId: 42,
    userId: 7,
    organizationId: 3,
    dramaId: 282,
    toolProfile: "xiaochuang-drama-source",
    modelProfile: "xiaochuang-text-project",
    skillRefs: ["drama_adaptation_copilot@1.0.0"],
    instruction: "Run source analysis.",
  },
  pool: {
    name: "drama-source-pool",
    toolProfile: "xiaochuang-drama-source",
    skillBundle: "drama-source@1.0.0",
    skillRefs: ["drama_adaptation_copilot@1.0.0"],
    skillManifest: [],
    allowedTools: ["get_task_context"],
    modelProfile: "xiaochuang-text-project",
    maxConcurrentRuns: 10,
    maxConcurrentRunsPerUser: 2,
    instances: [],
  },
  skillManifest: [
    {
      ref: "drama_adaptation_copilot@1.0.0",
      id: "drama_adaptation_copilot",
      version: "1.0.0",
      sha256: "a".repeat(64),
    },
  ],
};

function selectLatestDb(latest: Record<string, unknown> | null) {
  const limit = vi.fn(() => Promise.resolve(latest ? [latest] : []));
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn(() => ({ orderBy }));
  const from = vi.fn(() => ({ where }));
  return {
    db: {
      select: vi.fn(() => ({ from })),
      insert: vi.fn(),
    },
    limit,
  };
}

describe("AgentExecutionService", () => {
  it("revokes a capability jti whenever an execution reaches a terminal state", async () => {
    const execution = {
      id: 81,
      capabilityJti: "capability-token-id",
      status: "completed",
    };
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([execution])),
          })),
        })),
      })),
    };
    const revocationService = {
      revoke: vi.fn(() => Promise.resolve()),
    };
    const service = new AgentExecutionService(
      { db } as any,
      revocationService as any,
    );

    await service.updateStatus(81, "completed");

    expect(revocationService.revoke).toHaveBeenCalledWith(
      "capability-token-id",
    );
  });

  it("does not revoke a capability when an execution remains active", async () => {
    const execution = {
      id: 81,
      capabilityJti: "capability-token-id",
      status: "running",
    };
    const db = {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(() => Promise.resolve([execution])),
          })),
        })),
      })),
    };
    const revocationService = {
      revoke: vi.fn(() => Promise.resolve()),
    };
    const service = new AgentExecutionService(
      { db } as any,
      revocationService as any,
    );

    await service.updateStatus(81, "running");

    expect(revocationService.revoke).not.toHaveBeenCalled();
  });

  it("reuses an active execution only when its runtime scope matches the prepared profile", async () => {
    const latest = {
      id: 81,
      userId: 7,
      organizationId: 3,
      taskId: 42,
      attemptNo: 1,
      sessionId: "o:3:u:7:drama:282:task:42:attempt:1",
      status: "running",
      toolProfile: "xiaochuang-drama-source",
      modelProfile: "xiaochuang-text-project",
      skillManifestJson: JSON.stringify(preparedProfile.skillManifest),
    };
    const database = selectLatestDb(latest);
    const service = new AgentExecutionService(
      database as any,
      { revoke: vi.fn() } as any,
    );

    await expect(
      service.createOrReuseActiveAttempt(preparedProfile),
    ).resolves.toEqual({ execution: latest, reused: true });
    expect(database.db.insert).not.toHaveBeenCalled();
  });

  it("fails closed instead of reusing an active execution with a mismatched scope", async () => {
    const database = selectLatestDb({
      id: 81,
      userId: 8,
      organizationId: 3,
      taskId: 42,
      attemptNo: 1,
      sessionId: "o:3:u:8:drama:282:task:42:attempt:1",
      status: "running",
      toolProfile: "xiaochuang-drama-source",
      modelProfile: "xiaochuang-text-project",
      skillManifestJson: JSON.stringify(preparedProfile.skillManifest),
    });
    const service = new AgentExecutionService(
      database as any,
      { revoke: vi.fn() } as any,
    );

    await expect(
      service.createOrReuseActiveAttempt(preparedProfile),
    ).rejects.toThrow("agent_execution_active_scope_mismatch");
    expect(database.db.insert).not.toHaveBeenCalled();
  });
});
