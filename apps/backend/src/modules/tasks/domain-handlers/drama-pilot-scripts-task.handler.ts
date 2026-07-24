import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, inArray, isNull, or } from "drizzle-orm";

import { DatabaseService } from "../../../db/database.service";
import { dramas, episodes, taskLogs } from "../../../db/schema";
import { AgentRuntimeService } from "../../agent-runtime/agent-runtime.service";
import {
  BOUND_AGENT_TASK_START_MESSAGE,
  RUNTIME_POLICY_SKILL_REF,
} from "../../agent-runtime/runtime-task-start";
import { DramaAiFirstService } from "../../dramas/drama-ai-first.service";
import { BaseTaskDomainHandler } from "./base-task-domain.handler";
import type { TaskDomainHandler, TaskRecord } from "./task-domain-handler";
import { parseTaskPayload, sanitizePayload } from "./task-domain-utils";

const PILOT_SCRIPT_TOOL_PROFILE = "xiaochuang-drama-script";
const PILOT_SCRIPT_MODEL_PROFILE = "xiaochuang-text-project";
const PILOT_SCRIPT_SKILL_REF = "drama_episode_script_writing@1.0.0";

function parseEpisodeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
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

function positiveLimitOrDefault(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;
  return Math.max(1, fallback);
}

@Injectable()
export class DramaPilotScriptsTaskHandler
  extends BaseTaskDomainHandler
  implements TaskDomainHandler
{
  readonly domainTable = "drama_pilot_scripts";

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

  private episodeFilter(dramaId: number, userId: number, episodeIds: number[]) {
    return episodeIds.length
      ? and(
          eq(episodes.dramaId, dramaId),
          eq(episodes.userId, userId),
          inArray(episodes.id, episodeIds),
        )
      : and(eq(episodes.dramaId, dramaId), eq(episodes.userId, userId));
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const userId = Number(task.userId);
    const dramaId = Number(task.dramaId || task.domainId);
    if (!Number.isInteger(userId) || userId <= 0)
      throw new Error("invalid_task_user");
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");

    await this.assertOwnedDrama(dramaId, userId);

    const currentPayload = parseTaskPayload(task);
    const nextPayload: Record<string, unknown> = {
      ...currentPayload,
      ...payload,
      drama_id: dramaId,
    };
    const episodeIds = parseEpisodeIds(nextPayload.episode_ids);
    await this.syncTaskUpdate(task.id, {
      status: "queued",
      progress: 0,
      providerTaskId: null,
      payloadJson: sanitizePayload(nextPayload) ?? task.payloadJson,
      resultSummaryJson: JSON.stringify({
        phase: "queued",
        drama_id: dramaId,
        episode_ids: episodeIds,
        total_episodes: episodeIds.length || null,
        completed_episodes: 0,
        failed_episodes: 0,
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

    await this.databaseService.db
      .update(episodes)
      .set({
        status: "script_generating",
        scriptAiRunId: null,
        scriptRemoteRunId: null,
        failureReason: null,
        updatedAt: this.now(),
      })
      .where(
        and(
          this.episodeFilter(dramaId, userId, episodeIds),
          or(isNull(episodes.scriptContent), eq(episodes.scriptContent, "")),
        ),
      );

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

    const payload = parseTaskPayload(task);
    const episodeIds = parseEpisodeIds(payload.episode_ids);
    await this.databaseService.db
      .update(episodes)
      .set({
        status: "blueprint",
        failureReason: "Canceled by user",
        updatedAt: this.now(),
      })
      .where(
        and(
          this.episodeFilter(dramaId, currentUserId, episodeIds),
          eq(episodes.status, "script_generating"),
        ),
      );

    await this.cancelTaskRecord(task, {
      drama_id: dramaId,
      episode_ids: episodeIds,
    });
    return { canceled: true };
  }

  async refreshPresentation(task: TaskRecord) {
    if (
      ["completed", "failed", "canceled", "dead_letter"].includes(task.status)
    )
      return;
    if (this.runtimeExecutionId(task)) return;

    const payload = parseTaskPayload(task);
    const userId = Number(task.userId);
    const dramaId = Number(task.dramaId || task.domainId);
    const episodeIds = parseEpisodeIds(payload.episode_ids);
    if (
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !Number.isInteger(dramaId) ||
      dramaId <= 0
    )
      return;

    const rows = await this.databaseService.db
      .select({ status: episodes.status })
      .from(episodes)
      .where(this.episodeFilter(dramaId, userId, episodeIds));

    const total = episodeIds.length || rows.length;
    if (!total) return;

    const completed = rows.filter(
      (row) => row.status === "script_ready",
    ).length;
    const failed = rows.filter((row) => row.status === "failed").length;
    const progress = Math.min(
      96,
      8 + Math.round(((completed + failed) / total) * 84),
    );

    await this.syncTaskUpdate(task.id, {
      progress,
      resultSummaryJson: JSON.stringify({
        phase: failed ? "episode_failed" : "episode_script",
        drama_id: dramaId,
        total_episodes: total,
        completed_episodes: completed,
        failed_episodes: failed,
        episode_ids: episodeIds,
      }),
    });
  }

  async markCanceled(task: TaskRecord) {
    const userId = Number(task.userId);
    const dramaId = Number(task.dramaId || task.domainId);
    const episodeIds = parseEpisodeIds(parseTaskPayload(task).episode_ids);

    if (
      Number.isInteger(userId) &&
      userId > 0 &&
      Number.isInteger(dramaId) &&
      dramaId > 0
    ) {
      await this.databaseService.db
        .update(episodes)
        .set({
          status: "blueprint",
          failureReason: "Canceled by user",
          updatedAt: this.now(),
        })
        .where(
          and(
            this.episodeFilter(dramaId, userId, episodeIds),
            eq(episodes.status, "script_generating"),
          ),
        );
    }
    await this.cancelTaskRecord(task, {
      drama_id: dramaId,
      episode_ids: episodeIds,
    });
    return true;
  }

  async markFailed(task: TaskRecord, error: unknown) {
    await this.dramaAiFirstService.failPilotScriptsTask(task.id, error);
    return true;
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task);
    const userId = Number(task.userId);
    const dramaId = Number(payload.drama_id || task.dramaId || task.domainId);
    const episodeIds = parseEpisodeIds(payload.episode_ids);
    const limit = positiveLimitOrDefault(payload.limit, episodeIds.length || 1);

    if (!Number.isInteger(userId) || userId <= 0)
      throw new Error("invalid_task_user");
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");
    if (!episodeIds.length) throw new Error("invalid_task_episodes");

    if (this.agentRuntimeService.isEnabled()) {
      const runtime = await this.agentRuntimeService.run({
        taskId: task.id,
        userId,
        organizationId: task.organizationId ?? null,
        dramaId,
        toolProfile: PILOT_SCRIPT_TOOL_PROFILE,
        modelProfile: PILOT_SCRIPT_MODEL_PROFILE,
        skillRefs: [RUNTIME_POLICY_SKILL_REF, PILOT_SCRIPT_SKILL_REF],
        instruction: BOUND_AGENT_TASK_START_MESSAGE,
      });
      const queued = runtime.status === "queued";
      const phase = queued ? "agent_runtime_queued" : "agent_runtime_running";
      const message = queued
        ? "剧本正文已排队，等待可用的 AI 执行资源"
        : "剧本正文任务已启动";

      await this.syncTaskUpdate(task.id, {
        status: "running",
        progress: queued ? 0 : 5,
        providerTaskId: `agent_execution:${runtime.executionId}`,
        resultSummaryJson: JSON.stringify({
          phase,
          drama_id: dramaId,
          episode_ids: episodeIds,
          total_episodes: episodeIds.length,
          completed_episodes: 0,
          failed_episodes: 0,
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
          episode_ids: episodeIds,
        });
      }
      return "drama_pilot_scripts_agent_runtime";
    }

    await this.dramaAiFirstService.executePilotScriptsTask({
      taskId: task.id,
      userId,
      dramaId,
      episodeIds,
      limit,
    });
    return "drama_pilot_scripts";
  }
}
