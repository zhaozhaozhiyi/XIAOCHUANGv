import Redis from "ioredis";
import { afterEach, describe, expect, it } from "vitest";

import { ConcurrencyBudgetService } from "./concurrency-budget.service";

const runRedisIntegration = process.env.RUN_REDIS_INTEGRATION === "1";
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

function createService() {
  return new ConcurrencyBudgetService({
    getOrThrow: (key: string) => {
      if (key === "AGENT_RUNTIME_LEASE_TTL_SECONDS") return 30;
      if (key === "REDIS_URL") return redisUrl;
      throw new Error(`unexpected config key: ${key}`);
    },
  } as any);
}

describe.skipIf(!runRedisIntegration)(
  "ConcurrencyBudgetService (Redis integration)",
  () => {
    const services: ConcurrencyBudgetService[] = [];
    let admin: Redis | null = null;
    let executionIds: number[] = [];
    let userIds: number[] = [];
    let eventProjectionExecutionIds: number[] = [];

    afterEach(async () => {
      if (!admin) return;
      const leaseKeys = executionIds.map(
        (executionId) => `agent-runtime:execution:${executionId}:lease`,
      );
      const userKeys = userIds.map(
        (userId) => `agent-runtime:user:${userId}:runs`,
      );
      const eventProjectionKeys = eventProjectionExecutionIds.map(
        (executionId) =>
          `agent-runtime:execution:${executionId}:event-projector`,
      );
      await admin.del([...leaseKeys, ...userKeys, ...eventProjectionKeys]);
      await Promise.all(
        services.map((service) => service.onApplicationShutdown()),
      );
      await admin.quit();
      services.length = 0;
      executionIds = [];
      userIds = [];
      eventProjectionExecutionIds = [];
      admin = null;
    });

    it("atomically enforces a user budget across Runtime instances and independently fills pool instances", async () => {
      const suffix = Math.floor(Date.now() % 1_000_000_000);
      const userA = 1_000_000_000 + suffix;
      const userB = userA + 1;
      const userC = userA + 2;
      const executionA = userA + 10;
      const executionB = userA + 11;
      const executionC = userA + 12;
      const executionD = userA + 13;
      const executionE = userA + 14;

      executionIds = [
        executionA,
        executionB,
        executionC,
        executionD,
        executionE,
      ];
      userIds = [userA, userB, userC];
      admin = new Redis(redisUrl);

      const runtimeOne = createService();
      const runtimeTwo = createService();
      services.push(runtimeOne, runtimeTwo);

      const [first, second] = await Promise.all([
        runtimeOne.acquire({
          executionId: executionA,
          userId: userA,
          poolName: "redis-integration-pool",
          instanceName: "instance-one",
          maxConcurrentRuns: 1,
          maxConcurrentRunsPerUser: 1,
        }),
        runtimeTwo.acquire({
          executionId: executionB,
          userId: userA,
          poolName: "redis-integration-pool",
          instanceName: "instance-two",
          maxConcurrentRuns: 1,
          maxConcurrentRunsPerUser: 1,
        }),
      ]);

      const userAResults = [first, second];
      expect(
        userAResults.filter((result) => result.status === "granted"),
      ).toHaveLength(1);
      expect(
        userAResults.filter(
          (result) =>
            result.status === "queued" && result.reason === "user_quota",
        ),
      ).toHaveLength(1);

      const grantedUserAExecution =
        first.status === "granted" ? executionA : executionB;
      await expect(runtimeOne.release(grantedUserAExecution)).resolves.toBe(
        true,
      );

      await expect(
        runtimeOne.acquire({
          executionId: executionC,
          userId: userB,
          poolName: "redis-integration-pool",
          instanceName: "instance-one",
          maxConcurrentRuns: 1,
          maxConcurrentRunsPerUser: 1,
        }),
      ).resolves.toEqual({ status: "granted" });
      await expect(
        runtimeTwo.acquire({
          executionId: executionD,
          userId: userC,
          poolName: "redis-integration-pool",
          instanceName: "instance-two",
          maxConcurrentRuns: 1,
          maxConcurrentRunsPerUser: 1,
        }),
      ).resolves.toEqual({ status: "granted" });

      await expect(
        runtimeOne.acquire({
          executionId: executionE,
          userId: userA,
          poolName: "redis-integration-pool",
          instanceName: "instance-one",
          maxConcurrentRuns: 1,
          maxConcurrentRunsPerUser: 1,
        }),
      ).resolves.toEqual({ status: "queued", reason: "pool_full" });
    });

    it("elects one SSE projector per execution across Runtime instances", async () => {
      const executionId = 2_000_000_000 + Math.floor(Date.now() % 1_000_000_000);
      eventProjectionExecutionIds = [executionId];
      admin = new Redis(redisUrl);

      const runtimeOne = createService();
      const runtimeTwo = createService();
      services.push(runtimeOne, runtimeTwo);

      const [firstOwner, secondOwner] = await Promise.all([
        runtimeOne.acquireEventProjector(executionId),
        runtimeTwo.acquireEventProjector(executionId),
      ]);
      expect([firstOwner, secondOwner].filter(Boolean)).toHaveLength(1);
      const owner = firstOwner ?? secondOwner;
      if (!owner) throw new Error("event_projector_owner_missing");

      expect(
        await runtimeOne.renewEventProjector(executionId, owner),
      ).toBe(true);
      expect(
        await runtimeTwo.releaseEventProjector(executionId, owner),
      ).toBe(true);
      await expect(
        runtimeTwo.acquireEventProjector(executionId),
      ).resolves.toEqual(expect.any(String));
    });
  },
);
