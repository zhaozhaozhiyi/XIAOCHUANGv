import { createHash } from "node:crypto";

import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";

import { DatabaseService } from "../../../db/database.service";
import {
  dramaSourceChunks,
  dramaSources,
  taskLogs,
  tasks,
} from "../../../db/schema";
import { AgentRuntimeService } from "../../agent-runtime/agent-runtime.service";
import {
  BOUND_AGENT_TASK_START_MESSAGE,
  RUNTIME_POLICY_SKILL_REF,
} from "../../agent-runtime/runtime-task-start";
import { DramaAiFirstService } from "../../dramas/drama-ai-first.service";
import { BaseTaskDomainHandler } from "./base-task-domain.handler";
import type { TaskDomainHandler, TaskRecord } from "./task-domain-handler";
import {
  inferErrorKind,
  parseTaskPayload,
  sanitizePayload,
  trimText,
} from "./task-domain-utils";

const SOURCE_ANALYSIS_TOOL_PROFILE = "xiaochuang-drama-source";
const SOURCE_ANALYSIS_MODEL_PROFILE = "xiaochuang-text-project";
const SOURCE_ANALYSIS_SKILL_REF = "drama_source_understanding@1.0.0";

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

function hashText(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

@Injectable()
export class DramaSourceAnalysisTaskHandler
  extends BaseTaskDomainHandler
  implements TaskDomainHandler
{
  readonly domainTable = "drama_sources";
  readonly automaticRetrySafe = true;

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

  private async ensureRuntimeReadableSource(input: {
    userId: number;
    dramaId: number;
    sourceId: number;
  }) {
    const existingChunks = await this.databaseService.db
      .select({ id: dramaSourceChunks.id })
      .from(dramaSourceChunks)
      .where(
        and(
          eq(dramaSourceChunks.userId, input.userId),
          eq(dramaSourceChunks.dramaId, input.dramaId),
          eq(dramaSourceChunks.sourceId, input.sourceId),
        ),
      )
      .limit(1);
    if (existingChunks.length) return;

    const [source] = await this.databaseService.db
      .select()
      .from(dramaSources)
      .where(
        and(
          eq(dramaSources.id, input.sourceId),
          eq(dramaSources.userId, input.userId),
          eq(dramaSources.dramaId, input.dramaId),
          isNull(dramaSources.deletedAt),
        ),
      )
      .limit(1);
    if (!source) throw new NotFoundException("source_not_found");

    const now = this.now();
    await this.databaseService.db
      .insert(dramaSourceChunks)
      .values({
        userId: input.userId,
        dramaId: input.dramaId,
        sourceId: input.sourceId,
        chunkNo: 1,
        chapterNo: 1,
        title: source.title || "全文",
        contentStart: 0,
        contentEnd: source.content.length,
        contentHash: hashText(source.content),
        estimatedTokens: source.estimatedTokens ?? 0,
        sourceTrace: JSON.stringify([
          {
            source_id: input.sourceId,
            content_start: 0,
            content_end: source.content.length,
          },
        ]),
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing({
        target: [dramaSourceChunks.sourceId, dramaSourceChunks.chunkNo],
      });
  }

  async retry(task: TaskRecord, payload: Record<string, unknown>) {
    const [source] = await this.databaseService.db
      .select()
      .from(dramaSources)
      .where(
        and(
          eq(dramaSources.id, task.domainId),
          eq(dramaSources.userId, task.userId ?? 0),
        ),
      );

    if (!source) throw new NotFoundException("source_not_found");

    await this.syncTaskUpdate(task.id, {
      status: "queued",
      progress: 0,
      providerTaskId: null,
      payloadJson: sanitizePayload(payload) ?? task.payloadJson,
      resultSummaryJson: JSON.stringify({
        phase: "queued",
        source_id: source.id,
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
      .update(dramaSourceChunks)
      .set({ status: "pending", failureReason: null, updatedAt: this.now() })
      .where(
        and(
          eq(dramaSourceChunks.sourceId, source.id),
          eq(dramaSourceChunks.status, "failed"),
        ),
      );

    return { task_id: task.id, status: "queued" };
  }

  async cancel(task: TaskRecord, currentUserId: number) {
    const [source] = await this.databaseService.db
      .select()
      .from(dramaSources)
      .where(
        and(
          eq(dramaSources.id, task.domainId),
          eq(dramaSources.userId, currentUserId),
        ),
      );

    if (!source) throw new NotFoundException("source_not_found");

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

    await this.databaseService.db
      .update(dramaSourceChunks)
      .set({
        status: "pending",
        failureReason: "Canceled by user",
        updatedAt: this.now(),
      })
      .where(
        and(
          eq(dramaSourceChunks.sourceId, source.id),
          eq(dramaSourceChunks.status, "running"),
        ),
      );

    await this.cancelTaskRecord(task, { source_id: source.id });
    return { canceled: true };
  }

  async refreshPresentation(task: TaskRecord) {
    const chunks = await this.databaseService.db
      .select({ status: dramaSourceChunks.status })
      .from(dramaSourceChunks)
      .where(eq(dramaSourceChunks.sourceId, task.domainId));

    if (
      !chunks.length ||
      ["completed", "failed", "canceled", "dead_letter"].includes(task.status)
    )
      return;

    const readyChunks = chunks.filter(
      (chunk) => chunk.status === "ready",
    ).length;
    const failedChunks = chunks.filter(
      (chunk) => chunk.status === "failed",
    ).length;
    const summary = parseSummary(task.resultSummaryJson);
    const runtimePhase = String(summary.phase || "");
    const hasRuntimeProjection = Boolean(this.runtimeExecutionId(task));
    const preserveRuntimePhase =
      hasRuntimeProjection && readyChunks === 0 && Boolean(runtimePhase);
    const progress = preserveRuntimePhase
      ? (task.progress ?? 0)
      : Math.min(82, 5 + Math.round((readyChunks / chunks.length) * 72));
    await this.syncTaskUpdate(task.id, {
      progress,
      resultSummaryJson: JSON.stringify({
        ...summary,
        phase: failedChunks
          ? "chunk_failed"
          : preserveRuntimePhase
            ? runtimePhase
            : "chunk_analysis",
        source_id: task.domainId,
        total_chunks: chunks.length,
        ready_chunks: readyChunks,
        failed_chunks: failedChunks,
      }),
      errorKind: failedChunks ? "provider" : null,
      errorMessage: failedChunks ? `${failedChunks} 个分块分析失败` : null,
    });
  }

  async markCanceled(task: TaskRecord) {
    await this.cancelTaskRecord(task, { source_id: task.domainId });
    return true;
  }

  async markFailed(task: TaskRecord, error: unknown) {
    const message =
      error instanceof Error ? error.message : "source analysis failed";
    await this.dramaAiFirstService.failSourceAnalysisTask(task.id, error);
    await this.syncTaskUpdate(task.id, {
      errorKind: inferErrorKind(message),
      errorMessage: trimText(message, 500),
      errorDetailsJson: JSON.stringify({
        error_kind: inferErrorKind(message),
        source_id: task.domainId,
        raw_error: message,
      }),
    });
    return true;
  }

  async execute(task: TaskRecord) {
    const payload = parseTaskPayload(task);
    const sourceId = Number(payload.source_id || task.domainId);
    const dramaId = Number(payload.drama_id || task.dramaId);
    const userId = Number(task.userId);

    if (!Number.isInteger(userId) || userId <= 0)
      throw new Error("invalid_task_user");
    if (!Number.isInteger(dramaId) || dramaId <= 0)
      throw new Error("invalid_task_drama");
    if (!Number.isInteger(sourceId) || sourceId <= 0)
      throw new Error("invalid_task_source");

    if (this.agentRuntimeService.isEnabled()) {
      await this.ensureRuntimeReadableSource({ userId, dramaId, sourceId });
      const runtime = await this.agentRuntimeService.run({
        taskId: task.id,
        userId,
        organizationId: task.organizationId ?? null,
        dramaId,
        toolProfile: SOURCE_ANALYSIS_TOOL_PROFILE,
        modelProfile: SOURCE_ANALYSIS_MODEL_PROFILE,
        skillRefs: [RUNTIME_POLICY_SKILL_REF, SOURCE_ANALYSIS_SKILL_REF],
        instruction: BOUND_AGENT_TASK_START_MESSAGE,
      });
      const queued = runtime.status === "queued";
      const phase = queued ? "agent_runtime_queued" : "agent_runtime_running";
      const message = queued
        ? "源稿理解已排队，等待可用的 AI 执行资源"
        : "源稿理解任务已启动";

      await this.syncTaskUpdate(task.id, {
        status: "running",
        progress: queued ? 0 : 5,
        providerTaskId: `agent_execution:${runtime.executionId}`,
        resultSummaryJson: JSON.stringify({
          phase,
          source_id: sourceId,
          drama_id: dramaId,
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
      return "drama_source_analysis_agent_runtime";
    }

    await this.dramaAiFirstService.executeSourceAnalysisTask({
      taskId: task.id,
      userId,
      dramaId,
      sourceId,
    });
    return "drama_source_analysis";
  }
}
