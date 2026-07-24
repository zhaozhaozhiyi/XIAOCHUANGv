import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { CapabilityTokenService } from "./capability-token.service";

function createService() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const values: Record<string, unknown> = {
    AGENT_RUNTIME_CAPABILITY_PRIVATE_KEY: privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    AGENT_RUNTIME_CAPABILITY_PUBLIC_KEY: publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    AGENT_RUNTIME_CAPABILITY_TTL_SECONDS: 300,
  };
  return new CapabilityTokenService({
    get: <T>(key: string) => values[key] as T,
    getOrThrow: <T>(key: string) => values[key] as T,
  } as any);
}

describe("CapabilityTokenService", () => {
  it("binds a signed capability token to one execution and its declared tools", () => {
    const service = createService();
    const issued = service.issue({
      user_id: 7,
      organization_id: 3,
      execution_id: 81,
      task_id: 42,
      drama_id: 282,
      tool_profile: "xiaochuang-drama-source",
      allowed_tools: [
        "xiaochuang.read_source",
        "xiaochuang.submit_source_analysis",
      ],
      session_id: "u:7:org:3:drama:282:task:42:attempt:1",
      skillManifest: [
        {
          ref: "drama_adaptation_copilot@1.0.0",
          id: "drama_adaptation_copilot",
          version: "1.0.0",
          sha256: "a".repeat(64),
        },
      ],
    });

    expect(issued.token.split(".")).toHaveLength(3);
    expect(service.verify(issued.token)).toMatchObject({
      user_id: 7,
      organization_id: 3,
      execution_id: 81,
      task_id: 42,
      drama_id: 282,
      tool_profile: "xiaochuang-drama-source",
      allowed_tools: [
        "xiaochuang.read_source",
        "xiaochuang.submit_source_analysis",
      ],
      skill_sha256: ["a".repeat(64)],
    });
  });

  it("rejects a token whose payload was altered after signing", () => {
    const service = createService();
    const issued = service.issue({
      user_id: 7,
      execution_id: 81,
      task_id: 42,
      tool_profile: "xiaochuang-drama-source",
      allowed_tools: ["xiaochuang.read_source"],
      session_id: "u:7:personal:drama:none:task:42:attempt:1",
      skillManifest: [
        {
          ref: "drama_adaptation_copilot@1.0.0",
          id: "drama_adaptation_copilot",
          version: "1.0.0",
          sha256: "a".repeat(64),
        },
      ],
    });
    const [header, payload, signature] = issued.token.split(".");
    const alteredPayload = Buffer.from(
      JSON.stringify({ user_id: 999 }),
      "utf8",
    ).toString("base64url");

    expect(() =>
      service.verify(`${header}.${alteredPayload}.${signature}`),
    ).toThrow("agent_runtime_capability_token_invalid");
  });

  it("rejects an expired capability token", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const service = createService();
    const issued = service.issue({
      user_id: 7,
      execution_id: 81,
      task_id: 42,
      tool_profile: "xiaochuang-drama-source",
      allowed_tools: ["get_task_context"],
      session_id: "u:7:personal:drama:none:task:42:attempt:1",
      skillManifest: [
        {
          ref: "drama_adaptation_copilot@1.0.0",
          id: "drama_adaptation_copilot",
          version: "1.0.0",
          sha256: "a".repeat(64),
        },
      ],
    });
    now.mockReturnValue(1_301_000);

    expect(() => service.verify(issued.token)).toThrow(
      "agent_runtime_capability_token_invalid",
    );
    now.mockRestore();
  });

  it("renews a valid execution capability without changing its scope or jti", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    const service = createService();
    const issued = service.issue({
      user_id: 7,
      organization_id: 3,
      execution_id: 81,
      task_id: 42,
      drama_id: 282,
      tool_profile: "xiaochuang-drama-source",
      allowed_tools: ["get_task_context"],
      session_id: "o:3:u:7:drama:282:task:42:attempt:1",
      skillManifest: [
        {
          ref: "drama_source_understanding@1.0.0",
          id: "drama_source_understanding",
          version: "1.0.0",
          sha256: "a".repeat(64),
        },
      ],
    });
    now.mockReturnValue(1_250_000);

    const renewed = service.renew(service.verify(issued.token));

    expect(renewed.token).not.toBe(issued.token);
    expect(renewed.claims).toMatchObject({
      user_id: 7,
      organization_id: 3,
      execution_id: 81,
      task_id: 42,
      drama_id: 282,
      tool_profile: "xiaochuang-drama-source",
      jti: issued.claims.jti,
      iat: 1250,
      exp: 1550,
    });
    expect(service.verify(renewed.token)).toMatchObject({
      jti: issued.claims.jti,
      execution_id: 81,
      allowed_tools: ["get_task_context"],
    });
    now.mockRestore();
  });
});
