import { Inject, Injectable, OnApplicationShutdown } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class CapabilityTokenRevocationService implements OnApplicationShutdown {
  private client: Redis | null = null;

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async revoke(jti: string | null | undefined) {
    const value = String(jti || "").trim();
    if (!value) return;
    await this.getClient().set(
      this.key(value),
      "1",
      "EX",
      this.configService.getOrThrow<number>(
        "AGENT_RUNTIME_CAPABILITY_TTL_SECONDS",
      ),
    );
  }

  async isRevoked(jti: string) {
    return (await this.getClient().exists(this.key(jti))) === 1;
  }

  async onApplicationShutdown() {
    await this.client?.quit().catch(() => undefined);
    this.client = null;
  }

  private key(jti: string) {
    return `agent-runtime:capability:${jti}:revoked`;
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
