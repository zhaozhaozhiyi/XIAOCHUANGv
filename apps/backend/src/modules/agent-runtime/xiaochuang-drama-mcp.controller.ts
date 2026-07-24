import { timingSafeEqual } from "node:crypto";

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyReply } from "fastify";

import { XiaochuangDramaMcpService } from "./xiaochuang-drama-mcp.service";

const MCP_SERVICE_KEY_HEADER = "X-Xiaochuang-MCP-Service-Key";
const MCP_PROTOCOL_VERSION = "2025-03-26";
const MCP_SERVER_NAME = "xiaochuang-drama";
const MCP_SERVER_VERSION = "0.24.0";

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function jsonRpcId(value: unknown): JsonRpcId | undefined {
  if (value === null || typeof value === "string" || typeof value === "number")
    return value;
  return undefined;
}

function jsonRpcResult(id: JsonRpcId, result: Record<string, unknown>) {
  return {
    jsonrpc: "2.0",
    id,
    result,
  };
}

function jsonRpcError(id: JsonRpcId, code: number, message: string) {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message },
  };
}

@ApiTags("internal-agent-runtime")
@Controller("internal/agent-runtime/xiaochuang-drama")
export class XiaochuangDramaMcpController {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(XiaochuangDramaMcpService)
    private readonly xiaochuangDramaMcpService: XiaochuangDramaMcpService,
  ) {}

  @Post("mcp")
  @HttpCode(200)
  async streamableHttp(
    @Body() body: JsonRpcRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    this.verifyServiceIdentity(headers || {});
    this.setMcpResponseHeaders(reply);

    const request = record(body);
    const id = jsonRpcId(request.id);
    const method = typeof request.method === "string" ? request.method : "";
    if (
      request.jsonrpc !== "2.0" ||
      !method ||
      (Object.prototype.hasOwnProperty.call(request, "id") && id === undefined)
    ) {
      return jsonRpcError(id ?? null, -32600, "Invalid Request");
    }

    const capabilityToken = this.readCapabilityToken(headers || {});
    if (method === "notifications/initialized") {
      // The endpoint is deliberately stateless. MCP clients may send this
      // notification after initialize; no server-side session is created.
      reply.code(202);
      return;
    }

    if (!capabilityToken) {
      throw new UnauthorizedException("agent_runtime_capability_missing");
    }

    if (method === "initialize") {
      await this.xiaochuangDramaMcpService.listTools(capabilityToken);
      return jsonRpcResult(id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION,
        },
        instructions:
          "Use only the tools returned for this scoped execution. Business access is enforced by the per-request capability token.",
      });
    }

    if (method === "ping") {
      await this.xiaochuangDramaMcpService.listTools(capabilityToken);
      return jsonRpcResult(id ?? null, {});
    }

    if (method === "tools/list") {
      const tools =
        await this.xiaochuangDramaMcpService.listTools(capabilityToken);
      return jsonRpcResult(id ?? null, { tools });
    }

    if (method === "tools/call") {
      const params = record(request.params);
      const toolName = typeof params.name === "string" ? params.name.trim() : "";
      if (!toolName) {
        return jsonRpcError(id ?? null, -32602, "Invalid tool name");
      }
      const input = record(params.arguments);
      try {
        const output = await this.xiaochuangDramaMcpService.invoke(
          toolName,
          capabilityToken,
          input,
        );
        return jsonRpcResult(id ?? null, {
          content: [
            {
              type: "text",
              text: JSON.stringify(output),
            },
          ],
          structuredContent: output,
        });
      } catch (error) {
        return jsonRpcResult(id ?? null, this.toolErrorResult(error));
      }
    }

    return jsonRpcError(id ?? null, -32601, "Method not found");
  }

  private readCapabilityToken(
    headers: Record<string, string | string[] | undefined>,
  ) {
    const headerName =
      this.configService.get<string>("HERMES_RUNTIME_MCP_CAPABILITY_HEADER") ||
      "X-Xiaochuang-MCP-Capability";
    return readHeader(headers, headerName);
  }

  private setMcpResponseHeaders(reply: FastifyReply) {
    reply.header("content-type", "application/json");
    reply.header("mcp-protocol-version", MCP_PROTOCOL_VERSION);
  }

  private toolErrorResult(error: unknown) {
    const response =
      error instanceof HttpException ? error.getResponse() : undefined;
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const rawMessage =
      typeof response === "string"
        ? response
        : typeof record(response).message === "string"
          ? String(record(response).message)
          : "";
    const kind =
      status === 401
        ? "unauthorized"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not_found"
            : status === 409
              ? "conflict"
              : status >= 400 && status < 500
                ? "validation"
                : "internal";
    const message =
      kind === "internal"
        ? "xiaochuang_drama_tool_internal_error"
        : rawMessage || "xiaochuang_drama_tool_request_failed";
    const payload = {
      error: {
        kind,
        message,
        retriable: status >= 500,
      },
    };
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload),
        },
      ],
      structuredContent: payload,
      isError: true,
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
