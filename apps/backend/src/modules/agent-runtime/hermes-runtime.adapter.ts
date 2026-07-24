import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import {
  AgentExecutionService,
  type AgentExecutionRecord,
} from "./agent-execution.service";
import type {
  AgentExecutionStatus,
  AgentRunProfile,
  AgentRuntimeRunResult,
  HermesPoolInstance,
} from "./agent-runtime.types";
import { CapabilityTokenService } from "./capability-token.service";
import { ConcurrencyBudgetService } from "./concurrency-budget.service";
import { HermesAgentClient, HermesAgentHttpError } from "./hermes-agent.client";
import { HermesPoolRegistry } from "./hermes-pool.registry";
import { RunProfileValidator } from "./run-profile-validator.service";

function parseCheckpoint(value: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function terminalStatusForEvent(
  eventName: string,
): AgentExecutionStatus | null {
  if (eventName === "run.completed") return "completed";
  if (eventName === "run.failed") return "failed";
  if (eventName === "run.cancelled") return "canceled";
  return null;
}

function terminalStatusForRemoteStatus(
  status: string,
): AgentExecutionStatus | null {
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "cancelled" || status === "canceled") return "canceled";
  return null;
}

function isUnexpectedRuntimeCancellation(
  status: AgentExecutionStatus,
  executionStatus: string,
) {
  return status === "canceled" && executionStatus !== "stopping";
}

function compactEvent(event: Record<string, unknown>) {
  const eventName = String(event.event || "");
  if (eventName === "message.delta") {
    return {
      event: eventName,
      run_id: event.run_id ?? null,
      timestamp: event.timestamp ?? null,
      delta_length: String(event.delta || "").length,
    };
  }
  if (eventName === "reasoning.available") {
    return {
      event: eventName,
      run_id: event.run_id ?? null,
      timestamp: event.timestamp ?? null,
      text_length: String(event.text || "").length,
    };
  }
  return event;
}

@Injectable()
export class HermesRuntimeAdapter {
  private readonly eventProjectionExecutionIds = new Set<number>();

  constructor(
    @Inject(ConfigService) private readonly configService: ConfigService,
    @Inject(AgentExecutionService)
    private readonly executionService: AgentExecutionService,
    @Inject(RunProfileValidator)
    private readonly profileValidator: RunProfileValidator,
    @Inject(CapabilityTokenService)
    private readonly capabilityTokenService: CapabilityTokenService,
    @Inject(ConcurrencyBudgetService)
    private readonly concurrencyBudget: ConcurrencyBudgetService,
    @Inject(HermesPoolRegistry)
    private readonly poolRegistry: HermesPoolRegistry,
    @Inject(HermesAgentClient)
    private readonly hermesAgentClient: HermesAgentClient,
  ) {}

  isEnabled() {
    return (
      this.configService.getOrThrow<string>("AGENT_RUNTIME_PROVIDER") ===
      "hermes"
    );
  }

  async run(profile: AgentRunProfile): Promise<AgentRuntimeRunResult> {
    this.assertEnabled();
    const prepared = await this.profileValidator.prepare(profile);
    const created =
      await this.executionService.createOrReuseActiveAttempt(prepared);
    const execution = created.execution;
    const existingCheckpoint = parseCheckpoint(execution.checkpointJson);

    if (
      execution.remoteRunId &&
      ["running", "checkpointed", "stopping"].includes(execution.status)
    ) {
      return {
        executionId: execution.id,
        remoteRunId: execution.remoteRunId,
        status: execution.status as AgentExecutionStatus,
        pool:
          typeof existingCheckpoint.pool === "string"
            ? existingCheckpoint.pool
            : null,
        instance:
          typeof existingCheckpoint.instance === "string"
            ? existingCheckpoint.instance
            : null,
        reused: true,
      };
    }

    const capability = this.capabilityTokenService.issue({
      user_id: prepared.profile.userId,
      organization_id: prepared.profile.organizationId ?? undefined,
      execution_id: execution.id,
      task_id: prepared.profile.taskId,
      drama_id: prepared.profile.dramaId ?? undefined,
      tool_profile: prepared.profile.toolProfile,
      allowed_tools: prepared.pool.allowedTools,
      session_id: execution.sessionId,
      skillManifest: prepared.skillManifest,
    });
    let lastQueueReason: string | null = null;
    let lastGatewayError: unknown = null;

    for (const instance of this.poolRegistry.getCandidateInstances(
      prepared.pool,
    )) {
      const lease = await this.concurrencyBudget.acquire({
        executionId: execution.id,
        userId: prepared.profile.userId,
        poolName: prepared.pool.name,
        instanceName: instance.name,
        maxConcurrentRuns: prepared.pool.maxConcurrentRuns,
        maxConcurrentRunsPerUser: prepared.pool.maxConcurrentRunsPerUser,
      });
      if (lease.status === "queued") {
        lastQueueReason = lease.reason;
        continue;
      }

      try {
        await this.executionService.markStarting({
          executionId: execution.id,
          capabilityJti: capability.claims.jti,
          poolName: prepared.pool.name,
          instanceName: instance.name,
        });
        const remote = await this.hermesAgentClient.createRun(instance, {
          sessionId: execution.sessionId,
          instruction: prepared.profile.instruction,
          capabilityToken: capability.token,
          executionId: execution.id,
          toolProfile: prepared.profile.toolProfile,
          skillManifest: prepared.skillManifest,
        });
        await this.executionService.markRunning({
          executionId: execution.id,
          remoteRunId: remote.remoteRunId,
          poolName: prepared.pool.name,
          instanceName: instance.name,
        });
        await this.ensureEventProjection(
          execution.id,
          instance,
          remote.remoteRunId,
        );
        return {
          executionId: execution.id,
          remoteRunId: remote.remoteRunId,
          status: "running",
          pool: prepared.pool.name,
          instance: instance.name,
          reused: created.reused,
        };
      } catch (error) {
        await this.concurrencyBudget
          .release(execution.id)
          .catch(() => undefined);
        lastGatewayError = error;
        if (error instanceof HermesAgentHttpError && error.status === 429) {
          lastQueueReason = "hermes_rate_limit";
          continue;
        }
      }
    }

    if (lastGatewayError) {
      const message =
        lastGatewayError instanceof Error
          ? lastGatewayError.message
          : "hermes_runtime_start_failed";
      await this.executionService.updateStatus(execution.id, "failed", {
        errorKind: "runtime",
        errorMessage: message,
      });
      throw lastGatewayError;
    }

    await this.executionService.markQueued(
      execution.id,
      lastQueueReason || "pool_full",
      prepared.pool.name,
    );
    return {
      executionId: execution.id,
      remoteRunId: null,
      status: "queued",
      pool: prepared.pool.name,
      instance: null,
      reused: created.reused,
    };
  }

  async stop(executionId: number, userId: number) {
    this.assertEnabled();
    const execution = await this.executionService.findOwned(
      executionId,
      userId,
    );
    if (!execution) return null;
    if (!execution.remoteRunId) {
      await this.executionService.updateStatus(execution.id, "canceled");
      await this.concurrencyBudget.release(execution.id).catch(() => undefined);
      return { executionId, status: "canceled" };
    }

    const target = this.resolveInstanceForExecution(execution);
    if (!target) {
      await this.executionService.updateStatus(execution.id, "orphaned", {
        errorKind: "runtime",
        errorMessage: "hermes_runtime_instance_not_found",
      });
      await this.concurrencyBudget.release(execution.id).catch(() => undefined);
      return { executionId, status: "orphaned" };
    }
    await this.executionService.updateStatus(execution.id, "stopping");
    await this.hermesAgentClient.stopRun(
      target.instance,
      execution.remoteRunId,
    );
    return { executionId, status: "stopping" };
  }

  async reconcileActive(limit: number) {
    if (!this.isEnabled())
      return {
        enabled: false,
        checked: 0,
        reconciled: 0,
        orphaned: 0,
        failures: [] as string[],
      };

    const activeExecutions = await this.executionService.findActive(limit);
    let reconciled = 0;
    let orphaned = 0;
    const failures: string[] = [];

    for (const execution of activeExecutions) {
      if (!execution.remoteRunId) continue;
      const target = this.resolveInstanceForExecution(execution);
      if (!target) {
        await this.executionService.updateStatus(execution.id, "orphaned", {
          errorKind: "runtime",
          errorMessage: "hermes_runtime_instance_not_found",
        });
        await this.concurrencyBudget
          .release(execution.id)
          .catch(() => undefined);
        orphaned += 1;
        continue;
      }

      try {
        const remote = await this.hermesAgentClient.getRun(
          target.instance,
          execution.remoteRunId,
        );
        const terminal = terminalStatusForRemoteStatus(remote.status);
        if (terminal) {
          const unexpectedCancellation = isUnexpectedRuntimeCancellation(
            terminal,
            execution.status,
          );
          const nextStatus = unexpectedCancellation ? "orphaned" : terminal;
          await this.executionService.updateStatus(execution.id, nextStatus, {
            errorKind:
              nextStatus === "failed" || unexpectedCancellation
                ? "runtime"
                : null,
            errorMessage:
              unexpectedCancellation
                ? "hermes_runtime_run_cancelled"
                : nextStatus === "failed"
                ? String(remote.raw.error || "hermes_runtime_failed")
                : null,
            checkpoint: {
              pool: target.pool.name,
              instance: target.instance.name,
              phase: remote.status,
            },
          });
          await this.concurrencyBudget
            .release(execution.id)
            .catch(() => undefined);
          if (unexpectedCancellation) orphaned += 1;
        } else {
          await this.ensureEventProjection(
            execution.id,
            target.instance,
            execution.remoteRunId,
          );
          await this.concurrencyBudget
            .renew(execution.id)
            .catch(() => undefined);
        }
        reconciled += 1;
      } catch (error) {
        if (error instanceof HermesAgentHttpError && error.status === 404) {
          await this.executionService.updateStatus(execution.id, "orphaned", {
            errorKind: "runtime",
            errorMessage: "hermes_runtime_run_not_found",
          });
          await this.concurrencyBudget
            .release(execution.id)
            .catch(() => undefined);
          orphaned += 1;
          continue;
        }
        failures.push(
          `execution:${execution.id}:${error instanceof Error ? error.message : "reconcile_failed"}`,
        );
      }
    }
    return {
      enabled: true,
      checked: activeExecutions.length,
      reconciled,
      orphaned,
      failures,
    };
  }

  private async projectEvents(
    executionId: number,
    instance: HermesPoolInstance,
    remoteRunId: string,
    eventProjectorOwner: string,
  ) {
    let terminal = false;
    let projectorLeaseLost = false;
    const abortController = new AbortController();
    const renewProjectorLease = async () => {
      const renewed = await this.concurrencyBudget
        .renewEventProjector(executionId, eventProjectorOwner)
        .catch(() => false);
      if (renewed) return true;
      projectorLeaseLost = true;
      abortController.abort();
      await this.executionService
        .recordEvent(executionId, {
          event: "runtime.sse_projector_lease_lost",
        })
        .catch(() => undefined);
      return false;
    };
    const renewInterval = setInterval(
      () => {
        void renewProjectorLease();
      },
      Math.max(5_000, Math.floor(this.projectorLeaseTtlMs() / 3)),
    );
    renewInterval.unref();

    try {
      await this.hermesAgentClient.streamEvents({
        instance,
        remoteRunId,
        signal: abortController.signal,
        onHeartbeat: async () => {
          await this.concurrencyBudget
            .renew(executionId)
            .catch(() => undefined);
          await renewProjectorLease();
        },
        onEvent: async (event) => {
          const compacted = compactEvent(event);
          await this.executionService.recordEvent(executionId, compacted);
          const eventName = String(event.event || "");
          const terminalStatus = terminalStatusForEvent(eventName);
          if (terminalStatus) {
            terminal = true;
            const current = await this.executionService.findById(executionId);
            const unexpectedCancellation = isUnexpectedRuntimeCancellation(
              terminalStatus,
              current?.status || "",
            );
            const nextStatus = unexpectedCancellation
              ? "orphaned"
              : terminalStatus;
            await this.executionService.updateStatus(
              executionId,
              nextStatus,
              {
                errorKind:
                  nextStatus === "failed" || unexpectedCancellation
                    ? "runtime"
                    : null,
                errorMessage:
                  unexpectedCancellation
                    ? "hermes_runtime_run_cancelled"
                    : nextStatus === "failed"
                    ? String(event.error || "hermes_runtime_failed")
                    : null,
                checkpoint: {
                  phase: eventName,
                  remote_run_id: remoteRunId,
                },
              },
            );
            await this.concurrencyBudget
              .release(executionId)
              .catch(() => undefined);
            return;
          }
          if (eventName === "approval.request") {
            terminal = true;
            await this.hermesAgentClient
              .stopRun(instance, remoteRunId)
              .catch(() => undefined);
            await this.executionService.updateStatus(executionId, "failed", {
              errorKind: "approval_required",
              errorMessage: "hermes_runtime_unexpected_approval_request",
            });
            await this.concurrencyBudget
              .release(executionId)
              .catch(() => undefined);
          }
        },
      });
    } catch (error) {
      if (terminal) return;
      if (projectorLeaseLost) return;
      await this.executionService
        .recordEvent(executionId, {
          event: "runtime.sse_disconnected",
          error: error instanceof Error ? error.message : "unknown",
        })
        .catch(() => undefined);
    } finally {
      clearInterval(renewInterval);
      await this.concurrencyBudget
        .releaseEventProjector(executionId, eventProjectorOwner)
        .catch(() => undefined);
      this.eventProjectionExecutionIds.delete(executionId);
    }
  }

  private async ensureEventProjection(
    executionId: number,
    instance: HermesPoolInstance,
    remoteRunId: string,
  ) {
    if (this.eventProjectionExecutionIds.has(executionId)) return false;
    this.eventProjectionExecutionIds.add(executionId);
    let projectorStarted = false;
    try {
      const eventProjectorOwner =
        await this.concurrencyBudget.acquireEventProjector(executionId);
      if (!eventProjectorOwner) return false;
      projectorStarted = true;
      void this.projectEvents(
        executionId,
        instance,
        remoteRunId,
        eventProjectorOwner,
      );
      return true;
    } catch (error) {
      await this.executionService
        .recordEvent(executionId, {
          event: "runtime.sse_projector_lease_unavailable",
          error: error instanceof Error ? error.message : "unknown",
        })
        .catch(() => undefined);
      return false;
    } finally {
      if (!projectorStarted) {
        this.eventProjectionExecutionIds.delete(executionId);
      }
    }
  }

  private resolveInstanceForExecution(execution: AgentExecutionRecord) {
    const checkpoint = parseCheckpoint(execution.checkpointJson);
    const poolName = typeof checkpoint.pool === "string" ? checkpoint.pool : "";
    const instanceName =
      typeof checkpoint.instance === "string" ? checkpoint.instance : "";
    if (!poolName || !instanceName) return null;
    return this.poolRegistry.findInstance(poolName, instanceName);
  }

  private assertEnabled() {
    if (!this.isEnabled())
      throw new ServiceUnavailableException("agent_runtime_disabled");
    if (
      !String(
        this.configService.getOrThrow<string>(
          "AGENT_RUNTIME_MCP_SERVICE_KEY",
        ) || "",
      ).trim()
    ) {
      throw new ServiceUnavailableException(
        "hermes_runtime_mcp_service_key_missing",
      );
    }
    if (
      !this.configService.getOrThrow<boolean>(
        "HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED",
      )
    ) {
      throw new ServiceUnavailableException(
        "hermes_runtime_per_run_mcp_auth_not_enabled",
      );
    }
    if (
      !this.configService.getOrThrow<boolean>(
        "HERMES_RUNTIME_PER_RUN_MODEL_GATEWAY_AUTH_ENABLED",
      )
    ) {
      throw new ServiceUnavailableException(
        "hermes_runtime_per_run_model_gateway_auth_not_enabled",
      );
    }
  }

  private projectorLeaseTtlMs() {
    return (
      this.configService.getOrThrow<number>(
        "AGENT_RUNTIME_LEASE_TTL_SECONDS",
      ) * 1_000
    );
  }
}
