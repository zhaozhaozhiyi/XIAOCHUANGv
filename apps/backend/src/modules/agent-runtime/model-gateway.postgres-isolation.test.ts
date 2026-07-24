import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import { PGlite } from "@electric-sql/pglite";
import { ForbiddenException } from "@nestjs/common";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as schema from "../../db/schema";
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

async function createRuntimeTables(client: PGlite) {
  await client.exec(`
    CREATE TABLE dramas (
      id integer PRIMARY KEY,
      user_id integer,
      title varchar(500) NOT NULL,
      description text,
      genre varchar(100),
      style varchar(100),
      total_episodes integer,
      total_duration integer,
      status varchar(50) NOT NULL,
      thumbnail text,
      tags text,
      metadata text,
      is_public boolean NOT NULL,
      review_status varchar(50),
      reviewed_by integer,
      reviewed_at timestamp,
      review_note text,
      created_at timestamp,
      updated_at timestamp,
      deleted_at timestamp
    );

    CREATE TABLE tasks (
      id integer PRIMARY KEY,
      user_id integer,
      organization_id integer,
      type varchar(50) NOT NULL,
      status varchar(50) NOT NULL,
      title varchar(255),
      progress integer,
      source_type varchar(50) NOT NULL,
      drama_id integer,
      episode_id integer,
      storyboard_id integer,
      ai_config_id integer,
      domain_table varchar(100) NOT NULL,
      domain_id integer NOT NULL,
      provider_task_id varchar(255),
      attempt_count integer,
      locked_by varchar(255),
      locked_at timestamp,
      lock_expires_at timestamp,
      payload_json text,
      result_summary_json text,
      error_kind varchar(50),
      error_message text,
      error_details_json text,
      created_at timestamp,
      updated_at timestamp,
      started_at timestamp,
      completed_at timestamp,
      deleted_at timestamp
    );

    CREATE TABLE agent_executions (
      id integer PRIMARY KEY,
      user_id integer NOT NULL,
      organization_id integer,
      task_id integer NOT NULL,
      attempt_no integer NOT NULL,
      runtime varchar(20) NOT NULL,
      remote_run_id varchar(255),
      session_id varchar(255) NOT NULL,
      status varchar(30) NOT NULL,
      tool_profile varchar(100),
      skill_manifest_json text,
      model_profile varchar(100),
      capability_jti varchar(128),
      checkpoint_json text,
      last_event_seq integer,
      last_event_json text,
      error_kind varchar(50),
      error_message text,
      started_at timestamp,
      completed_at timestamp,
      created_at timestamp,
      updated_at timestamp
    );
  `);
}

async function seedRuntimeScope(
  client: PGlite,
  tokenClaims: CapabilityTokenClaims,
  rows: {
    execution?: {
      userId?: number;
      organizationId?: number | null;
      status?: string;
    };
    task?: {
      userId?: number;
      organizationId?: number | null;
      status?: string;
    };
    drama?: {
      userId?: number;
      metadata?: string | null;
      deletedAt?: Date | null;
    };
  } = {},
) {
  const organizationId =
    rows.execution?.organizationId ?? tokenClaims.organization_id ?? null;
  const taskOrganizationId =
    rows.task?.organizationId ?? tokenClaims.organization_id ?? null;
  await client.query(
    `
      INSERT INTO dramas (
        id, user_id, title, status, metadata, is_public, deleted_at
      ) VALUES ($1, $2, 'A drama', 'draft', $3, true, $4)
    `,
    [
      tokenClaims.drama_id,
      rows.drama?.userId ?? tokenClaims.user_id,
      rows.drama?.metadata ??
        JSON.stringify({ project_defaults: { text_config_id: 99 } }),
      rows.drama?.deletedAt ?? null,
    ],
  );
  await client.query(
    `
      INSERT INTO tasks (
        id, user_id, organization_id, type, status, source_type, drama_id,
        domain_table, domain_id
      ) VALUES ($1, $2, $3, 'drama_source_analysis', $4, 'drama', $5,
        'dramas', $6)
    `,
    [
      tokenClaims.task_id,
      rows.task?.userId ?? tokenClaims.user_id,
      taskOrganizationId,
      rows.task?.status ?? "running",
      tokenClaims.drama_id,
      tokenClaims.drama_id,
    ],
  );
  await client.query(
    `
      INSERT INTO agent_executions (
        id, user_id, organization_id, task_id, attempt_no, runtime, session_id,
        status, tool_profile, model_profile, capability_jti
      ) VALUES ($1, $2, $3, $4, 1, 'hermes', $5, $6, $7,
        'xiaochuang-text-project', $8)
    `,
    [
      tokenClaims.execution_id,
      rows.execution?.userId ?? tokenClaims.user_id,
      organizationId,
      tokenClaims.task_id,
      tokenClaims.session_id,
      rows.execution?.status ?? "running",
      tokenClaims.tool_profile,
      tokenClaims.jti,
    ],
  );
}

async function createService(
  tokenClaims = claims(),
  resolverConfigOverrides: Partial<AIConfig> = {},
) {
  const client = new PGlite();
  await createRuntimeTables(client);
  const db = drizzle(client, { schema });
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
    isRevoked: vi.fn(() => Promise.resolve(false)),
  };
  const resolverConfig = {
    id: 99,
    userId: tokenClaims.user_id,
    serviceType: "text",
    provider: "openai",
    baseUrl: "https://provider.example.test",
    apiKey: "user-provider-secret",
    model: "project-model",
    modelList: ["project-model"],
    settings: {},
    ...resolverConfigOverrides,
  } satisfies AIConfig;
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
  return { service, client, tokenClaims, resolver };
}

async function readRequestBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function startOpenAiCompatibleProvider() {
  const requests: Array<{
    url: string | undefined;
    authorization: string | undefined;
    body: Record<string, unknown>;
  }> = [];
  const server = createServer(async (request, response) => {
    const body = await readRequestBody(request);
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      body,
    });

    if (body.stream === true) {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
      });
      response.write(
        'data: {"id":"chatcmpl_stream","choices":[{"delta":{"content":"好"}}]}\n\n',
      );
      response.end("data: [DONE]\n\n");
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl_local",
        choices: [{ message: { role: "assistant", content: "ok" } }],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function headers() {
  return {
    authorization: `Bearer ${serviceKey}`,
    [capabilityHeader]: "capability-token",
    "X-Xiaochuang-Execution-Id": "81",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModelGatewayService Postgres isolation", () => {
  it("allows the exact execution/task/drama scope and ignores another user's rows", async () => {
    const { service, client, tokenClaims, resolver } = await createService();
    try {
      await seedRuntimeScope(client, tokenClaims);
      await client.query(
        `
          INSERT INTO dramas (id, user_id, title, status, is_public)
          VALUES (900, 8, 'Other drama', 'draft', true)
        `,
      );
      await client.query(
        `
          INSERT INTO tasks (
            id, user_id, organization_id, type, status, source_type, drama_id,
            domain_table, domain_id
          ) VALUES (901, 8, null, 'drama_source_analysis', 'running', 'drama',
            900, 'dramas', 900)
        `,
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))),
      );

      await service.proxy({
        endpoint: "chat/completions",
        body: { messages: [] },
        headers: headers(),
      });

      expect(resolver.resolveConfig).toHaveBeenCalledWith("text", 99, 7);
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });

  it("rejects when the task id belongs to another user in the database", async () => {
    const { service, client, tokenClaims, resolver } = await createService();
    try {
      await seedRuntimeScope(client, tokenClaims, {
        task: { userId: 8 },
      });
      vi.stubGlobal("fetch", vi.fn());

      await expect(
        service.proxy({
          endpoint: "chat/completions",
          body: { messages: [] },
          headers: headers(),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(resolver.resolveConfig).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it("rejects personal capabilities when the execution is bound to an organization", async () => {
    const { service, client, tokenClaims, resolver } = await createService();
    try {
      await seedRuntimeScope(client, tokenClaims, {
        execution: { organizationId: 3 },
        task: { organizationId: 3 },
      });
      vi.stubGlobal("fetch", vi.fn());

      await expect(
        service.proxy({
          endpoint: "chat/completions",
          body: { messages: [] },
          headers: headers(),
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(resolver.resolveConfig).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });
});

describe("ModelGatewayService OpenAI-compatible provider flow", () => {
  it("proxies a non-streaming chat completion through a local Provider", async () => {
    const provider = await startOpenAiCompatibleProvider();
    const { service, client, tokenClaims } = await createService(claims(), {
      baseUrl: provider.baseUrl,
    });
    try {
      await seedRuntimeScope(client, tokenClaims);

      const result = await service.proxy({
        endpoint: "chat/completions",
        body: {
          model: "attacker-model",
          messages: [{ role: "user", content: "hello" }],
        },
        headers: headers(),
      });
      const body = await result.response.json();

      expect(result.response.status).toBe(200);
      expect(body).toMatchObject({ id: "chatcmpl_local" });
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]).toMatchObject({
        url: "/v1/chat/completions",
        authorization: "Bearer user-provider-secret",
      });
      expect(provider.requests[0]?.body).toMatchObject({
        model: "project-model",
        messages: [{ role: "user", content: "hello" }],
      });
      expect(JSON.stringify(provider.requests[0])).not.toContain(
        "capability-token",
      );
    } finally {
      await client.close();
      await provider.close();
    }
  });

  it("preserves SSE semantics for a streaming chat completion", async () => {
    const provider = await startOpenAiCompatibleProvider();
    const { service, client, tokenClaims } = await createService(claims(), {
      baseUrl: provider.baseUrl,
    });
    try {
      await seedRuntimeScope(client, tokenClaims);

      const result = await service.proxy({
        endpoint: "chat/completions",
        body: {
          messages: [{ role: "user", content: "stream" }],
          stream: true,
        },
        headers: headers(),
      });
      const text = await result.response.text();

      expect(result.response.headers.get("content-type")).toContain(
        "text/event-stream",
      );
      expect(text).toContain("data:");
      expect(text).toContain("[DONE]");
      expect(provider.requests).toHaveLength(1);
      expect(provider.requests[0]?.body).toMatchObject({
        model: "project-model",
        stream: true,
      });
    } finally {
      await client.close();
      await provider.close();
    }
  });
});
