import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";

import { XiaochuangDramaMcpController } from "./xiaochuang-drama-mcp.controller";
import { XiaochuangDramaMcpService } from "./xiaochuang-drama-mcp.service";

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
  const mcpService = {
    invoke: vi.fn(() => ({ ok: true })),
    listTools: vi.fn(() => [
      {
        name: "get_task_context",
        description: "Read task context.",
        inputSchema: { type: "object", properties: {} },
      },
    ]),
  };
  const controller = new XiaochuangDramaMcpController(
    configService as any,
    mcpService as any,
  );
  return { controller, configService, mcpService };
}

function createReply() {
  const headers = new Map<string, string>();
  return {
    headers,
    statusCode: 200,
    header: vi.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
    }),
    code: vi.fn(function code(this: { statusCode: number }, status: number) {
      this.statusCode = status;
      return this;
    }),
  };
}

describe("XiaochuangDramaMcpController", () => {
  it("rejects MCP callers without the fixed Hermes service identity", async () => {
    const { controller, mcpService } = createController();
    const reply = createReply();

    await expect(
      controller.streamableHttp(
        {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        },
        {
          [serviceKeyHeader]: "wrong-key",
          [capabilityHeader]: "capability-token",
        },
        reply as any,
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(mcpService.invoke).not.toHaveBeenCalled();
    expect(mcpService.listTools).not.toHaveBeenCalled();
  });

  it("serves a capability-filtered stateless MCP initialize and tools/list exchange", async () => {
    const { controller, mcpService } = createController();
    const reply = createReply();
    const headers = {
      [serviceKeyHeader]: "mcp-service-key",
      [capabilityHeader]: "capability-token",
    };

    const initialized = await controller.streamableHttp(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26" },
      },
      headers,
      reply as any,
    );
    const listed = await controller.streamableHttp(
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      },
      headers,
      reply as any,
    );

    expect(initialized).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "xiaochuang-drama" },
      },
    });
    expect(listed).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: { tools: await mcpService.listTools.mock.results[1].value },
    });
    expect(mcpService.listTools).toHaveBeenNthCalledWith(1, "capability-token");
    expect(mcpService.listTools).toHaveBeenNthCalledWith(2, "capability-token");
    expect(reply.headers.get("content-type")).toBe("application/json");
    expect(reply.headers.get("mcp-protocol-version")).toBe("2025-03-26");
  });

  it("wraps a MCP tools/call result without making credentials model-visible", async () => {
    const { controller, mcpService } = createController();
    const reply = createReply();

    const response = await controller.streamableHttp(
      {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "get_task_context",
          arguments: { ignored_user_id: 999 },
        },
      },
      {
        [serviceKeyHeader]: "mcp-service-key",
        [capabilityHeader]: "capability-token",
      },
      reply as any,
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: "call-1",
      result: {
        content: [{ type: "text", text: '{"ok":true}' }],
        structuredContent: { ok: true },
      },
    });
    expect(mcpService.invoke).toHaveBeenCalledWith(
      "get_task_context",
      "capability-token",
      { ignored_user_id: 999 },
    );
    expect(JSON.stringify(response)).not.toContain("mcp-service-key");
    expect(JSON.stringify(response)).not.toContain("capability-token");
  });

  it("maps scoped tool failures to a MCP isError result", async () => {
    const { controller, mcpService } = createController();
    const reply = createReply();
    mcpService.invoke.mockImplementationOnce(() => {
      throw new ForbiddenException("xiaochuang_drama_tool_not_allowed");
    });

    const response = await controller.streamableHttp(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "submit_episode_script", arguments: {} },
      },
      {
        [serviceKeyHeader]: "mcp-service-key",
        [capabilityHeader]: "capability-token",
      },
      reply as any,
    );

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 3,
      result: {
        content: [
          {
            type: "text",
            text: '{"error":{"kind":"forbidden","message":"xiaochuang_drama_tool_not_allowed","retriable":false}}',
          },
        ],
        structuredContent: {
          error: {
            kind: "forbidden",
            message: "xiaochuang_drama_tool_not_allowed",
            retriable: false,
          },
        },
        isError: true,
      },
    });
  });

  it("serves the Streamable HTTP route with a MCP-compatible success status", async () => {
    const configService = {
      get: (key: string) => {
        if (key === "AGENT_RUNTIME_MCP_SERVICE_KEY") return "mcp-service-key";
        if (key === "HERMES_RUNTIME_MCP_CAPABILITY_HEADER") {
          return capabilityHeader;
        }
        return undefined;
      },
    };
    const mcpService = {
      listTools: vi.fn(() => []),
      invoke: vi.fn(),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [XiaochuangDramaMcpController],
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: XiaochuangDramaMcpService, useValue: mcpService },
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    try {
      const response = await app.inject({
        method: "POST",
        url: "/internal/agent-runtime/xiaochuang-drama/mcp",
        headers: {
          [serviceKeyHeader]: "mcp-service-key",
          [capabilityHeader]: "capability-token",
        },
        payload: {
          jsonrpc: "2.0",
          id: "init-1",
          method: "initialize",
          params: { protocolVersion: "2025-03-26" },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["mcp-protocol-version"]).toBe("2025-03-26");
      expect(JSON.parse(response.payload)).toMatchObject({
        jsonrpc: "2.0",
        id: "init-1",
        result: { protocolVersion: "2025-03-26" },
      });
    } finally {
      await app.close();
    }
  });

  it("works with the official MCP Streamable HTTP client", async () => {
    const configService = {
      get: (key: string) => {
        if (key === "AGENT_RUNTIME_MCP_SERVICE_KEY") return "mcp-service-key";
        if (key === "HERMES_RUNTIME_MCP_CAPABILITY_HEADER") {
          return capabilityHeader;
        }
        return undefined;
      },
    };
    const mcpService = {
      listTools: vi.fn(() => [
        {
          name: "get_task_context",
          description: "Read task context.",
          inputSchema: { type: "object", properties: {} },
        },
      ]),
      invoke: vi.fn(() => ({ task: { id: 123, stage: "source" } })),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [XiaochuangDramaMcpController],
      providers: [
        { provide: ConfigService, useValue: configService },
        { provide: XiaochuangDramaMcpService, useValue: mcpService },
      ],
    }).compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    const client = new Client({
      name: "xiaochuang-runtime-mcp-test",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(
        `http://127.0.0.1:${address.port}/internal/agent-runtime/xiaochuang-drama/mcp`,
      ),
      {
        requestInit: {
          headers: {
            [serviceKeyHeader]: "mcp-service-key",
            [capabilityHeader]: "capability-token",
          },
        },
      },
    );

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      const result = await client.callTool({
        name: "get_task_context",
        arguments: {},
      });

      expect(listed.tools).toHaveLength(1);
      expect(listed.tools[0]).toMatchObject({ name: "get_task_context" });
      expect(result).toMatchObject({
        structuredContent: { task: { id: 123, stage: "source" } },
      });
      expect(mcpService.listTools).toHaveBeenCalled();
      expect(mcpService.invoke).toHaveBeenCalledWith(
        "get_task_context",
        "capability-token",
        {},
      );
    } finally {
      await client.close();
      await app.close();
    }
  });
});
