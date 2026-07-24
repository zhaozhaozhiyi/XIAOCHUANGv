import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";

import { DatabaseService } from "../../../db/database.service";
import { dramas, taskLogs } from "../../../db/schema";
import { AgentRuntimeService } from "../../agent-runtime/agent-runtime.service";
import {
  BOUND_AGENT_TASK_START_MESSAGE,
  RUNTIME_POLICY_SKILL_REF,
} from "../../agent-runtime/runtime-task-start";
import { DramaAiFirstService } from "../../dramas/drama-ai-first.service";
import { BaseTaskDomainHandler } from "./base-task-domain.handler";
import type { TaskDomainHandler, TaskRecord } from "./task-domain-handler";
import { parseTaskPayload, sanitizePayload } from "./task-domain-utils";

function toBoolean(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

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

const BLUEPRINT_TOOL_PROFILE = "xiaochuang-drama-plan";
const BLUEPRINT_MODEL_PROFILE = "xiaochuang-text-project";
const BLUEPRINT_SKILL_REF = "drama_episode_planning@1.0.0";

@Injectable()
export class DramaEpisodeBlueprintsTaskHandler
  extends BaseTaskDomainHandler
  implements TaskDomainHandler
{
  readonly domainTable = "drama_episode_blueprints";

  constructor(
    @Inject(DatabaseService) databaseService: DatabaseService,
    @Inject(DramaAiFirstService)
    private readonly dramaAiFirstService: DramaAiFirstService,
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
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId)))
      .limit(1);

    if (!drama) throw new NotFoundException("drama_not_found");
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const userId = Number(task.userId);
    const dramaId = Number(payload.drama_id || task.dramaId || task.domainId);
    if (!Number.isInteger(userId) || userId <= 0)
      throw new Error("invalid_task_user");
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");

    await this.assertOwnedDrama(dramaId, userId);

    const nextPayload: Record<string, unknown> = {
      ...parseTaskPayload(task),
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
        selected_brief_id: nextPayload.selected_brief_id ?? null,
        target_episode_count: nextPayload.target_episode_count ?? null,
        generated_episodes: 0,
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
    const dramaId = Number(task.dramaId || task.domainId);
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");
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

    await this.dramaAiFirstService.failEpisodeBlueprintsTask(
      task.id,
      new Error("canceled"),
    );
    return { canceled: true };
  }

  async refreshPresentation(task: TaskRecord) {
    if (
      ["completed", "failed", "canceled", "dead_letter"].includes(task.status)
    )
      return;
    if (this.runtimeExecutionId(task)) return;

    const payload = parseTaskPayload(task);
    await this.syncTaskUpdate(task.id, {
      resultSummaryJson: JSON.stringify({
        phase: task.status === "queued" ? "queued" : "blueprint_generate",
        drama_id: payload.drama_id || task.dramaId || task.domainId,
        selected_brief_id: payload.selected_brief_id ?? null,
        target_episode_count: payload.target_episode_count ?? null,
        generated_episodes: 0,
      }),
    });
  }

  async markCanceled(task: TaskRecord) {
    await this.dramaAiFirstService.failEpisodeBlueprintsTask(
      task.id,
      new Error("canceled"),
    );
    return true;
  }

  async markFailed(task: TaskRecord, error: unknown) {
    await this.dramaAiFirstService.failEpisodeBlueprintsTask(task.id, error);
    return true;
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task);
    const userId = Number(task.userId);
    const dramaId = Number(payload.drama_id || task.dramaId || task.domainId);

    if (!Number.isInteger(userId) || userId <= 0)
      throw new Error("invalid_task_user");
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");

    if (this.agentRuntimeService.isEnabled()) {
      const runtime = await this.agentRuntimeService.run({
        taskId: task.id,
        userId,
        organizationId: task.organizationId ?? null,
        dramaId,
        toolProfile: BLUEPRINT_TOOL_PROFILE,
        modelProfile: BLUEPRINT_MODEL_PROFILE,
        skillRefs: [RUNTIME_POLICY_SKILL_REF, BLUEPRINT_SKILL_REF],
        instruction: BOUND_AGENT_TASK_START_MESSAGE,
      });
      const queued = runtime.status === "queued";
      const phase = queued ? "agent_runtime_queued" : "agent_runtime_running";
      const message = queued
        ? "分集规划已排队，等待可用的 AI 执行资源"
        : "分集规划任务已启动";

      await this.syncTaskUpdate(task.id, {
        status: "running",
        progress: queued ? 0 : 5,
        providerTaskId: `agent_execution:${runtime.executionId}`,
        resultSummaryJson: JSON.stringify({
          phase,
          drama_id: dramaId,
          selected_brief_id: payload.selected_brief_id ?? null,
          target_episode_count: payload.target_episode_count ?? null,
          generated_episodes: 0,
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
        });
      }
      return "drama_episode_blueprints_agent_runtime";
    }

    await this.dramaAiFirstService.executeEpisodeBlueprintsTask({
      taskId: task.id,
      userId,
      dramaId,
      replaceWithoutScript: toBoolean(payload.replace_without_script),
    });
    return "drama_episode_blueprints";
  }
}
