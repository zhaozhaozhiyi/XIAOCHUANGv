import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { DatabaseService } from "../../../db/database.service";
import { dramas, taskLogs } from "../../../db/schema";
import { AgentRuntimeService } from "../../agent-runtime/agent-runtime.service";
import {
  BOUND_AGENT_TASK_START_MESSAGE,
  RUNTIME_POLICY_SKILL_REF,
} from "../../agent-runtime/runtime-task-start";
import {
  DramaStoryGraphService,
  STORY_GRAPH_DOMAIN,
} from "../../dramas/drama-story-graph.service";
import { BaseTaskDomainHandler } from "./base-task-domain.handler";
import type { TaskDomainHandler, TaskRecord } from "./task-domain-handler";
import { parseTaskPayload, sanitizePayload } from "./task-domain-utils";

const STORY_GRAPH_TOOL_PROFILE = "xiaochuang-drama-graph";
const STORY_GRAPH_MODEL_PROFILE = "xiaochuang-text-project";
const STORY_GRAPH_SKILL_REF = "drama_story_graph_build@1.0.0";

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

@Injectable()
export class DramaStoryGraphBuildTaskHandler
  extends BaseTaskDomainHandler
  implements TaskDomainHandler
{
  readonly domainTable = STORY_GRAPH_DOMAIN;

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(DramaStoryGraphService)
    private readonly dramaStoryGraphService: DramaStoryGraphService,
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

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const userId = Number(task.userId);
    const dramaId = Number(task.dramaId || task.domainId);
    const currentPayload = parseTaskPayload(task);
    const graphId = Number(payload.graph_id || currentPayload.graph_id);
    if (!Number.isInteger(userId) || userId <= 0)
      throw new Error("invalid_task_user");
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");
    if (!Number.isInteger(graphId) || graphId <= 0)
      throw new Error("invalid_task_graph");

    await this.assertOwnedDrama(dramaId, userId);
    const nextPayload: Record<string, unknown> = {
      ...currentPayload,
      ...payload,
      drama_id: dramaId,
    };

    await this.syncTaskUpdate(task.id, {
      status: "queued",
      progress: 0,
      providerTaskId: null,
      payloadJson: sanitizePayload(nextPayload) ?? task.payloadJson,
      resultSummaryJson: JSON.stringify({
        phase: "queued",
        drama_id: dramaId,
        graph_id: Number(nextPayload.graph_id) || null,
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
    await this.dramaStoryGraphService.retryBuildTask({
      taskId: task.id,
      graphId,
      dramaId,
      userId,
    });

    return { task_id: task.id, status: "queued" };
  }

  async cancel(task: TaskRecord, currentUserId: number) {
    const dramaId = Number(task.dramaId || task.domainId);
    const graphId = Number(parseTaskPayload(task).graph_id);
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");
    if (!Number.isInteger(graphId) || graphId <= 0)
      throw new Error("invalid_task_graph");
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
    await this.dramaStoryGraphService.cancelBuildTask({
      taskId: task.id,
      graphId,
      dramaId,
      userId: currentUserId,
    });
    await this.cancelTaskRecord(task, { drama_id: dramaId });
    return { canceled: true };
  }

  async refreshPresentation(task: TaskRecord) {
    if (
      ["completed", "failed", "canceled", "dead_letter"].includes(task.status)
    )
      return;
    if (this.runtimeExecutionId(task)) return;
    const payload = parseTaskPayload(task);
    const progress = Math.min(96, Math.max(5, Number(task.progress) || 5));
    await this.syncTaskUpdate(task.id, {
      progress,
      resultSummaryJson: JSON.stringify({
        phase: payload.phase || "building",
        drama_id: Number(payload.drama_id || task.dramaId),
        graph_id: Number(payload.graph_id) || null,
      }),
    });
  }

  async markCanceled(task: TaskRecord) {
    const payload = parseTaskPayload(task);
    const graphId = Number(payload.graph_id);
    const dramaId = Number(task.dramaId || task.domainId);
    const userId = Number(task.userId);
    if (
      Number.isInteger(graphId) &&
      graphId > 0 &&
      Number.isInteger(dramaId) &&
      dramaId > 0 &&
      Number.isInteger(userId) &&
      userId > 0
    ) {
      await this.dramaStoryGraphService.cancelBuildTask({
        taskId: task.id,
        graphId,
        dramaId,
        userId,
      });
    }
    await this.cancelTaskRecord(task, {
      drama_id: task.dramaId || task.domainId,
    });
    return true;
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const payload = parseTaskPayload(task);
    const graphId = Number(payload.graph_id);
    const dramaId = Number(task.dramaId || task.domainId);
    const userId = Number(task.userId);
    if (
      Number.isInteger(graphId) &&
      graphId > 0 &&
      Number.isInteger(dramaId) &&
      dramaId > 0 &&
      Number.isInteger(userId) &&
      userId > 0
    ) {
      await this.dramaStoryGraphService.failBuildTask(
        task.id,
        graphId,
        dramaId,
        userId,
        error,
      );
    }
    return true;
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task);
    const userId = Number(task.userId);
    const dramaId = Number(payload.drama_id || task.dramaId || task.domainId);
    const graphId = Number(payload.graph_id);

    if (!Number.isInteger(userId) || userId <= 0)
      throw new Error("invalid_task_user");
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");
    if (!Number.isInteger(graphId) || graphId <= 0)
      throw new Error("invalid_task_graph");

    if (this.agentRuntimeService.isEnabled()) {
      const runtime = await this.agentRuntimeService.run({
        taskId: task.id,
        userId,
        organizationId: task.organizationId ?? null,
        dramaId,
        toolProfile: STORY_GRAPH_TOOL_PROFILE,
        modelProfile: STORY_GRAPH_MODEL_PROFILE,
        skillRefs: [RUNTIME_POLICY_SKILL_REF, STORY_GRAPH_SKILL_REF],
        instruction: BOUND_AGENT_TASK_START_MESSAGE,
      });
      const queued = runtime.status === "queued";
      const phase = queued ? "agent_runtime_queued" : "agent_runtime_running";
      const message = queued
        ? "故事地图已排队，等待可用的 AI 执行资源"
        : "故事地图任务已启动";
      await this.syncTaskUpdate(task.id, {
        status: "running",
        progress: queued ? 0 : 5,
        providerTaskId: `agent_execution:${runtime.executionId}`,
        resultSummaryJson: JSON.stringify({
          phase,
          drama_id: dramaId,
          graph_id: graphId,
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
          graph_id: graphId,
        });
      }
      return "drama_story_graph_build_agent_runtime";
    }

    await this.dramaStoryGraphService.executeBuildTask({
      taskId: task.id,
      userId,
      dramaId,
      graphId,
    });
    return "drama_story_graph_build";
  }
}
