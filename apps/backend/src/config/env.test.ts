import { describe, expect, it } from "vitest";

import { envSchema } from "./env";

function baseEnv(overrides: Record<string, unknown> = {}) {
  return {
    NODE_ENV: "test",
    DATABASE_URL: "postgres://xiaochuang:test@localhost:5432/xiaochuang",
    REDIS_URL: "redis://localhost:6379",
    ...overrides,
  };
}

function hermesEnv(overrides: Record<string, unknown> = {}) {
  return baseEnv({
    AGENT_RUNTIME_PROVIDER: "hermes",
    AGENT_RUNTIME_HERMES_API_KEY: "hermes-service-key",
    AGENT_RUNTIME_MCP_SERVICE_KEY: "mcp-service-key",
    AGENT_RUNTIME_MODEL_GATEWAY_SERVICE_KEY: "model-gateway-service-key",
    HERMES_RUNTIME_POOLS_JSON: JSON.stringify({ pools: [] }),
    HERMES_RUNTIME_BACKEND_BASE_URL: "http://backend.internal:3010",
    HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED: "1",
    HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED: "1",
    AGENT_RUNTIME_CAPABILITY_PRIVATE_KEY: "private-key",
    AGENT_RUNTIME_CAPABILITY_PUBLIC_KEY: "public-key",
    ...overrides,
  });
}

function productionHermesEnv(overrides: Record<string, unknown> = {}) {
  return hermesEnv({
    NODE_ENV: "production",
    AI_CONFIG_ENCRYPTION_KEY: "0123456789abcdef",
    STORAGE_DRIVER: "s3",
    STORAGE_PUBLIC_BASE_URL: "https://static.example.test",
    S3_ENDPOINT: "https://s3.example.test",
    S3_BUCKET: "xiaochuang-test",
    S3_ACCESS_KEY_ID: "access-key",
    S3_SECRET_ACCESS_KEY: "secret-key",
    HERMES_RUNTIME_BACKEND_BASE_URL: "https://backend.internal:3010",
    ...overrides,
  });
}

describe("envSchema Agent Runtime config", () => {
  it("keeps the default capability header valid when Hermes is disabled", () => {
    const parsed = envSchema.parse(baseEnv());

    expect(parsed.HERMES_RUNTIME_MCP_CAPABILITY_HEADER).toBe(
      "X-Xiaochuang-MCP-Capability",
    );
  });

  it("rejects invalid capability header names when Hermes is enabled", () => {
    const result = envSchema.safeParse(
      hermesEnv({
        HERMES_RUNTIME_MCP_CAPABILITY_HEADER: "X-Bad\nHeader",
      }),
    );

    if (result.success) throw new Error("expected_invalid_header_rejected");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["HERMES_RUNTIME_MCP_CAPABILITY_HEADER"],
        }),
      ]),
    );
  });

  it("rejects reserved capability header names when Hermes is enabled", () => {
    for (const header of ["Authorization", "X-Xiaochuang-MCP-Service-Key"]) {
      const result = envSchema.safeParse(
        hermesEnv({
          HERMES_RUNTIME_MCP_CAPABILITY_HEADER: header,
        }),
      );

      if (result.success) throw new Error("expected_reserved_header_rejected");
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message:
              "HERMES_RUNTIME_MCP_CAPABILITY_HEADER must be a non-reserved HTTP header token",
          }),
        ]),
      );
    }
  });

  it("requires a fixed MCP service identity when Hermes runtime is enabled", () => {
    const result = envSchema.safeParse(
      hermesEnv({
        AGENT_RUNTIME_MCP_SERVICE_KEY: "",
      }),
    );

    if (result.success) throw new Error("expected_mcp_service_key_required");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["AGENT_RUNTIME_MCP_SERVICE_KEY"],
          message:
            "AGENT_RUNTIME_MCP_SERVICE_KEY is required when AGENT_RUNTIME_PROVIDER=hermes",
        }),
      ]),
    );
  });

  it("requires an HTTPS Backend callback URL for production Hermes runtime", () => {
    const result = envSchema.safeParse(
      productionHermesEnv({
        HERMES_RUNTIME_BACKEND_BASE_URL: "http://backend.internal:3010",
      }),
    );

    if (result.success) throw new Error("expected_http_backend_url_rejected");
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "production Hermes runtime requires HERMES_RUNTIME_BACKEND_BASE_URL=https://...",
        }),
      ]),
    );
  });
});
