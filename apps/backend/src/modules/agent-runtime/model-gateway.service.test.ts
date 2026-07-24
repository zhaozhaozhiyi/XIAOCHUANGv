import {
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

import { agentExecutions, dramas, tasks } from "../../db/schema";
import type { AIConfig } from "../ai-configs/ai-configs.resolver";
import type { CapabilityTokenClaims } from "./capability-token.service";
import { ModelGatewayService } from "./model-gateway.service";

const serviceKey = "hermes-service-key";
const capabilityHeader = "X-Xiaochuang-MCP-Capability";

function claims(
  overrides: Partial<CapabilityTokenClaims> = {},
): CapabilityTokenClaims {
  return {
    user_id: 7,
    organization_id: undefined,
    execution_id: 81,
    task_id: 42,
    drama_id: 282,
    tool_profile: "xiaochuang-drama-source",
    allowed_tools: ["get_task_context"],
    skill_sha256: ["a".repeat(64)],
    session_id: "u:7:drama:282:task:42:attempt:1",
    exp: 9_999_999_999,
    iat: 1,
    jti: "capability-jti",
    ...overrides,
  };
}

function createDb(
  rows: {
    execution?: Record<string, unknown> | null;
    task?: Record<string, unknown> | null;
    drama?: Record<string, unknown> | null;
  } = {},
) {
  const tokenClaims = claims();
  const records = {
    execution:
      rows.execution === null
        ? []
        : [
            {
              id: tokenClaims.execution_id,
              userId: tokenClaims.user_id,
              organizationId: null,
              taskId: tokenClaims.task_id,
              status: "running",
              capabilityJti: tokenClaims.jti,
              sessionId: tokenClaims.session_id,
              toolProfile: tokenClaims.tool_profile,
              modelProfile: "xiaochuang-text-project",
              ...rows.execution,
            },
          ],
    task:
      rows.task === null
        ? []
        : [
            {
              id: tokenClaims.task_id,
              userId: tokenClaims.user_id,
              organizationId: null,
              dramaId: tokenClaims.drama_id,
              status: "running",
              deletedAt: null,
              ...rows.task,
            },
          ],
    drama:
      rows.drama === null
        ? []
        : [
            {
              id: tokenClaims.drama_id,
              userId: tokenClaims.user_id,
              metadata: JSON.stringify({
                project_defaults: { text_config_id: 99 },
              }),
              deletedAt: null,
              ...rows.drama,
            },
          ],
  };
  const rowsFor = (table: unknown) => {
    if (table === agentExecutions) return records.execution;
    if (table === tasks) return records.task;
    if (table === dramas) return records.drama;
    return [];
  };
  const db = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const chain = {
          where: vi.fn(() => chain),
          limit: vi.fn(() => Promise.resolve(rowsFor(table).slice(0, 1))),
        };
        return chain;
      }),
    })),
  };
  return db;
}

function createService(options: {
  dbRows?: Parameters<typeof createDb>[0];
  resolverConfig?: AIConfig;
  revoked?: boolean;
} = {}) {
  const db = createDb(options.dbRows);
  const tokenClaims = claims();
  const resolverConfig =
    options.resolverConfig ??
    ({
      id: 99,
      userId: 7,
      serviceType: "text",
      provider: "openai",
      baseUrl: "https://provider.example.test",
      apiKey: "user-provider-secret",
      model: "project-model",
      modelList: ["project-model"],
      settings: {},
    } satisfies AIConfig);
  const configService = {
    get: vi.fn((key: string) => {
      if (key === "AGENT_RUNTIME_MODEL_GATEWAY_SERVICE_KEY") {
        return serviceKey;
      }
      if (key === "HERMES_RUNTIME_MCP_CAPABILITY_HEADER") {
        return capabilityHeader;
      }
      return undefined;
    }),
  };
  const tokenService = { verify: vi.fn(() => tokenClaims) };
  const revocations = {
    isRevoked: vi.fn(() => Promise.resolve(Boolean(options.revoked))),
  };
  const resolver = {
    resolveConfig: vi.fn(() => Promise.resolve(resolverConfig)),
  };
  const service = new ModelGatewayService(
    configService as any,
    { db } as any,
    tokenService as any,
    revocations as any,
    resolver as any,
  );
  return {
    service,
    db,
    configService,
    tokenClaims,
    tokenService,
    revocations,
    resolver,
  };
}

function headers(overrides: Record<string, string> = {}) {
  return {
    authorization: `Bearer ${serviceKey}`,
    [capabilityHeader]: "capability-token",
    "X-Xiaochuang-Execution-Id": "81",
    ...overrides,
  };
}

describe("ModelGatewayService", () => {
  it("rejects callers without the Hermes service identity before token or database access", async () => {
    const { service, tokenService, db } = createService();

    await expect(
      service.proxy({
        endpoint: "chat/completions",
        body: {},
        headers: headers({ authorization: "Bearer wrong-key" }),
      }),
    ).rejects.toThrow(UnauthorizedException);

    expect(tokenService.verify).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects a revoked capability token before loading user model configuration", async () => {
    const { service, resolver } = createService({ revoked: true });

    await expect(
      service.proxy({
        endpoint: "chat/completions",
        body: {},
        headers: headers(),
      }),
    ).rejects.toThrow("agent_runtime_capability_revoked");
    expect(resolver.resolveConfig).not.toHaveBeenCalled();
  });

  it("rejects a request whose execution header is not bound to the capability", async () => {
    const { service, db } = createService();

    await expect(
      service.proxy({
        endpoint: "chat/completions",
        body: {},
        headers: headers({ "X-Xiaochuang-Execution-Id": "82" }),
      }),
    ).rejects.toThrow("model_gateway_execution_mismatch");
    expect(db.select).not.toHaveBeenCalled();
  });

  it("rejects terminal executions and refuses to resolve a model configuration", async () => {
    const { service, resolver } = createService({
      dbRows: { execution: { status: "completed" } },
    });

    await expect(
      service.proxy({
        endpoint: "chat/completions",
        body: {},
        headers: headers(),
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(resolver.resolveConfig).not.toHaveBeenCalled();
  });

  it("does not begin another provider request after execution enters stopping", async () => {
    const { service, resolver } = createService({
      dbRows: { execution: { status: "stopping" } },
    });

    await expect(
      service.proxy({
        endpoint: "chat/completions",
        body: {},
        headers: headers(),
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(resolver.resolveConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["execution session", { execution: { sessionId: "wrong-session" } }],
    ["task organization", { task: { organizationId: 3 } }],
    ["drama owner", { drama: { userId: 8 } }],
  ])(
    "rejects scoped rows returned with a mismatched %s",
    async (_label, dbRows) => {
      const { service, resolver } = createService({ dbRows });

      await expect(
        service.proxy({
          endpoint: "chat/completions",
          body: {},
          headers: headers(),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(resolver.resolveConfig).not.toHaveBeenCalled();
    },
  );

  it("resolves the project text configuration and overwrites the Hermes model field", async () => {
    const { service, resolver } = createService();
    const upstream = new Response(
      JSON.stringify({ id: "chatcmpl_1", choices: [] }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
    let forwardedRequest: RequestInit | undefined;
    const fetchMock = vi.fn(
      (_url: string, request?: RequestInit) => {
        forwardedRequest = request;
        return Promise.resolve(upstream);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await service.proxy({
      endpoint: "chat/completions",
      body: {
        model: "attacker-selected-model",
        messages: [{ role: "user", content: "请开始" }],
        max_tokens: 120,
        max_completion_tokens: 120,
        max_output_tokens: 120,
        tools: [
          {
            type: "function",
            function: {
              name: "get_task_context",
              parameters: { type: "object", properties: {} },
            },
          },
          { type: "web_search_preview" },
        ],
        tool_choice: { type: "web_search_preview" },
        stream: true,
      },
      headers: headers(),
    });

    expect(resolver.resolveConfig).toHaveBeenCalledWith("text", 99, 7);
    expect(result.model).toBe("project-model");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://provider.example.test/v1/chat/completions",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer user-provider-secret",
          "Content-Type": "application/json",
        },
      }),
    );
    const fetchInput = forwardedRequest;
    expect(fetchInput).toBeDefined();
    if (!fetchInput) throw new Error("model_gateway_request_missing");
    const forwardedBody = JSON.parse(String(fetchInput.body));
    expect(forwardedBody).toMatchObject({
      model: "project-model",
      stream: true,
      tools: [
        {
          type: "function",
          function: {
            name: "get_task_context",
          },
        },
      ],
    });
    expect(forwardedBody).not.toHaveProperty("max_tokens");
    expect(forwardedBody).not.toHaveProperty("max_completion_tokens");
    expect(forwardedBody).not.toHaveProperty("max_output_tokens");
    expect(forwardedBody).not.toHaveProperty("tool_choice");
    expect(JSON.stringify(fetchInput.headers)).not.toContain("capability-token");

    vi.unstubAllGlobals();
  });

  it("does not expose upstream authentication failures", async () => {
    const { service } = createService();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("bad key", {
      status: 401,
    }))));

    try {
      await service.proxy({
        endpoint: "chat/completions",
        body: { messages: [] },
        headers: headers(),
      });
      throw new Error("expected_model_gateway_provider_auth");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const exception = error as HttpException;
      expect(exception.getStatus()).toBe(502);
      expect(exception.getResponse()).toEqual({
        error: "model_gateway_provider_auth",
        message: "model_gateway_provider_auth",
      });
    }

    vi.unstubAllGlobals();
  });
});
