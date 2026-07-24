import { UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { CapabilityRefreshController } from "./capability-refresh.controller";

const capabilityHeader = "X-Xiaochuang-MCP-Capability";
const serviceKeyHeader = "X-Xiaochuang-MCP-Service-Key";

function createController() {
  const configService = {
    get: vi.fn((key: string) => {
      if (key === "AGENT_RUNTIME_MCP_SERVICE_KEY") return "mcp-service-key";
      if (key === "HERMES_RUNTIME_MCP_CAPABILITY_HEADER") {
        return capabilityHeader;
      }
      return undefined;
    }),
  };
  const capabilityRefreshService = {
    refresh: vi.fn(() =>
      Promise.resolve({
        capabilityToken: "renewed-capability-token",
        expiresAt: 1_700_000_000,
      }),
    ),
  };
  const controller = new CapabilityRefreshController(
    configService as any,
    capabilityRefreshService as any,
  );
  return { controller, capabilityRefreshService };
}

describe("CapabilityRefreshController", () => {
  it("requires the fixed Hermes service identity before renewing a capability", async () => {
    const { controller, capabilityRefreshService } = createController();

    await expect(
      controller.refresh({
        [serviceKeyHeader]: "wrong-key",
        [capabilityHeader]: "current-capability-token",
        "X-Xiaochuang-Execution-Id": "81",
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(capabilityRefreshService.refresh).not.toHaveBeenCalled();
  });

  it("forwards only the current capability and execution binding", async () => {
    const { controller, capabilityRefreshService } = createController();

    await expect(
      controller.refresh({
        [serviceKeyHeader]: "mcp-service-key",
        [capabilityHeader]: "current-capability-token",
        "X-Xiaochuang-Execution-Id": "81",
      }),
    ).resolves.toEqual({
      capability_token: "renewed-capability-token",
      expires_at: 1_700_000_000,
    });
    expect(capabilityRefreshService.refresh).toHaveBeenCalledWith({
      token: "current-capability-token",
      executionId: 81,
    });
  });
});
