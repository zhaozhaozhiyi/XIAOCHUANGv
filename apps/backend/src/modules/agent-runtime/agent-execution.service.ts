import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { desc, eq, inArray } from "drizzle-orm";

import { DatabaseService } from "../../db/database.service";
import { agentExecutions } from "../../db/schema";
import type {
  AgentExecutionStatus,
  AgentRunProfile,
  PreparedAgentRunProfile,
} from "./agent-runtime.types";
import { CapabilityTokenRevocationService } from "./capability-token-revocation.service";

export type AgentExecutionRecord = typeof agentExecutions.$inferSelect;

const ACTIVE_EXECUTION_STATUSES: AgentExecutionStatus[] = [
  "created",
  "queued",
  "starting",
  "running",
  "checkpointed",
  "stopping",
];

const TERMINAL_EXECUTION_STATUSES = new Set<AgentExecutionStatus>([
  "completed",
  "failed",
  "canceled",
  "orphaned",
]);

function buildSessionId(profile: AgentRunProfile, attemptNo: number) {
  return [
    profile.organizationId ? `o:${profile.organizationId}` : null,
    `u:${profile.userId}`,
    profile.dramaId ? `drama:${profile.dramaId}` : "drama:none",
    `task:${profile.taskId}`,
    `attempt:${attemptNo}`,
  ]
    .filter(Boolean)
    .join(":");
}

function organizationId(value: number | null | undefined) {
  return value ?? null;
}

function activeExecutionMatchesPrepared(
  execution: AgentExecutionRecord,
  prepared: PreparedAgentRunProfile,
) {
  return (
    execution.userId === prepared.profile.userId &&
    organizationId(execution.organizationId) ===
      organizationId(prepared.profile.organizationId) &&
    execution.taskId === prepared.profile.taskId &&
    execution.toolProfile === prepared.profile.toolProfile &&
    execution.modelProfile === prepared.profile.modelProfile &&
    execution.sessionId ===
      buildSessionId(prepared.profile, execution.attemptNo) &&
    execution.skillManifestJson === JSON.stringify(prepared.skillManifest)
  );
}

@Injectable()
export class AgentExecutionService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(CapabilityTokenRevocationService)
    private readonly capabilityTokenRevocationService: CapabilityTokenRevocationService,
  ) {}

  async createOrReuseActiveAttempt(prepared: PreparedAgentRunProfile) {
    const [latest] = await this.databaseService.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.taskId, prepared.profile.taskId))
      .orderBy(desc(agentExecutions.attemptNo))
      .limit(1);

    if (
      latest &&
      ACTIVE_EXECUTION_STATUSES.includes(latest.status as AgentExecutionStatus)
    ) {
      if (!activeExecutionMatchesPrepared(latest, prepared)) {
        throw new ConflictException("agent_execution_active_scope_mismatch");
      }
      return { execution: latest, reused: true };
    }

    const attemptNo = (latest?.attemptNo ?? 0) + 1;
    const now = new Date();
    const [execution] = await this.databaseService.db
      .insert(agentExecutions)
      .values({
        userId: prepared.profile.userId,
        organizationId: prepared.profile.organizationId ?? null,
        taskId: prepared.profile.taskId,
        attemptNo,
        runtime: "hermes",
        sessionId: buildSessionId(prepared.profile, attemptNo),
        status: "created",
        toolProfile: prepared.profile.toolProfile,
        skillManifestJson: JSON.stringify(prepared.skillManifest),
        modelProfile: prepared.profile.modelProfile,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!execution) throw new Error("agent_execution_create_failed");
    return { execution, reused: false };
  }

  async findActive(limit: number) {
    return this.databaseService.db
      .select()
      .from(agentExecutions)
      .where(inArray(agentExecutions.status, ACTIVE_EXECUTION_STATUSES))
      .orderBy(agentExecutions.updatedAt)
      .limit(limit);
  }

  async findLatestForTaskIds(taskIds: number[]) {
    const uniqueTaskIds = [
      ...new Set(
        taskIds.filter(
          (taskId) => Number.isInteger(taskId) && taskId > 0,
        ),
      ),
    ];
    if (!uniqueTaskIds.length) return [];

    const executions = await this.databaseService.db
      .select()
      .from(agentExecutions)
      .where(inArray(agentExecutions.taskId, uniqueTaskIds))
      .orderBy(desc(agentExecutions.attemptNo));
    const latestByTaskId = new Map<number, AgentExecutionRecord>();
    for (const execution of executions) {
      if (!latestByTaskId.has(execution.taskId)) {
        latestByTaskId.set(execution.taskId, execution);
      }
    }
    return [...latestByTaskId.values()];
  }

  async findOwned(executionId: number, userId: number) {
    const [execution] = await this.databaseService.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.id, executionId))
      .limit(1);
    return execution?.userId === userId ? execution : null;
  }

  async findById(executionId: number) {
    const [execution] = await this.databaseService.db
      .select()
      .from(agentExecutions)
      .where(eq(agentExecutions.id, executionId))
      .limit(1);
    return execution ?? null;
  }

  async markStarting(args: {
    executionId: number;
    capabilityJti: string;
    poolName: string;
    instanceName: string;
  }) {
    return this.update(args.executionId, {
      status: "starting",
      capabilityJti: args.capabilityJti,
      checkpointJson: JSON.stringify({
        pool: args.poolName,
        instance: args.instanceName,
        phase: "starting",
      }),
      startedAt: new Date(),
      errorKind: null,
      errorMessage: null,
    });
  }

  async markQueued(
    executionId: number,
    reason: string,
    poolName: string | null = null,
  ) {
    return this.update(executionId, {
      status: "queued",
      checkpointJson: JSON.stringify({
        phase: "queued",
        reason,
        pool: poolName,
      }),
    });
  }

  async markRunning(args: {
    executionId: number;
    remoteRunId: string;
    poolName: string;
    instanceName: string;
  }) {
    return this.update(args.executionId, {
      status: "running",
      remoteRunId: args.remoteRunId,
      checkpointJson: JSON.stringify({
        pool: args.poolName,
        instance: args.instanceName,
        phase: "running",
      }),
    });
  }

  async updateStatus(
    executionId: number,
    status: AgentExecutionStatus,
    options: {
      errorKind?: string | null;
      errorMessage?: string | null;
      checkpoint?: Record<string, unknown> | null;
    } = {},
  ) {
    const values: Partial<typeof agentExecutions.$inferInsert> = {
      status,
      errorKind: options.errorKind ?? null,
      errorMessage: options.errorMessage ?? null,
    };
    if (options.checkpoint !== undefined) {
      values.checkpointJson = options.checkpoint
        ? JSON.stringify(options.checkpoint)
        : null;
    }
    if (TERMINAL_EXECUTION_STATUSES.has(status))
      values.completedAt = new Date();
    const execution = await this.update(executionId, values);
    if (TERMINAL_EXECUTION_STATUSES.has(status)) {
      await this.capabilityTokenRevocationService.revoke(
        execution?.capabilityJti,
      );
    }
    return execution;
  }

  async recordEvent(executionId: number, event: Record<string, unknown>) {
    const [current] = await this.databaseService.db
      .select({
        lastEventSeq: agentExecutions.lastEventSeq,
      })
      .from(agentExecutions)
      .where(eq(agentExecutions.id, executionId))
      .limit(1);

    return this.update(executionId, {
      lastEventSeq: (current?.lastEventSeq ?? 0) + 1,
      lastEventJson: JSON.stringify(event),
    });
  }

  async update(
    executionId: number,
    values: Partial<typeof agentExecutions.$inferInsert>,
  ) {
    const [execution] = await this.databaseService.db
      .update(agentExecutions)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(eq(agentExecutions.id, executionId))
      .returning();
    return execution ?? null;
  }
}
