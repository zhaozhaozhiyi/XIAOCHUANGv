import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { DatabaseService } from "../../../db/database.service";
import { dramas, taskLogs } from "../../../db/schema";
import { AgentRuntimeService } from "../../agent-runtime/agent-runtime.service";
import {
  BOUND_AGENT_TASK_START_MESSAGE,
  RUNTIME_POLICY_SKILL_REF,
} from "../../agent-runtime/runtime-task-start";
import { STORYBOARD_BREAKDOWN_DOMAIN } from "../../dramas/drama-storyboard-breakdown.service";
import { BaseTaskDomainHandler } from "./base-task-domain.handler";
import type { TaskDomainHandler, TaskRecord } from "./task-domain-handler";
import { parseTaskPayload, sanitizePayload } from "./task-domain-utils";

const STORYBOARD_TOOL_PROFILE = "xiaochuang-drama-storyboard";
const STORYBOARD_MODEL_PROFILE = "xiaochuang-text-project";
const STORYBOARD_SKILL_REF = "drama_storyboard_planning@1.0.0";

function parseSummary(value: string | null | undefined) {
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

function positiveInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid_task_${label}`);
  }
  return parsed;
}

@Injectable()
export class StoryboardBreakdownTaskHandler
  extends BaseTaskDomainHandler
  implements TaskDomainHandler
{
  readonly domainTable = STORYBOARD_BREAKDOWN_DOMAIN;

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(AgentRuntimeService)
    private readonly agentRuntimeService: AgentRuntimeService,
  ) {
    super(databaseService);
  }

  private runtimeExecutionId(task: TaskRecord) {
    const executionId = Number(
      parseSummary(task.resultSummaryJson).agent_execution_id,
    );
    return Number.isInteger(executionId) && executionId > 0
      ? executionId
      : null;
  }

  private async assertOwnedDrama(dramaId: number, userId: number) {
    const [drama] = await this.databaseService.db
      .select({ id: dramas.id })
      .from(dramas)
      .where(
        and(
          eq(dramas.id, dramaId),
          eq(dramas.userId, userId),
          isNull(dramas.deletedAt),
        ),
      )
      .limit(1);
    if (!drama) throw new NotFoundException("drama_not_found");
  }

  private async appendRuntimeLog(
    task: TaskRecord,
    message: string,
    metadata: Record<string, unknown>,
    level = "info",
  ) {
    await this.databaseService.db.insert(taskLogs).values({
      taskId: task.id,
      userId: task.userId ?? null,
      organizationId: task.organizationId ?? null,
      level,
      message,
      metadataJson: JSON.stringify(metadata),
      createdAt: this.now(),
    });
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const userId = positiveInteger(task.userId, "user");
    const dramaId = positiveInteger(task.dramaId, "drama");
    await this.assertOwnedDrama(dramaId, userId);
    const currentPayload = parseTaskPayload(task);
    const nextPayload = {
      ...currentPayload,
      ...payload,
      drama_id: dramaId,
      episode_id: positiveInteger(
        payload.episode_id ?? currentPayload.episode_id,
        "episode",
      ),
    };
    await this.syncTaskUpdate(task.id, {
      status: "queued",
      progress: 0,
      providerTaskId: null,
      payloadJson: sanitizePayload(nextPayload) ?? task.payloadJson,
      resultSummaryJson: JSON.stringify({
        phase: "queued",
        drama_id: dramaId,
        episode_id: nextPayload.episode_id,
      }),
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    });
    return { task_id: task.id, status: "queued" };
  }

  async cancel(task: TaskRecord, currentUserId: number) {
    const dramaId = positiveInteger(task.dramaId, "drama");
    await this.assertOwnedDrama(dramaId, currentUserId);
    const executionId = this.runtimeExecutionId(task);
    if (executionId && this.agentRuntimeService.isEnabled()) {
      const stopped = await this.agentRuntimeService
        .stop(executionId, currentUserId)
        .catch(() => null);
      await this.appendRuntimeLog(
        task,
        stopped
          ? "已请求取消 AI 生产任务"
          : "取消任务时未能确认 AI 生产任务状态",
        {
          runtime: "hermes",
          execution_id: executionId,
          runtime_status: stopped?.status ?? null,
        },
        stopped ? "info" : "warn",
      );
    }
    await this.cancelTaskRecord(task, {
      drama_id: dramaId,
      episode_id: task.episodeId,
    });
    return { canceled: true };
  }

  async refreshPresentation(task: TaskRecord) {
    if (
      ["completed", "failed", "canceled", "dead_letter"].includes(task.status)
    )
      return;
    // Runtime-driven tasks project their own verified business progress through
    // the MCP endpoint. There is no local provider status to infer here.
  }

  async markCanceled(task: TaskRecord) {
    await this.cancelTaskRecord(task, {
      drama_id: task.dramaId,
      episode_id: task.episodeId,
    });
    return true;
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const message =
      error instanceof Error ? error.message : "storyboard_breakdown_failed";
    await this.syncTaskUpdate(task.id, {
      status: "failed",
      progress: task.progress ?? 0,
      errorKind: "agent",
      errorMessage: message,
      errorDetailsJson: JSON.stringify({
        error_kind: "agent",
        raw_error: message,
      }),
      completedAt: this.now(),
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    });
    return true;
  }

  async execute(task: TaskRecord) {
    if (!this.agentRuntimeService.isEnabled()) {
      throw new Error("agent_runtime_disabled_for_storyboard_breakdown");
    }
    const payload = parseTaskPayload(task);
    const userId = positiveInteger(task.userId, "user");
    const dramaId = positiveInteger(payload.drama_id ?? task.dramaId, "drama");
    const episodeId = positiveInteger(
      payload.episode_id ?? task.episodeId ?? task.domainId,
      "episode",
    );
    positiveInteger(payload.story_graph_id, "story_graph");
    const runtime = await this.agentRuntimeService.run({
      taskId: task.id,
      userId,
      organizationId: task.organizationId ?? null,
      dramaId,
      toolProfile: STORYBOARD_TOOL_PROFILE,
      modelProfile: STORYBOARD_MODEL_PROFILE,
      skillRefs: [RUNTIME_POLICY_SKILL_REF, STORYBOARD_SKILL_REF],
      instruction: BOUND_AGENT_TASK_START_MESSAGE,
    });
    const queued = runtime.status === "queued";
    const phase = queued ? "agent_runtime_queued" : "agent_runtime_running";
    const message = queued
      ? "本集分镜已排队，等待可用的 AI 执行资源"
      : "正在拆解本集分镜";
    await this.syncTaskUpdate(task.id, {
      status: "running",
      progress: queued ? 0 : 5,
      providerTaskId: `agent_execution:${runtime.executionId}`,
      resultSummaryJson: JSON.stringify({
        phase,
        drama_id: dramaId,
        episode_id: episodeId,
        runtime: "hermes",
        runtime_status: runtime.status,
        agent_execution_id: runtime.executionId,
        remote_run_id: runtime.remoteRunId,
        pool: runtime.pool,
        instance: runtime.instance,
        reused: runtime.reused,
      }),
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: task.startedAt ?? this.now(),
      completedAt: null,
    });
    if (!runtime.reused) {
      await this.appendRuntimeLog(task, message, {
        runtime: "hermes",
        runtime_status: runtime.status,
        execution_id: runtime.executionId,
        remote_run_id: runtime.remoteRunId,
        pool: runtime.pool,
        instance: runtime.instance,
        reused: runtime.reused,
        episode_id: episodeId,
      });
    }
    return "storyboard_breakdown_agent_runtime";
  }
}
