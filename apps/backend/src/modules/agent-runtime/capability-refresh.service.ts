import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { DatabaseService } from "../../db/database.service";
import { agentExecutions, dramas, tasks } from "../../db/schema";
import type { AgentExecutionStatus } from "./agent-runtime.types";
import {
  CapabilityTokenService,
  type CapabilityTokenClaims,
} from "./capability-token.service";
import { CapabilityTokenRevocationService } from "./capability-token-revocation.service";

const ACTIVE_EXECUTION_STATUSES = new Set<AgentExecutionStatus>([
  "created",
  "queued",
  "starting",
  "running",
  "checkpointed",
]);

const UNWRITABLE_TASK_STATUSES = new Set([
  "stopping",
  "completed",
  "failed",
  "canceled",
  "cancelled",
  "dead_letter",
]);

function organizationMatches(
  row: { organizationId?: number | null },
  claims: CapabilityTokenClaims,
) {
  return (row.organizationId ?? null) === (claims.organization_id ?? null);
}

@Injectable()
export class CapabilityRefreshService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(CapabilityTokenService)
    private readonly capabilityTokenService: CapabilityTokenService,
    @Inject(CapabilityTokenRevocationService)
    private readonly capabilityTokenRevocationService: CapabilityTokenRevocationService,
  ) {}

  async refresh(input: { token: string | undefined; executionId: number }) {
    const claims = await this.verifyCapability(input.token);
    if (input.executionId !== claims.execution_id) {
      throw new ForbiddenException("capability_refresh_execution_mismatch");
    }
    await this.assertActiveScope(claims);
    const renewed = this.capabilityTokenService.renew(claims);
    return {
      capabilityToken: renewed.token,
      expiresAt: renewed.claims.exp,
    };
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
      throw new UnauthorizedException("agent_runtime_capability_invalid");
    }
  }

  private async assertActiveScope(claims: CapabilityTokenClaims) {
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
          inArray(
            agentExecutions.status,
            [...ACTIVE_EXECUTION_STATUSES],
          ),
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
      )
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
      task.deletedAt ||
      !organizationMatches(task, claims) ||
      UNWRITABLE_TASK_STATUSES.has(task.status)
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
    if (!drama || drama.deletedAt || drama.userId !== claims.user_id) {
      throw new ForbiddenException("agent_runtime_scope_forbidden");
    }
  }
}
