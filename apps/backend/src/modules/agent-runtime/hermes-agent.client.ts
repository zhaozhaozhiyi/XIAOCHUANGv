import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type {
  HermesPoolInstance,
  HermesRunStatus,
  SkillManifestEntry,
} from "./agent-runtime.types";

export class HermesAgentHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "HermesAgentHttpError";
  }
}

type CreateHermesRunInput = {
  sessionId: string;
  instruction: string;
  capabilityToken: string;
  executionId: number;
  toolProfile: string;
  skillManifest: SkillManifestEntry[];
};

type StreamHermesEventsInput = {
  instance: HermesPoolInstance;
  remoteRunId: string;
  onEvent: (event: Record<string, unknown>) => Promise<void>;
  onHeartbeat: () => Promise<void>;
  signal?: AbortSignal;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function encodeSkillManifest(skillManifest: SkillManifestEntry[]) {
  if (!skillManifest.length) {
    throw new Error("hermes_runtime_skill_manifest_required");
  }
  return Buffer.from(
    JSON.stringify(
      skillManifest.map((skill) => ({
        ref: skill.ref,
        sha256: skill.sha256,
      })),
    ),
    "utf8",
  ).toString("base64url");
}

@Injectable()
export class HermesAgentClient {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  async createRun(instance: HermesPoolInstance, input: CreateHermesRunInput) {
    const body = await this.requestJson(instance, "/v1/runs", {
      method: "POST",
      headers: this.runtimeHeaders(
        input.capabilityToken,
        input.executionId,
        input.toolProfile,
        input.skillManifest,
      ),
      body: JSON.stringify({
        input: input.instruction,
        session_id: input.sessionId,
        instructions:
          "Use only the runtime-provided skills and MCP tools. Do not request interactive approval.",
      }),
    });
    const remoteRunId = typeof body.run_id === "string" ? body.run_id : "";
    if (!remoteRunId)
      throw new HermesAgentHttpError(
        "hermes_runtime_missing_run_id",
        502,
        JSON.stringify(body),
      );
    return {
      remoteRunId,
      status: typeof body.status === "string" ? body.status : "started",
    };
  }

  async getRun(
    instance: HermesPoolInstance,
    remoteRunId: string,
  ): Promise<HermesRunStatus> {
    const body = await this.requestJson(
      instance,
      `/v1/runs/${encodeURIComponent(remoteRunId)}`,
      {
        method: "GET",
        headers: this.runtimeHeaders(),
      },
    );
    return {
      status: typeof body.status === "string" ? body.status : "unknown",
      raw: body,
    };
  }

  async stopRun(instance: HermesPoolInstance, remoteRunId: string) {
    return this.requestJson(
      instance,
      `/v1/runs/${encodeURIComponent(remoteRunId)}/stop`,
      {
        method: "POST",
        headers: this.runtimeHeaders(),
        body: JSON.stringify({}),
      },
    );
  }

  async streamEvents(input: StreamHermesEventsInput) {
    const response = await fetch(
      `${input.instance.baseUrl}/v1/runs/${encodeURIComponent(input.remoteRunId)}/events`,
      {
        method: "GET",
        headers: this.runtimeHeaders(),
        signal: input.signal,
      },
    );
    if (!response.ok) {
      throw new HermesAgentHttpError(
        `hermes_runtime_events_failed:${response.status}`,
        response.status,
        await response.text(),
      );
    }
    if (!response.body)
      throw new HermesAgentHttpError(
        "hermes_runtime_events_body_missing",
        502,
        "",
      );

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        pending += decoder
          .decode(value, { stream: true })
          .replace(/\r\n/g, "\n");

        while (true) {
          const separator = pending.indexOf("\n\n");
          if (separator < 0) break;
          const chunk = pending.slice(0, separator);
          pending = pending.slice(separator + 2);
          await input.onHeartbeat();

          const rawData = chunk
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice("data:".length).trim())
            .join("\n");
          if (!rawData) continue;

          try {
            const event = asRecord(JSON.parse(rawData));
            if (Object.keys(event).length) await input.onEvent(event);
          } catch {
            await input.onEvent({
              event: "runtime.invalid_sse_payload",
              payload_length: rawData.length,
            });
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private runtimeHeaders(
    capabilityToken?: string,
    executionId?: number,
    toolProfile?: string,
    skillManifest?: SkillManifestEntry[],
  ) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.configService.getOrThrow<string>("AGENT_RUNTIME_HERMES_API_KEY")}`,
      "Content-Type": "application/json",
    };
    if (capabilityToken) {
      headers[
        this.configService.getOrThrow<string>(
          "HERMES_RUNTIME_MCP_CAPABILITY_HEADER",
        )
      ] = capabilityToken;
      headers["X-Xiaochuang-MCP-Capability-Header"] =
        this.configService.getOrThrow<string>(
          "HERMES_RUNTIME_MCP_CAPABILITY_HEADER",
        );
      headers["X-Xiaochuang-Backend-Base-Url"] =
        this.configService.getOrThrow<string>(
          "HERMES_RUNTIME_BACKEND_BASE_URL",
        );
    }
    if (executionId) headers["X-Xiaochuang-Execution-Id"] = String(executionId);
    if (toolProfile) headers["X-Xiaochuang-Tool-Profile"] = toolProfile;
    if (skillManifest) {
      headers["X-Xiaochuang-Skill-Manifest"] =
        encodeSkillManifest(skillManifest);
    }
    return headers;
  }

  private async requestJson(
    instance: HermesPoolInstance,
    path: string,
    init: RequestInit,
  ) {
    const response = await fetch(`${instance.baseUrl}${path}`, init);
    const text = await response.text();
    if (!response.ok) {
      throw new HermesAgentHttpError(
        `hermes_runtime_request_failed:${response.status}`,
        response.status,
        text,
      );
    }
    if (!text.trim()) return {};
    try {
      return asRecord(JSON.parse(text));
    } catch {
      throw new HermesAgentHttpError(
        "hermes_runtime_non_json_response",
        502,
        text,
      );
    }
  }
}
