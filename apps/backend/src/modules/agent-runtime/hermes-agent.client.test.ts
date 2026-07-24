import { describe, expect, it, vi } from "vitest";

import { HermesAgentClient } from "./hermes-agent.client";

const skillManifest = [
  {
    ref: "drama_adaptation_copilot@1.0.0",
    id: "drama_adaptation_copilot",
    version: "1.0.0",
    sha256: "a".repeat(64),
  },
];

describe("HermesAgentClient", () => {
  it("sends only the pinned skill ref and digest to Hermes", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ run_id: "run_123", status: "started" }), {
        status: 202,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new HermesAgentClient({
      getOrThrow: vi.fn((key: string) => {
        const config: Record<string, string> = {
          AGENT_RUNTIME_HERMES_API_KEY: "hermes-service-key",
          HERMES_RUNTIME_MCP_CAPABILITY_HEADER:
            "X-Xiaochuang-MCP-Capability",
          HERMES_RUNTIME_BACKEND_BASE_URL: "http://backend.internal:3010",
        };
        return config[key];
      }),
    } as any);

    await expect(
      client.createRun(
        { name: "hermes-source-1", baseUrl: "http://hermes.internal:8642" },
        {
          sessionId: "u:1:task:2:attempt:1",
          instruction: "run the source analysis workflow",
          capabilityToken: "capability-token",
          executionId: 9,
          toolProfile: "xiaochuang-drama-source",
          skillManifest,
        },
      ),
    ).resolves.toEqual({ remoteRunId: "run_123", status: "started" });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const encodedManifest = headers["X-Xiaochuang-Skill-Manifest"];
    expect(
      JSON.parse(
        Buffer.from(encodedManifest, "base64url").toString("utf8"),
      ),
    ).toEqual([
      {
        ref: "drama_adaptation_copilot@1.0.0",
        sha256: "a".repeat(64),
      },
    ]);
    expect(String(init.body)).not.toContain("drama_adaptation_copilot");
    expect(String(init.body)).not.toContain("a".repeat(64));
    expect(headers.Authorization).toBe("Bearer hermes-service-key");
  });

  it("passes the projector AbortSignal to the Hermes SSE request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const client = new HermesAgentClient({
      getOrThrow: vi.fn((key: string) => {
        const config: Record<string, string> = {
          AGENT_RUNTIME_HERMES_API_KEY: "hermes-service-key",
          HERMES_RUNTIME_MCP_CAPABILITY_HEADER:
            "X-Xiaochuang-MCP-Capability",
          HERMES_RUNTIME_BACKEND_BASE_URL: "http://backend.internal:3010",
        };
        return config[key];
      }),
    } as any);

    await expect(
      client.streamEvents({
        instance: {
          name: "hermes-source-1",
          baseUrl: "http://hermes.internal:8642",
        },
        remoteRunId: "run_456",
        signal: controller.signal,
        onHeartbeat: vi.fn(),
        onEvent: vi.fn(),
      }),
    ).rejects.toThrow("hermes_runtime_events_body_missing");

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });
});
