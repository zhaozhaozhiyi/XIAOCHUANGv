import {
  createPrivateKey,
  createPublicKey,
  randomUUID,
  sign,
  verify,
} from "node:crypto";

import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import type { SkillManifestEntry } from "./agent-runtime.types";

export type CapabilityTokenClaims = {
  user_id: number;
  organization_id?: number;
  execution_id: number;
  task_id: number;
  drama_id?: number;
  tool_profile: string;
  allowed_tools: string[];
  skill_sha256: string[];
  session_id: string;
  exp: number;
  iat: number;
  jti: string;
};

export type IssueCapabilityTokenInput = Omit<
  CapabilityTokenClaims,
  "exp" | "iat" | "jti" | "skill_sha256"
> & {
  skillManifest: SkillManifestEntry[];
};

function encode(value: string | Record<string, unknown>) {
  return Buffer.from(
    typeof value === "string" ? value : JSON.stringify(value),
    "utf8",
  ).toString("base64url");
}

function decode(value: string) {
  return JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as unknown;
}

function normalizePem(value: string | undefined) {
  return String(value || "")
    .trim()
    .replace(/\\n/g, "\n");
}

function readClaims(value: unknown): CapabilityTokenClaims {
  const raw =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const userId = Number(raw.user_id);
  const executionId = Number(raw.execution_id);
  const taskId = Number(raw.task_id);
  const exp = Number(raw.exp);
  const iat = Number(raw.iat);
  const organizationId =
    raw.organization_id == null ? undefined : Number(raw.organization_id);
  const dramaId = raw.drama_id == null ? undefined : Number(raw.drama_id);

  if (
    !Number.isInteger(userId) ||
    userId <= 0 ||
    !Number.isInteger(executionId) ||
    executionId <= 0 ||
    !Number.isInteger(taskId) ||
    taskId <= 0 ||
    !Number.isInteger(exp) ||
    !Number.isInteger(iat) ||
    (organizationId != null &&
      (!Number.isInteger(organizationId) || organizationId <= 0)) ||
    (dramaId != null && (!Number.isInteger(dramaId) || dramaId <= 0)) ||
    typeof raw.tool_profile !== "string" ||
    !raw.tool_profile ||
    !Array.isArray(raw.allowed_tools) ||
    !raw.allowed_tools.every((item) => typeof item === "string" && item) ||
    !Array.isArray(raw.skill_sha256) ||
    !raw.skill_sha256.every((item) => typeof item === "string" && item) ||
    typeof raw.session_id !== "string" ||
    !raw.session_id ||
    typeof raw.jti !== "string" ||
    !raw.jti
  ) {
    throw new BadRequestException("agent_runtime_capability_token_invalid");
  }

  return {
    user_id: userId,
    organization_id: organizationId,
    execution_id: executionId,
    task_id: taskId,
    drama_id: dramaId,
    tool_profile: raw.tool_profile,
    allowed_tools: raw.allowed_tools,
    skill_sha256: raw.skill_sha256,
    session_id: raw.session_id,
    exp,
    iat,
    jti: raw.jti,
  };
}

@Injectable()
export class CapabilityTokenService {
  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
  ) {}

  issue(input: IssueCapabilityTokenInput) {
    if (!input.allowed_tools.length)
      throw new BadRequestException("agent_runtime_allowed_tools_required");
    if (!input.skillManifest.length)
      throw new BadRequestException("agent_runtime_skill_manifest_required");

    return this.signClaims({
      user_id: input.user_id,
      organization_id: input.organization_id,
      execution_id: input.execution_id,
      task_id: input.task_id,
      drama_id: input.drama_id,
      tool_profile: input.tool_profile,
      allowed_tools: [...new Set(input.allowed_tools)],
      skill_sha256: input.skillManifest.map((skill) => skill.sha256),
      session_id: input.session_id,
    });
  }

  renew(claims: CapabilityTokenClaims) {
    return this.signClaims({
      user_id: claims.user_id,
      organization_id: claims.organization_id,
      execution_id: claims.execution_id,
      task_id: claims.task_id,
      drama_id: claims.drama_id,
      tool_profile: claims.tool_profile,
      allowed_tools: claims.allowed_tools,
      skill_sha256: claims.skill_sha256,
      session_id: claims.session_id,
      // The JTI represents the active execution capability, not a single
      // serialized token. Keeping it stable preserves terminal revocation.
      jti: claims.jti,
    });
  }

  private signClaims(
    input: Omit<CapabilityTokenClaims, "exp" | "iat" | "jti"> & {
      jti?: string;
    },
  ) {
    const privateKeyPem = normalizePem(
      this.configService.get<string>("AGENT_RUNTIME_CAPABILITY_PRIVATE_KEY"),
    );
    if (!privateKeyPem)
      throw new ServiceUnavailableException(
        "agent_runtime_capability_private_key_missing",
      );

    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = this.configService.getOrThrow<number>(
      "AGENT_RUNTIME_CAPABILITY_TTL_SECONDS",
    );
    const claims: CapabilityTokenClaims = {
      ...input,
      allowed_tools: [...new Set(input.allowed_tools)],
      skill_sha256: [...new Set(input.skill_sha256)],
      iat: now,
      exp: now + ttlSeconds,
      jti: input.jti || randomUUID(),
    };
    const header = encode({ alg: "EdDSA", typ: "JWT" });
    const payload = encode(claims);
    const signed = `${header}.${payload}`;
    const signature = sign(
      null,
      Buffer.from(signed),
      createPrivateKey(privateKeyPem),
    ).toString("base64url");

    return { token: `${signed}.${signature}`, claims };
  }

  verify(token: string) {
    const parts = String(token || "").split(".");
    if (parts.length !== 3)
      throw new BadRequestException("agent_runtime_capability_token_invalid");

    const publicKeyPem = normalizePem(
      this.configService.get<string>("AGENT_RUNTIME_CAPABILITY_PUBLIC_KEY"),
    );
    if (!publicKeyPem)
      throw new ServiceUnavailableException(
        "agent_runtime_capability_public_key_missing",
      );

    let header: Record<string, unknown>;
    let claims: CapabilityTokenClaims;
    try {
      header = decode(parts[0]) as Record<string, unknown>;
      claims = readClaims(decode(parts[1]));
    } catch {
      throw new BadRequestException("agent_runtime_capability_token_invalid");
    }

    if (header.alg !== "EdDSA" || header.typ !== "JWT") {
      throw new BadRequestException("agent_runtime_capability_token_invalid");
    }
    const signature = Buffer.from(parts[2], "base64url");
    const valid = verify(
      null,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey(publicKeyPem),
      signature,
    );
    if (!valid || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new BadRequestException("agent_runtime_capability_token_invalid");
    }
    return claims;
  }
}
