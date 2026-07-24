import { createHash } from "node:crypto";

import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, isNull } from "drizzle-orm";

import { DatabaseService } from "../../db/database.service";
import { dramas, episodes, tasks } from "../../db/schema";
import { TaskQueueService } from "../queue/task-queue.service";
import { StoryboardSetsService } from "../storyboards/storyboard-sets.service";
import { DramaStoryGraphService } from "./drama-story-graph.service";

export const STORYBOARD_BREAKDOWN_DOMAIN = "storyboard_breakdowns";
export const STORYBOARD_BREAKDOWN_TASK_TYPE = "storyboard_breakdown";

function compactText(value: string, max = 120) {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max
    ? normalized
    : `${normalized.slice(0, max - 1)}…`;
}

function runtimeEnabled(configService: ConfigService) {
  return (
    configService.get<string>("AGENT_RUNTIME_PROVIDER") === "hermes" &&
    configService.get<boolean>("HERMES_RUNTIME_PER_RUN_MCP_AUTH_ENABLED") ===
      true
  );
}

@Injectable()
export class DramaStoryboardBreakdownService {
  constructor(
    @Inject(DatabaseService)
    private readonly databaseService: DatabaseService,
    @Inject(ConfigService)
    private readonly configService: ConfigService,
    @Inject(TaskQueueService)
    private readonly taskQueueService: TaskQueueService,
    @Inject(DramaStoryGraphService)
    private readonly dramaStoryGraphService: DramaStoryGraphService,
    @Inject(StoryboardSetsService)
    private readonly storyboardSetsService: StoryboardSetsService,
  ) {}

  async requestBreakdown(input: {
    userId: number;
    dramaId: number;
    episodeId: number;
  }) {
    if (!runtimeEnabled(this.configService)) {
      return { runtime_enabled: false };
    }

    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, input.episodeId),
          eq(episodes.userId, input.userId),
          eq(episodes.dramaId, input.dramaId),
          isNull(episodes.deletedAt),
        ),
      )
      .limit(1);
    if (!episode) throw new NotFoundException("episode_not_found");
    const script = String(episode.scriptContent || episode.content || "").trim();
    if (!script) throw new ConflictException("storyboard_episode_script_required");

    const [drama, graphSummary, baseline] = await Promise.all([
      this.databaseService.db
        .select({ id: dramas.id, title: dramas.title })
        .from(dramas)
        .where(
          and(
            eq(dramas.id, input.dramaId),
            eq(dramas.userId, input.userId),
            isNull(dramas.deletedAt),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      this.dramaStoryGraphService.getStoryGraphSummary(
        input.dramaId,
        input.userId,
      ),
      this.storyboardSetsService.getEpisodeBaseline(input),
    ]);
    if (!drama) throw new NotFoundException("drama_not_found");
    if (
      !graphSummary.graph ||
      graphSummary.graph.status !== "ready" ||
      graphSummary.is_stale
    ) {
      throw new ConflictException("story_graph_required");
    }

    const episodeScriptHash = createHash("sha256")
      .update(script, "utf8")
      .digest("hex");
    const payload = {
      operation: "storyboard_breakdown",
      drama_id: input.dramaId,
      episode_id: episode.id,
      episode_script_hash: episodeScriptHash,
      story_graph_id: graphSummary.graph.id,
      story_graph_script_hash: graphSummary.graph.script_hash,
      base_storyboard_revision: baseline.revision,
      base_storyboard_content_hash: baseline.contentHash,
    };
    const summary = {
      phase: "queued",
      drama_id: input.dramaId,
      episode_id: episode.id,
      episode_number: episode.episodeNumber,
      episode_script_hash: episodeScriptHash,
      graph_id: graphSummary.graph.id,
      graph_script_hash: graphSummary.graph.script_hash,
      base_storyboard_revision: baseline.revision,
      base_storyboard_content_hash: baseline.contentHash,
      storyboard_count: baseline.storyboardCount,
    };
    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, STORYBOARD_BREAKDOWN_DOMAIN),
          eq(tasks.domainId, episode.id),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    if (existing && ["queued", "running"].includes(existing.status)) {
      return {
        runtime_enabled: true,
        task_id: existing.id,
        status: existing.status,
        episode_id: episode.id,
      };
    }
    const timestamp = new Date();
    const taskValues = {
      userId: input.userId,
      type: STORYBOARD_BREAKDOWN_TASK_TYPE,
      status: "queued",
      title: compactText(`AI 分镜拆解：${drama.title}·第 ${episode.episodeNumber} 集`),
      progress: 0,
      sourceType: "drama_workbench",
      dramaId: input.dramaId,
      episodeId: episode.id,
      storyboardId: null,
      aiConfigId: null,
      providerTaskId: null,
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
      payloadJson: JSON.stringify(payload),
      resultSummaryJson: JSON.stringify(summary),
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      startedAt: null,
      completedAt: null,
      updatedAt: timestamp,
    };
    const task = existing
      ? (
          await this.databaseService.db
            .update(tasks)
            .set({
              ...taskValues,
              attemptCount:
                existing.status === "failed" ||
                existing.status === "dead_letter"
                  ? 0
                  : existing.attemptCount,
            })
            .where(eq(tasks.id, existing.id))
            .returning()
        )[0]
      : (
          await this.databaseService.db
            .insert(tasks)
            .values({
              ...taskValues,
              domainTable: STORYBOARD_BREAKDOWN_DOMAIN,
              domainId: episode.id,
              createdAt: timestamp,
            })
            .returning()
        )[0];
    if (!task) throw new Error("storyboard_breakdown_task_create_failed");

    await this.taskQueueService.enqueueTask(task.id, {
      replaceExisting: Boolean(existing),
    });
    return {
      runtime_enabled: true,
      task_id: task.id,
      status: task.status,
      episode_id: episode.id,
    };
  }
}
