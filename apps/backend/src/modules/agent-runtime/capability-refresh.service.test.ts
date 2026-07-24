import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { agentExecutions, dramas, tasks } from "../../db/schema";
import type { CapabilityTokenClaims } from "./capability-token.service";
import { CapabilityRefreshService } from "./capability-refresh.service";

function claims(
  overrides: Partial<CapabilityTokenClaims> = {},
): CapabilityTokenClaims {
  return {
    user_id: 7,
    organization_id: 3,
    execution_id: 81,
    task_id: 42,
    drama_id: 282,
    tool_profile: "xiaochuang-drama-source",
    allowed_tools: ["get_task_context"],
    skill_sha256: ["a".repeat(64)],
    session_id: "o:3:u:7:drama:282:task:42:attempt:1",
    exp: 9_999_999_999,
    iat: 1,
    jti: "execution-capability-jti",
    ...overrides,
  };
}

function createDb(
  tokenClaims: CapabilityTokenClaims,
  overrides: {
    execution?: Record<string, unknown> | null;
    task?: Record<string, unknown> | null;
    drama?: Record<string, unknown> | null;
  } = {},
) {
  const rows = {
    execution:
      overrides.execution === null
        ? []
        : [
            {
              id: tokenClaims.execution_id,
              userId: tokenClaims.user_id,
              organizationId: tokenClaims.organization_id ?? null,
              taskId: tokenClaims.task_id,
              sessionId: tokenClaims.session_id,
              toolProfile: tokenClaims.tool_profile,
              capabilityJti: tokenClaims.jti,
              status: "running",
              ...overrides.execution,
            },
          ],
    task:
      overrides.task === null
        ? []
        : [
            {
              id: tokenClaims.task_id,
              userId: tokenClaims.user_id,
              organizationId: tokenClaims.organization_id ?? null,
              dramaId: tokenClaims.drama_id,
              status: "running",
              deletedAt: null,
              ...overrides.task,
            },
          ],
    drama:
      overrides.drama === null
        ? []
        : [
            {
              id: tokenClaims.drama_id,
              userId: tokenClaims.user_id,
              deletedAt: null,
              ...overrides.drama,
            },
          ],
  };
  const rowsFor = (table: unknown) => {
    if (table === agentExecutions) return rows.execution;
    if (table === tasks) return rows.task;
    if (table === dramas) return rows.drama;
    return [];
  };
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => {
          const query = {
            where: vi.fn(() => query),
            limit: vi.fn((limit: number) =>
              Promise.resolve(rowsFor(table).slice(0, limit)),
            ),
          };
          return query;
        }),
      })),
    },
  };
}

function createService(options: {
  tokenClaims?: CapabilityTokenClaims;
  dbRows?: Parameters<typeof createDb>[1];
  revoked?: boolean;
} = {}) {
  const tokenClaims = options.tokenClaims ?? claims();
  const database = createDb(tokenClaims, options.dbRows);
  const capabilityTokenService = {
    verify: vi.fn(() => tokenClaims),
    renew: vi.fn(() => ({
      token: "renewed-capability-token",
      claims: { ...tokenClaims, exp: 9_999_999_999 + 900 },
    })),
  };
  const capabilityTokenRevocationService = {
    isRevoked: vi.fn(() => Promise.resolve(Boolean(options.revoked))),
  };
  const service = new CapabilityRefreshService(
    database as any,
    capabilityTokenService as any,
    capabilityTokenRevocationService as any,
  );
  return {
    service,
    database,
    tokenClaims,
    capabilityTokenService,
    capabilityTokenRevocationService,
  };
}

describe("CapabilityRefreshService", () => {
  it("renews only the active execution capability without widening its scope", async () => {
    const runtime = createService();

    await expect(
      runtime.service.refresh({
        token: "current-capability-token",
        executionId: 81,
      }),
    ).resolves.toEqual({
      capabilityToken: "renewed-capability-token",
      expiresAt: 10_000_000_899,
    });

    expect(runtime.capabilityTokenService.verify).toHaveBeenCalledWith(
      "current-capability-token",
    );
    expect(runtime.capabilityTokenService.renew).toHaveBeenCalledWith(
      runtime.tokenClaims,
    );
    expect(
      runtime.capabilityTokenRevocationService.isRevoked,
    ).toHaveBeenCalledWith("execution-capability-jti");
  });

  it("rejects a refresh whose execution header does not match the capability", async () => {
    const runtime = createService();

    await expect(
      runtime.service.refresh({
        token: "current-capability-token",
        executionId: 82,
      }),
    ).rejects.toThrow("capability_refresh_execution_mismatch");
    expect(runtime.database.db.select).not.toHaveBeenCalled();
    expect(runtime.capabilityTokenService.renew).not.toHaveBeenCalled();
  });

  it("rejects revoked or terminal execution capabilities without renewing", async () => {
    const revoked = createService({ revoked: true });
    await expect(
      revoked.service.refresh({
        token: "current-capability-token",
        executionId: 81,
      }),
    ).rejects.toThrow(UnauthorizedException);
    expect(revoked.capabilityTokenService.renew).not.toHaveBeenCalled();

    const terminal = createService({
      dbRows: { execution: { status: "completed" } },
    });
    await expect(
      terminal.service.refresh({
        token: "current-capability-token",
        executionId: 81,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(terminal.capabilityTokenService.renew).not.toHaveBeenCalled();
  });
});
