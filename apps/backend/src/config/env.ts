import { z } from "zod";

function isRemoteHttpUrl(value: string | null | undefined) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

function isHttpsUrl(value: string | null | undefined) {
  return /^https:\/\//i.test(String(value || "").trim());
}

function isHttpHeaderToken(value: string) {
  return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(value);
}

const RESERVED_AGENT_RUNTIME_HEADER_NAMES = new Set([
  "authorization",
  "content-type",
  "cookie",
  "host",
  "set-cookie",
  "x-xiaochuang-backend-base-url",
  "x-xiaochuang-execution-id",
  "x-xiaochuang-mcp-capability-header",
  "x-xiaochuang-mcp-service-key",
  "x-xiaochuang-tool-profile",
]);

function booleanEnv(defaultValue: boolean) {
  return z
    .preprocess((value) => {
      if (typeof value !== "string") return value;
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
      if (["0", "false", "no", "n", "off", ""].includes(normalized))
        return false;
      return value;
    }, z.boolean())
    .default(defaultValue);
}

const baseEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(3010),
    DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().trim().min(1, "REDIS_URL is required"),
    CORS_ORIGINS: z
      .string()
      .default("http://localhost:3001,http://localhost:3002"),
    SESSION_COOKIE_NAME: z.string().default("xiaochuang_session"),
    SESSION_DURATION_DAYS: z.coerce.number().int().positive().default(7),
    SMS_PROVIDER: z.string().optional(),
    AI_CONFIG_ENCRYPTION_KEY: z.string().optional(),
    DEV_AUTH_BYPASS: booleanEnv(false),
    E2E_AUTH_MOCK: booleanEnv(false),
    DEV_AUTH_CODE: z.string().optional(),
    DEV_AUTH_PHONE: z.string().optional(),
    WEBHOOK_BASE_URL: z.string().optional(),
    VIDU_WEBHOOK_SECRET: z.string().optional(),
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_PATH: z.string().default("../data/static"),
    STORAGE_PUBLIC_BASE_URL: z.string().optional(),
    STORAGE_S3_FORCE_PATH_STYLE: booleanEnv(true),
    STORAGE_OBJECT_ACL: z.string().optional(),
    STORAGE_REMOTE_URL_ALLOWLIST: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    DRAMA_AI_FIRST_ENABLED: booleanEnv(true),
    DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK: booleanEnv(false),
    AGENT_RUNTIME_PROVIDER: z.enum(["disabled", "hermes"]).default("disabled"),
    AGENT_RUNTIME_HERMES_API_KEY: z.string().optional(),
    AGENT_RUNTIME_MCP_SERVICE_KEY: z.string().optional(),
    AGENT_RUNTIME_MODEL_GATEWAY_SERVICE_KEY: z.string().optional(),
    HERMES_RUNTIME_POOLS_JSON: z.string().optional(),
    HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED: booleanEnv(false),
    HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED: booleanEnv(false),
    HERMES_RUNTIME_BACKEND_BASE_URL: z.string().optional(),
    HERMES_RUNTIME_MCP_CAPABILITY_HEADER: z
      .string()
      .trim()
      .default("X-Xiaochuang-MCP-Capability"),
    AGENT_RUNTIME_CAPABILITY_PRIVATE_KEY: z.string().optional(),
    AGENT_RUNTIME_CAPABILITY_PUBLIC_KEY: z.string().optional(),
    AGENT_RUNTIME_CAPABILITY_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    AGENT_RUNTIME_LEASE_TTL_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
  })
  // Keep unknown env vars (e.g. VOLC_ARK_API_KEY, VOLC_VOICE, VOLC_RESOURCE_ID)
  // so @nestjs/config writes them back to process.env instead of stripping them.
  .passthrough();

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  const publicBaseUrl = String(env.STORAGE_PUBLIC_BASE_URL || "").trim();
  const devAuthBypassEnabled = env.DEV_AUTH_BYPASS || env.E2E_AUTH_MOCK;
  const devAuthCode = String(env.DEV_AUTH_CODE || "").trim();
  const devAuthPhone = String(env.DEV_AUTH_PHONE || "").trim();
  const aiConfigEncryptionKey = String(
    env.AI_CONFIG_ENCRYPTION_KEY || "",
  ).trim();
  const smsProvider = String(env.SMS_PROVIDER || "")
    .trim()
    .toLowerCase();
  const webhookBaseUrl = String(env.WEBHOOK_BASE_URL || "").trim();
  const viduWebhookSecret = String(env.VIDU_WEBHOOK_SECRET || "").trim();
  const runtimeCapabilityHeader = env.HERMES_RUNTIME_MCP_CAPABILITY_HEADER;

  if (env.NODE_ENV === "production" && env.DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK"],
      message:
        "DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK must stay disabled in production",
    });
  }

  if (env.AGENT_RUNTIME_PROVIDER === "hermes") {
    for (const [field, value] of [
      ["AGENT_RUNTIME_HERMES_API_KEY", env.AGENT_RUNTIME_HERMES_API_KEY],
      ["AGENT_RUNTIME_MCP_SERVICE_KEY", env.AGENT_RUNTIME_MCP_SERVICE_KEY],
      [
        "AGENT_RUNTIME_MODEL_GATEWAY_SERVICE_KEY",
        env.AGENT_RUNTIME_MODEL_GATEWAY_SERVICE_KEY,
      ],
      ["HERMES_RUNTIME_POOLS_JSON", env.HERMES_RUNTIME_POOLS_JSON],
      ["HERMES_RUNTIME_BACKEND_BASE_URL", env.HERMES_RUNTIME_BACKEND_BASE_URL],
      [
        "AGENT_RUNTIME_CAPABILITY_PRIVATE_KEY",
        env.AGENT_RUNTIME_CAPABILITY_PRIVATE_KEY,
      ],
      [
        "AGENT_RUNTIME_CAPABILITY_PUBLIC_KEY",
        env.AGENT_RUNTIME_CAPABILITY_PUBLIC_KEY,
      ],
    ] as const) {
      if (String(value || "").trim()) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} is required when AGENT_RUNTIME_PROVIDER=hermes`,
      });
    }

    if (!env.HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED"],
        message:
          "Hermes runtime requires verified per-run MCP capability propagation",
      });
    }
    if (!env.HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED"],
        message:
          "Hermes runtime requires verified per-run Model Gateway capability propagation",
      });
    }

    if (!isRemoteHttpUrl(env.HERMES_RUNTIME_BACKEND_BASE_URL)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HERMES_RUNTIME_BACKEND_BASE_URL"],
        message:
          "HERMES_RUNTIME_BACKEND_BASE_URL must be an http(s) URL when AGENT_RUNTIME_PROVIDER=hermes",
      });
    }
    if (
      env.NODE_ENV === "production" &&
      !isHttpsUrl(env.HERMES_RUNTIME_BACKEND_BASE_URL)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HERMES_RUNTIME_BACKEND_BASE_URL"],
        message:
          "production Hermes runtime requires HERMES_RUNTIME_BACKEND_BASE_URL=https://...",
      });
    }

    if (
      !runtimeCapabilityHeader ||
      !isHttpHeaderToken(runtimeCapabilityHeader) ||
      RESERVED_AGENT_RUNTIME_HEADER_NAMES.has(
        runtimeCapabilityHeader.toLowerCase(),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["HERMES_RUNTIME_MCP_CAPABILITY_HEADER"],
        message:
          "HERMES_RUNTIME_MCP_CAPABILITY_HEADER must be a non-reserved HTTP header token",
      });
    }
  }

  if (env.NODE_ENV === "production" && !aiConfigEncryptionKey) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AI_CONFIG_ENCRYPTION_KEY"],
      message: "AI_CONFIG_ENCRYPTION_KEY is required in production",
    });
  }

  if (env.NODE_ENV === "production" && smsProvider === "console") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["SMS_PROVIDER"],
      message: "SMS_PROVIDER=console is not allowed in production",
    });
  }

  if (aiConfigEncryptionKey && aiConfigEncryptionKey.length < 16) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["AI_CONFIG_ENCRYPTION_KEY"],
      message:
        "AI_CONFIG_ENCRYPTION_KEY must be at least 16 characters when provided",
    });
  }

  if (webhookBaseUrl && !isRemoteHttpUrl(webhookBaseUrl)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WEBHOOK_BASE_URL"],
      message: "WEBHOOK_BASE_URL must be an http(s) URL",
    });
  }

  if (
    (webhookBaseUrl || viduWebhookSecret) &&
    (!webhookBaseUrl || !viduWebhookSecret)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["VIDU_WEBHOOK_SECRET"],
      message:
        "WEBHOOK_BASE_URL and VIDU_WEBHOOK_SECRET must be configured together",
    });
  }

  if (viduWebhookSecret && viduWebhookSecret.length < 16) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["VIDU_WEBHOOK_SECRET"],
      message:
        "VIDU_WEBHOOK_SECRET must be at least 16 characters when provided",
    });
  }

  if (env.NODE_ENV === "production" && env.STORAGE_DRIVER !== "s3") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["STORAGE_DRIVER"],
      message: "production requires STORAGE_DRIVER=s3",
    });
  }

  if (env.STORAGE_DRIVER === "s3") {
    for (const [field, value] of [
      ["S3_ENDPOINT", env.S3_ENDPOINT],
      ["S3_BUCKET", env.S3_BUCKET],
      ["S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID],
      ["S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY],
    ] as const) {
      if (String(value || "").trim()) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field],
        message: `${field} is required when STORAGE_DRIVER=s3`,
      });
    }
  }

  if (env.STORAGE_DRIVER === "s3" || env.NODE_ENV === "production") {
    if (!publicBaseUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_PUBLIC_BASE_URL"],
        message:
          "STORAGE_PUBLIC_BASE_URL is required for s3 or production storage",
      });
      return;
    }

    if (!isRemoteHttpUrl(publicBaseUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STORAGE_PUBLIC_BASE_URL"],
        message:
          "STORAGE_PUBLIC_BASE_URL must be an http(s) URL for s3 or production storage",
      });
    }
  }

  if (env.NODE_ENV === "production" && devAuthBypassEnabled) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DEV_AUTH_BYPASS"],
      message: "DEV_AUTH_BYPASS/E2E_AUTH_MOCK must stay disabled in production",
    });
  }

  if ((devAuthBypassEnabled || devAuthCode) && !/^\d{6}$/.test(devAuthCode)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DEV_AUTH_CODE"],
      message:
        "DEV_AUTH_CODE must be a 6-digit code when provided or when DEV_AUTH_BYPASS=1 / E2E_AUTH_MOCK=1",
    });
  }

  if (devAuthPhone && !/^1\d{10}$/.test(devAuthPhone)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["DEV_AUTH_PHONE"],
      message:
        "DEV_AUTH_PHONE must be a valid mainland China mobile number when provided",
    });
  }
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv() {
  return envSchema.parse(process.env);
}
