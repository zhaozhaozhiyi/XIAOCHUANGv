import { timingSafeEqual } from "node:crypto";

import {
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";

import { CapabilityRefreshService } from "./capability-refresh.service";

const MCP_SERVICE_KEY_HEADER = "X-Xiaochuang-MCP-Service-Key";

function readHeader(
  headers: Record<string, string | string[] | undefined>,
  headerName: string,
) {
  const normalizedName = headerName.toLowerCase();
  const value =
    headers[headerName] ??
    headers[normalizedName] ??
    Object.entries(headers).find(
      ([key]) => key.toLowerCase() === normalizedName,
    )?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function hasSameSecret(received: string, expected: string) {
  const actual = Buffer.from(received);
  const configured = Buffer.from(expected);
  return (
    actual.length === configured.length &&
    timingSafeEqual(actual, configured)
  );
}

@ApiTags("internal-agent-runtime")
@Controller("internal/agent-runtime/capabilities")
export class CapabilityRefreshController {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(CapabilityRefreshService)
    private readonly capabilityRefreshService: CapabilityRefreshService,
  ) {}

  @Post("refresh")
  @HttpCode(200)
  async refresh(
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    this.verifyServiceIdentity(headers || {});
    const capabilityHeader =
      this.configService.get<string>("HERMES_RUNTIME_MCP_CAPABILITY_HEADER") ||
      "X-Xiaochuang-MCP-Capability";
    const executionId = Number(
      readHeader(headers || {}, "X-Xiaochuang-Execution-Id"),
    );
    if (!Number.isInteger(executionId) || executionId <= 0) {
      throw new UnauthorizedException("capability_refresh_execution_missing");
    }
    const refreshed = await this.capabilityRefreshService.refresh({
      token: readHeader(headers || {}, capabilityHeader),
      executionId,
    });
    return {
      capability_token: refreshed.capabilityToken,
      expires_at: refreshed.expiresAt,
    };
  }

  private verifyServiceIdentity(
    headers: Record<string, string | string[] | undefined>,
  ) {
    const configured = String(
      this.configService.get<string>("AGENT_RUNTIME_MCP_SERVICE_KEY") || "",
    ).trim();
    const received = String(readHeader(headers, MCP_SERVICE_KEY_HEADER) || "")
      .trim();
    if (!configured || !received || !hasSameSecret(received, configured)) {
      throw new UnauthorizedException("mcp_service_unauthorized");
    }
  }
}
