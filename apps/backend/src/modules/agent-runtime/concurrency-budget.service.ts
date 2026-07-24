import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import Redis from "ioredis";

type LeaseInput = {
  executionId: number;
  userId: number;
  poolName: string;
  instanceName: string;
  maxConcurrentRuns: number;
  maxConcurrentRunsPerUser: number;
};

type LeaseResult =
  | { status: "granted" }
  | {
      status: "queued";
      reason: "user_quota" | "pool_full" | "execution_already_leased";
    };

const ACQUIRE_LEASE = `
if redis.call('GET', KEYS[1]) then
  return {'queued', 'execution_already_leased'}
end
local user_count = tonumber(redis.call('GET', KEYS[2]) or '0')
if user_count >= tonumber(ARGV[1]) then
  return {'queued', 'user_quota'}
end
local instance_count = tonumber(redis.call('GET', KEYS[3]) or '0')
if instance_count >= tonumber(ARGV[2]) then
  return {'queued', 'pool_full'}
end
redis.call('INCR', KEYS[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
redis.call('INCR', KEYS[3])
redis.call('EXPIRE', KEYS[3], ARGV[3])
redis.call('SET', KEYS[1], ARGV[4], 'EX', ARGV[3])
return {'granted', ''}
`;

const RENEW_LEASE = `
local lease = redis.call('GET', KEYS[1])
if not lease then
  return 0
end
local data = cjson.decode(lease)
redis.call('EXPIRE', KEYS[1], ARGV[1])
redis.call('EXPIRE', data.user_key, ARGV[1])
redis.call('EXPIRE', data.instance_key, ARGV[1])
return 1
`;

const RELEASE_LEASE = `
local lease = redis.call('GET', KEYS[1])
if not lease then
  return 0
end
local data = cjson.decode(lease)
redis.call('DEL', KEYS[1])
local user_count = redis.call('DECR', data.user_key)
if user_count <= 0 then redis.call('DEL', data.user_key) end
local instance_count = redis.call('DECR', data.instance_key)
if instance_count <= 0 then redis.call('DEL', data.instance_key) end
return 1
`;

const RENEW_EVENT_PROJECTOR = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1
`;

const RELEASE_EVENT_PROJECTOR = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then
  return 0
end
redis.call('DEL', KEYS[1])
return 1
`;

@Injectable()
export class ConcurrencyBudgetService implements OnApplicationShutdown {
  private client: Redis | null = null;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async acquire(input: LeaseInput): Promise<LeaseResult> {
    const ttlSeconds = this.leaseTtlSeconds();
    const leaseKey = this.leaseKey(input.executionId);
    const userKey = `agent-runtime:user:${input.userId}:runs`;
    const instanceKey = `agent-runtime:pool:${input.poolName}:instance:${input.instanceName}:runs`;
    const payload = JSON.stringify({
      user_key: userKey,
      instance_key: instanceKey,
    });
    const result = (await this.getClient().eval(
      ACQUIRE_LEASE,
      3,
      leaseKey,
      userKey,
      instanceKey,
      input.maxConcurrentRunsPerUser,
      input.maxConcurrentRuns,
      ttlSeconds,
      payload,
    )) as unknown;
    const [status, reason] = Array.isArray(result)
      ? result.map((item) => String(item || ""))
      : [];
    if (status === "granted") return { status: "granted" };
    if (
      reason === "user_quota" ||
      reason === "pool_full" ||
      reason === "execution_already_leased"
    ) {
      return { status: "queued", reason };
    }
    return { status: "queued", reason: "pool_full" };
  }

  async renew(executionId: number) {
    const result = await this.getClient().eval(
      RENEW_LEASE,
      1,
      this.leaseKey(executionId),
      this.leaseTtlSeconds(),
    );
    return Number(result) === 1;
  }

  async release(executionId: number) {
    const result = await this.getClient().eval(
      RELEASE_LEASE,
      1,
      this.leaseKey(executionId),
    );
    return Number(result) === 1;
  }

  async acquireEventProjector(executionId: number) {
    const ownerToken = randomUUID();
    const acquired = await this.getClient().set(
      this.eventProjectorKey(executionId),
      ownerToken,
      "EX",
      this.leaseTtlSeconds(),
      "NX",
    );
    return acquired === "OK" ? ownerToken : null;
  }

  async renewEventProjector(executionId: number, ownerToken: string) {
    const result = await this.getClient().eval(
      RENEW_EVENT_PROJECTOR,
      1,
      this.eventProjectorKey(executionId),
      ownerToken,
      this.leaseTtlSeconds(),
    );
    return Number(result) === 1;
  }

  async releaseEventProjector(executionId: number, ownerToken: string) {
    const result = await this.getClient().eval(
      RELEASE_EVENT_PROJECTOR,
      1,
      this.eventProjectorKey(executionId),
      ownerToken,
    );
    return Number(result) === 1;
  }

  async onApplicationShutdown() {
    await this.client?.quit().catch(() => undefined);
    this.client = null;
  }

  private leaseTtlSeconds() {
    return this.configService.getOrThrow<number>(
      "AGENT_RUNTIME_LEASE_TTL_SECONDS",
    );
  }

  private leaseKey(executionId: number) {
    return `agent-runtime:execution:${executionId}:lease`;
  }

  private eventProjectorKey(executionId: number) {
    return `agent-runtime:execution:${executionId}:event-projector`;
  }

  private getClient() {
    if (this.client) return this.client;
    this.client = new Redis(
      this.configService.getOrThrow<string>("REDIS_URL"),
      {
        connectTimeout: 5_000,
        maxRetriesPerRequest: 3,
      },
    );
    return this.client;
  }
}
