import { describe, expect, it, vi } from "vitest";

import { ConcurrencyBudgetService } from "./concurrency-budget.service";

describe("ConcurrencyBudgetService", () => {
  it("passes execution, user, and instance scopes into one atomic lease acquisition", async () => {
    const evalMock = vi.fn(() => Promise.resolve(["granted", ""]));
    const service = new ConcurrencyBudgetService({
      getOrThrow: vi.fn((key: string) =>
        key === "AGENT_RUNTIME_LEASE_TTL_SECONDS" ? 900 : "redis://test",
      ),
    } as any);
    (service as any).client = { eval: evalMock };

    const result = await service.acquire({
      executionId: 71,
      userId: 9,
      poolName: "drama-source-pool",
      instanceName: "hermes-source-1",
      maxConcurrentRuns: 4,
      maxConcurrentRunsPerUser: 2,
    });

    expect(result).toEqual({ status: "granted" });
    expect(evalMock).toHaveBeenCalledWith(
      expect.stringContaining("execution_already_leased"),
      3,
      "agent-runtime:execution:71:lease",
      "agent-runtime:user:9:runs",
      "agent-runtime:pool:drama-source-pool:instance:hermes-source-1:runs",
      2,
      4,
      900,
      expect.stringContaining('"user_key":"agent-runtime:user:9:runs"'),
    );
  });

  it("returns the quota reason without turning a queue condition into a runtime failure", async () => {
    const evalMock = vi.fn(() => Promise.resolve(["queued", "user_quota"]));
    const service = new ConcurrencyBudgetService({
      getOrThrow: vi.fn((key: string) =>
        key === "AGENT_RUNTIME_LEASE_TTL_SECONDS" ? 900 : "redis://test",
      ),
    } as any);
    (service as any).client = { eval: evalMock };

    const result = await service.acquire({
      executionId: 72,
      userId: 9,
      poolName: "drama-source-pool",
      instanceName: "hermes-source-1",
      maxConcurrentRuns: 4,
      maxConcurrentRunsPerUser: 2,
    });

    expect(result).toEqual({ status: "queued", reason: "user_quota" });
  });

  it("treats repeated release as idempotent", async () => {
    const evalMock = vi
      .fn()
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    const service = new ConcurrencyBudgetService({
      getOrThrow: vi.fn((key: string) =>
        key === "AGENT_RUNTIME_LEASE_TTL_SECONDS" ? 900 : "redis://test",
      ),
    } as any);
    (service as any).client = { eval: evalMock };

    await expect(service.release(73)).resolves.toBe(true);
    await expect(service.release(73)).resolves.toBe(false);
    expect(evalMock).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("local user_count"),
      1,
      "agent-runtime:execution:73:lease",
    );
  });

  it("uses an execution-scoped Redis SET NX lease for the SSE projector", async () => {
    const setMock = vi.fn(() => Promise.resolve("OK"));
    const service = new ConcurrencyBudgetService({
      getOrThrow: vi.fn((key: string) =>
        key === "AGENT_RUNTIME_LEASE_TTL_SECONDS" ? 900 : "redis://test",
      ),
    } as any);
    (service as any).client = { set: setMock };

    const ownerToken = await service.acquireEventProjector(74);

    expect(ownerToken).toEqual(expect.any(String));
    expect(setMock).toHaveBeenCalledWith(
      "agent-runtime:execution:74:event-projector",
      ownerToken,
      "EX",
      900,
      "NX",
    );
  });
});
