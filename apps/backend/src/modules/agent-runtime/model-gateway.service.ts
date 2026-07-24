import { timingSafeEqual } from "node:crypto";

import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, isNull } from "drizzle-orm";

import { DatabaseService } from "../../db/database.service";
import { agentExecutions, dramas, tasks } from "../../db/schema";
import {
  getTextProviderBaseUrl,
  withTextProviderRequestOptions,
} from "../agents/agents.ai";
import {
  AiConfigResolverService,
  type AIConfig,
} from "../ai-configs/ai-configs.resolver";
import { resolveProjectConfigId } from "../dramas/drama-metadata";
import type { AgentExecutionStatus } from "./agent-runtime.types";
import {
  CapabilityTokenService,
  type CapabilityTokenClaims,
} from "./capability-token.service";
import { CapabilityTokenRevocationService } from "./capability-token-revocation.service";
import type {
  ModelGatewayEndpoint,
  ModelGatewayUpstreamResponse,
} from "./model-gateway.types";

const ACTIVE_EXECUTION_STATUSES = new Set<AgentExecutionStatus>([
  "created",
  "queued",
  "starting",
  "running",
  "checkpointed",
]);

const TERMINAL_TASK_STATUSES = new Set([
  "completed",
  "failed",
  "canceled",
  "cancelled",
  "dead_letter",
]);

const OPENAI_COMPATIBLE_TEXT_PROVIDERS = new Set([
  "openai",
  "openrouter",
  "chatfire",
  "moonshot",
  "deepseek",
  "minimax",
  "volcengine",
  "ali",
]);

const OUTPUT_CAP_FIELDS = new Set([
  "max_tokens",
  "max_completion_tokens",
  "max_output_tokens",
]);

function isFunctionTool(value: unknown) {
  if (!isRecord(value)) return false;
  const type = String(value.type || "").trim().toLowerCase();
  return type === "function";
}

function sanitizeToolChoice(value: unknown, hasFunctionTools: boolean) {
  if (!hasFunctionTools) return undefined;
  if (typeof value === "string") return value;
  if (!isRecord(value)) return undefined;
  const type = String(value.type || "").trim().toLowerCase();
  if (type === "function") return value;
  if (!type && isRecord(value.function)) return value;
  return undefined;
}

type ScopedModelContext = {
  claims: CapabilityTokenClaims;
  execution: typeof agentExecutions.$inferSelect;
  task: typeof tasks.$inferSelect;
  drama: typeof dramas.$inferSelect;
  config: AIConfig;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
) {
  const expected = name.toLowerCase();
  const value =
    headers[name] ??
    headers[expected] ??
    Object.entries(headers).find(
      ([headerName]) => headerName.toLowerCase() === expected,
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

function modelGatewayError(
  status: HttpStatus,
  code: string,
): HttpException {
  return new HttpException({ error: code, message: code }, status);
}

function organizationMatches(
  row: { organizationId?: number | null },
  claims: CapabilityTokenClaims,
) {
  return (row.organizationId ?? null) === (claims.organization_id ?? null);
}

@Injectable()
export class ModelGatewayService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(CapabilityTokenService)
    private readonly capabilityTokenService: CapabilityTokenService,
    @Inject(CapabilityTokenRevocationService)
    private readonly capabilityTokenRevocationService: CapabilityTokenRevocationService,
    @Inject(AiConfigResolverService)
    private readonly aiConfigResolver: AiConfigResolverService,
  ) {}

  async proxy(input: {
    endpoint: ModelGatewayEndpoint;
    body: unknown;
    headers: Record<string, string | string[] | undefined>;
    signal?: AbortSignal;
  }): Promise<ModelGatewayUpstreamResponse> {
    this.verifyServiceIdentity(input.headers);

    const capabilityHeader =
      this.configService.get<string>("HERMES_RUNTIME_MCP_CAPABILITY_HEADER") ||
      "X-Xiaochuang-MCP-Capability";
    const claims = await this.verifyCapability(
      headerValue(input.headers, capabilityHeader),
    );
    this.verifyExecutionHeader(
      headerValue(input.headers, "X-Xiaochuang-Execution-Id"),
      claims,
    );

    const context = await this.loadScopedContext(claims);
    const payload = this.normalizePayload(input.body, context.config);
    const baseUrl = getTextProviderBaseUrl(context.config).replace(/\/+$/, "");
    const upstream = await this.requestProvider(
      `${baseUrl}/${input.endpoint}`,
      context.config,
      payload,
      input.signal,
    );

    return {
      response: upstream,
      provider: context.config.provider,
      model: context.config.model,
      configId: context.config.id,
    };
  }

  private verifyServiceIdentity(
    headers: Record<string, string | string[] | undefined>,
  ) {
    const configured = String(
      this.configService.get<string>("AGENT_RUNTIME_MODEL_GATEWAY_SERVICE_KEY") ||
        "",
    ).trim();
    const authorization = String(headerValue(headers, "authorization") || "");
    const received = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!configured || !received || !hasSameSecret(received, configured)) {
      throw new UnauthorizedException("model_gateway_service_unauthorized");
    }
  }

  private async verifyCapability(token: string | undefined) {
    const raw = String(token || "").trim();
    if (!raw) {
      throw new UnauthorizedException("agent_runtime_capability_missing");
    }
    try {
      const claims = this.capabilityTokenService.verify(raw);
      if (await this.capabilityTokenRevocationService.isRevoked(claims.jti)) {
        throw new UnauthorizedException("agent_runtime_capability_revoked");
      }
      return claims;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      if (error instanceof BadRequestException) {
        throw new UnauthorizedException("agent_runtime_capability_invalid");
      }
      throw error;
    }
  }

  private verifyExecutionHeader(
    value: string | undefined,
    claims: CapabilityTokenClaims,
  ) {
    const executionId = Number(value);
    if (!Number.isInteger(executionId) || executionId !== claims.execution_id) {
      throw new ForbiddenException("model_gateway_execution_mismatch");
    }
  }

  private async loadScopedContext(
    claims: CapabilityTokenClaims,
  ): Promise<ScopedModelContext> {
    if (!claims.drama_id) {
      throw new ForbiddenException("agent_runtime_scope_forbidden");
    }

    const [execution] = await this.databaseService.db
      .select()
      .from(agentExecutions)
      .where(
        and(
          eq(agentExecutions.id, claims.execution_id),
          eq(agentExecutions.userId, claims.user_id),
          eq(agentExecutions.taskId, claims.task_id),
          eq(agentExecutions.capabilityJti, claims.jti),
          eq(agentExecutions.sessionId, claims.session_id),
          eq(agentExecutions.toolProfile, claims.tool_profile),
          claims.organization_id
            ? eq(agentExecutions.organizationId, claims.organization_id)
            : isNull(agentExecutions.organizationId),
        ),
      )
      .limit(1);
    if (
      !execution ||
      execution.taskId !== claims.task_id ||
      execution.userId !== claims.user_id ||
      execution.capabilityJti !== claims.jti ||
      execution.sessionId !== claims.session_id ||
      execution.toolProfile !== claims.tool_profile ||
      !organizationMatches(execution, claims) ||
      !ACTIVE_EXECUTION_STATUSES.has(
        execution.status as AgentExecutionStatus,
      ) ||
      execution.modelProfile !== "xiaochuang-text-project"
    ) {
      throw new ForbiddenException("agent_runtime_scope_forbidden");
    }

    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.id, claims.task_id),
          eq(tasks.userId, claims.user_id),
          eq(tasks.dramaId, claims.drama_id),
          claims.organization_id
            ? eq(tasks.organizationId, claims.organization_id)
            : isNull(tasks.organizationId),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    if (
      !task ||
      task.id !== claims.task_id ||
      task.userId !== claims.user_id ||
      task.dramaId !== claims.drama_id ||
      task.deletedAt ||
      !organizationMatches(task, claims) ||
      TERMINAL_TASK_STATUSES.has(task.status)
    ) {
      throw new ForbiddenException("agent_runtime_scope_forbidden");
    }

    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, claims.drama_id),
          eq(dramas.userId, claims.user_id),
          isNull(dramas.deletedAt),
        ),
      )
      .limit(1);
    if (
      !drama ||
      drama.id !== claims.drama_id ||
      drama.userId !== claims.user_id ||
      drama.deletedAt
    ) {
      throw new ForbiddenException("agent_runtime_scope_forbidden");
    }

    const configId = resolveProjectConfigId(drama.metadata, "text");
    let config: AIConfig;
    try {
      config = await this.aiConfigResolver.resolveConfig(
        "text",
        configId,
        claims.user_id,
      );
    } catch {
      throw modelGatewayError(
        HttpStatus.BAD_REQUEST,
        "model_gateway_model_config_missing",
      );
    }
    if (
      !OPENAI_COMPATIBLE_TEXT_PROVIDERS.has(
        String(config.provider || "").trim().toLowerCase(),
      )
    ) {
      throw modelGatewayError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        "model_gateway_model_protocol_unsupported",
      );
    }

    return { claims, execution, task, drama, config };
  }

  private normalizePayload(body: unknown, config: AIConfig) {
    if (!isRecord(body)) {
      throw new BadRequestException("model_gateway_request_body_invalid");
    }
    const sanitizedBody: Record<string, unknown> = Object.fromEntries(
      Object.entries(body).filter(([key]) => !OUTPUT_CAP_FIELDS.has(key)),
    );
    if (Array.isArray(sanitizedBody.tools)) {
      const functionTools = sanitizedBody.tools.filter(isFunctionTool);
      if (functionTools.length) {
        sanitizedBody.tools = functionTools;
      } else {
        delete sanitizedBody.tools;
      }
      const toolChoice = sanitizeToolChoice(
        sanitizedBody.tool_choice,
        functionTools.length > 0,
      );
      if (toolChoice === undefined) {
        delete sanitizedBody.tool_choice;
      } else {
        sanitizedBody.tool_choice = toolChoice;
      }
    }
    return withTextProviderRequestOptions(config, {
      ...sanitizedBody,
      model: config.model,
    });
  }

  private async requestProvider(
    url: string,
    config: AIConfig,
    body: Record<string, unknown>,
    signal?: AbortSignal,
  ) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw modelGatewayError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "model_gateway_provider_transient",
      );
    }

    if (response.ok) return response;
    if (response.status === 401 || response.status === 403) {
      throw modelGatewayError(
        HttpStatus.BAD_GATEWAY,
        "model_gateway_provider_auth",
      );
    }
    if (
      response.status === 408 ||
      response.status === 409 ||
      response.status === 425 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      throw modelGatewayError(
        HttpStatus.SERVICE_UNAVAILABLE,
        "model_gateway_provider_transient",
      );
    }
    throw new BadGatewayException("model_gateway_provider_rejected");
  }
}
