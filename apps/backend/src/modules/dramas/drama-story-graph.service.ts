import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";

import { DatabaseService } from "../../db/database.service";
import {
  characters,
  dramaGraphEntities,
  dramaGraphEvents,
  dramaGraphRelations,
  dramaEntityAliases,
  dramaStoryGraphs,
  dramas,
  episodeCharacters,
  episodeScenes,
  episodes,
  scenes,
  tasks,
} from "../../db/schema";
import { TaskQueueService } from "../queue/task-queue.service";
import { parseDramaMetadata } from "./drama-metadata";
import { DramaStoryGraphIndexService } from "./drama-story-graph-index.service";
import { mergeWritingKnowledgeCards } from "./drama-story-graph-writing-preseed";

export const STORY_GRAPH_DOMAIN = "drama_story_graphs";
export const STORY_GRAPH_TASK_TYPE = "story_graph_build";

export type StoryGraphEntityDraft = {
  entityType: "character" | "scene" | "prop";
  canonicalName: string;
  displayName?: string;
  role?: string;
  description?: string;
  importance?: number;
  firstSeen?: Record<string, unknown>;
  sourceTrace?: Array<Record<string, unknown>>;
  aliases?: string[];
};

export type StoryGraphRelationDraft = {
  subjectName: string;
  objectName: string;
  relationType: string;
  predicate: string;
  description?: string;
  evidence?: Array<Record<string, unknown>>;
};

export type StoryGraphEventDraft = {
  episodeId?: number;
  episodeNumber: number;
  title: string;
  summary?: string;
  scriptSpanStart?: number;
  scriptSpanEnd?: number;
  involvedNames?: string[];
  emotionalTone?: string;
};

export type StoryGraphDraft = {
  entities: StoryGraphEntityDraft[];
  relations: StoryGraphRelationDraft[];
  events: StoryGraphEventDraft[];
};

function compactText(value: string, max = 240) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [] as unknown[];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function episodeNumbersFromTrace(value: string | null | undefined) {
  return Array.from(
    new Set(
      parseJsonArray(value)
        .map((trace) => toRecord(trace).episode_number)
        .map((episodeNumber) => Number(episodeNumber))
        .filter(
          (episodeNumber) =>
            Number.isInteger(episodeNumber) && episodeNumber > 0,
        ),
    ),
  );
}

function mergeSourceTraces(
  current: Array<Record<string, unknown>> | undefined,
  next: Array<Record<string, unknown>> | undefined,
) {
  const seen = new Set<string>();
  return [...(current || []), ...(next || [])].filter((trace) => {
    const key = JSON.stringify(trace);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseJsonObject(value: string | null | undefined) {
  if (!value) return {};
  try {
    return toRecord(JSON.parse(value) as unknown);
  } catch {
    return {};
  }
}

function toPositiveInt(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function resolveActiveTargetEpisodeCount(
  drama: typeof dramas.$inferSelect,
  metadata: Record<string, unknown>,
) {
  const aiFirst = toRecord(metadata.ai_first);
  const config = toRecord(aiFirst.adaptation_config);
  return (
    toPositiveInt(config.target_episode_count) ||
    toPositiveInt(drama.totalEpisodes) ||
    0
  );
}

function normalizeName(value: string) {
  return value.replace(/\s+/g, "").trim();
}

function computeScriptHash(
  scriptEpisodes: Array<{ episodeNumber: number; scriptContent: string }>,
) {
  const payload = scriptEpisodes
    .slice()
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((episode) => `${episode.episodeNumber}:${episode.scriptContent}`)
    .join("\n---\n");
  return createHash("sha256").update(payload).digest("hex");
}

function extractScriptMeta(script: string) {
  const sceneMatch = script.match(
    /(?:^|\n)\s*(?:【\s*)?场景[：:]\s*([^\n】\]]+)/,
  );
  const castMatch = script.match(
    /(?:^|\n)\s*(?:【\s*)?出场[：:]\s*([^\n】\]]+)/,
  );
  const titleMatch = script.match(/^#\s*(.+)$/m);
  const scene = sceneMatch?.[1]?.trim() || null;
  const declaredCast =
    castMatch?.[1]
      ?.split(/[、,，/]/)
      .map((item) => item.trim())
      .filter(Boolean) || [];
  const ignoredDialogueNames = new Set([
    "场景",
    "出场",
    "旁白",
    "画外音",
    "字幕",
    "音效",
    "BGM",
    "SFX",
    "OS",
    "VO",
  ]);
  const dialogueCast = Array.from(
    script.matchAll(
      /(?:^|\n)\s*(?:【\s*)?([^\n：:（）()【】]{1,24})(?:[（(][^）)]*[）)])?\s*[：:]/g,
    ),
  )
    .map((match) => match[1]?.trim() || "")
    .filter((name) => name && !ignoredDialogueNames.has(name));
  const cast = Array.from(new Set([...declaredCast, ...dialogueCast]));
  const title = titleMatch?.[1]?.trim() || null;
  return { scene, cast, title };
}

@Injectable()
export class DramaStoryGraphService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(TaskQueueService)
    private readonly taskQueueService?: TaskQueueService,
    @Optional()
    @Inject(DramaStoryGraphIndexService)
    private readonly indexService?: DramaStoryGraphIndexService,
  ) {}

  private async assertOwnedDrama(dramaId: number, userId: number) {
    const [drama] = await this.databaseService.db
      .select()
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
    return drama;
  }

  async getActiveGraph(dramaId: number, userId: number) {
    await this.assertOwnedDrama(dramaId, userId);
    const [graph] = await this.databaseService.db
      .select()
      .from(dramaStoryGraphs)
      .where(
        and(
          eq(dramaStoryGraphs.dramaId, dramaId),
          isNull(dramaStoryGraphs.deletedAt),
          or(
            eq(dramaStoryGraphs.status, "ready"),
            eq(dramaStoryGraphs.status, "building"),
          ),
        ),
      )
      .orderBy(desc(dramaStoryGraphs.version), desc(dramaStoryGraphs.updatedAt))
      .limit(1);
    return graph || null;
  }

  async getStoryGraphSummary(dramaId: number, userId: number) {
    const drama = await this.assertOwnedDrama(dramaId, userId);
    const graph = await this.getActiveGraph(dramaId, userId);
    const coverage = await this.loadScriptCoverage(dramaId, userId, drama);
    const currentScriptHash = coverage.currentScriptEpisodes.length
      ? computeScriptHash(coverage.currentScriptEpisodes)
      : null;
    const metadata = parseDramaMetadata(drama.metadata);
    const aiFirst = toRecord(metadata.ai_first);
    const graphStale = Boolean(
      graph &&
      (!coverage.scriptsComplete ||
        !currentScriptHash ||
        graph.scriptHash !== currentScriptHash),
    );

    let buildTask: ReturnType<
      DramaStoryGraphService["buildTaskSummary"]
    > | null = null;
    const graphTaskId =
      graph?.taskId || toPositiveInt(aiFirst.story_graph_task_id);
    if (graphTaskId) {
      const [task] = await this.databaseService.db
        .select()
        .from(tasks)
        .where(eq(tasks.id, graphTaskId))
        .limit(1);
      buildTask = task ? this.buildTaskSummary(task) : null;
    }

    return {
      graph: graph
        ? this.serializeGraph(graph, currentScriptHash, graphStale)
        : null,
      script_hash: currentScriptHash,
      is_stale: graphStale,
      scripted_episode_count: coverage.currentScriptEpisodes.length,
      planned_episode_count: coverage.plannedEpisodeCount,
      blueprint_episode_count: coverage.blueprintEpisodeCount,
      missing_blueprint_episode_count: coverage.missingBlueprintEpisodeCount,
      current_scripted_episode_count: coverage.currentScriptEpisodes.length,
      stale_scripted_episode_count: coverage.staleScriptedEpisodeCount,
      scripts_complete: coverage.scriptsComplete,
      story_graph_task: buildTask,
      ai_first_stage:
        typeof aiFirst.ai_first_stage === "string"
          ? aiFirst.ai_first_stage
          : null,
    };
  }

  private serializeGraph(
    graph: typeof dramaStoryGraphs.$inferSelect,
    currentScriptHash: string | null,
    isStale: boolean,
  ) {
    let stats: Record<string, unknown> = {};
    let summary: Record<string, unknown> = {};
    try {
      stats = toRecord(JSON.parse(graph.statsJson || "{}"));
    } catch {
      stats = {};
    }
    try {
      summary = toRecord(JSON.parse(graph.summaryJson || "{}"));
    } catch {
      summary = {};
    }
    return {
      id: graph.id,
      drama_id: graph.dramaId,
      status: graph.status,
      version: graph.version,
      script_hash: graph.scriptHash,
      current_script_hash: currentScriptHash,
      is_stale: isStale,
      build_mode: graph.buildMode,
      stats,
      summary,
      failure_reason: graph.failureReason,
      created_at: graph.createdAt,
      updated_at: graph.updatedAt,
    };
  }

  private buildTaskSummary(task: typeof tasks.$inferSelect) {
    let resultSummary: Record<string, unknown> | null = null;
    try {
      resultSummary = toRecord(JSON.parse(task.resultSummaryJson || "{}"));
    } catch {
      resultSummary = null;
    }
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      title: task.title,
      progress: task.progress,
      result_summary: resultSummary,
      error_message: task.errorMessage,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      started_at: task.startedAt,
      completed_at: task.completedAt,
    };
  }

  private async loadScriptCoverage(
    dramaId: number,
    userId: number,
    activeDrama?: typeof dramas.$inferSelect,
  ) {
    const drama = activeDrama ?? (await this.assertOwnedDrama(dramaId, userId));
    const metadata = parseDramaMetadata(drama.metadata);
    const activeTargetEpisodeCount = resolveActiveTargetEpisodeCount(
      drama,
      metadata,
    );
    const rows = await this.databaseService.db
      .select({
        id: episodes.id,
        episodeNumber: episodes.episodeNumber,
        scriptContent: episodes.scriptContent,
        blueprintPayload: episodes.blueprintPayload,
        generationMode: episodes.generationMode,
      })
      .from(episodes)
      .where(
        and(
          eq(episodes.dramaId, dramaId),
          eq(episodes.userId, userId),
          isNull(episodes.deletedAt),
        ),
      )
      .orderBy(episodes.episodeNumber);

    const plannedEpisodes = rows.filter(
      (row) =>
        Boolean(row.blueprintPayload) &&
        (!activeTargetEpisodeCount ||
          row.episodeNumber <= activeTargetEpisodeCount),
    );
    const stale = (generationMode: string | null | undefined) =>
      /_(?:source|analysis|strategy|blueprint)_stale(?:_|$)/.test(
        String(generationMode || ""),
      );
    const currentScriptEpisodes = plannedEpisodes
      .map((row) => ({
        id: row.id,
        episodeNumber: row.episodeNumber,
        scriptContent: String(row.scriptContent || "").trim(),
        stale: stale(row.generationMode),
      }))
      .filter((row) => row.scriptContent && !row.stale)
      .map(({ stale: _stale, ...row }) => row);
    const staleScriptedEpisodeCount = plannedEpisodes.filter(
      (row) =>
        Boolean(String(row.scriptContent || "").trim()) &&
        stale(row.generationMode),
    ).length;
    const missingScriptedEpisodeCount = plannedEpisodes.filter(
      (row) => !String(row.scriptContent || "").trim(),
    ).length;
    const plannedEpisodeNumbers = new Set(
      plannedEpisodes.map((row) => row.episodeNumber),
    );
    const expectedEpisodeCount =
      activeTargetEpisodeCount || plannedEpisodeNumbers.size;
    const missingBlueprintEpisodeCount = activeTargetEpisodeCount
      ? Array.from(
          { length: activeTargetEpisodeCount },
          (_, index) => index + 1,
        ).filter((episodeNumber) => !plannedEpisodeNumbers.has(episodeNumber))
          .length
      : 0;
    const currentScriptEpisodeNumbers = new Set(
      currentScriptEpisodes.map((row) => row.episodeNumber),
    );

    return {
      currentScriptEpisodes,
      plannedEpisodeCount: expectedEpisodeCount,
      blueprintEpisodeCount: plannedEpisodeNumbers.size,
      missingBlueprintEpisodeCount,
      staleScriptedEpisodeCount,
      missingScriptedEpisodeCount,
      scriptsComplete:
        expectedEpisodeCount > 0 &&
        missingBlueprintEpisodeCount === 0 &&
        currentScriptEpisodeNumbers.size === expectedEpisodeCount,
    };
  }

  private async requireCurrentScriptsForGraph(
    dramaId: number,
    userId: number,
    activeDrama?: typeof dramas.$inferSelect,
  ) {
    const coverage = await this.loadScriptCoverage(
      dramaId,
      userId,
      activeDrama,
    );
    if (!coverage.blueprintEpisodeCount)
      throw new BadRequestException("episode_blueprint_required");
    if (!coverage.scriptsComplete)
      throw new BadRequestException("all_episode_scripts_required");
    return coverage;
  }

  async requestBuild(input: {
    dramaId: number;
    userId: number;
    force?: boolean;
  }) {
    const drama = await this.assertOwnedDrama(input.dramaId, input.userId);
    const coverage = await this.requireCurrentScriptsForGraph(
      input.dramaId,
      input.userId,
      drama,
    );
    const scriptEpisodes = coverage.currentScriptEpisodes;

    const scriptHash = computeScriptHash(scriptEpisodes);
    const activeGraph = await this.getActiveGraph(input.dramaId, input.userId);
    if (
      !input.force &&
      activeGraph &&
      activeGraph.status === "ready" &&
      activeGraph.scriptHash === scriptHash
    ) {
      return this.getStoryGraphSummary(input.dramaId, input.userId);
    }

    const [activeTask] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, STORY_GRAPH_DOMAIN),
          eq(tasks.domainId, input.dramaId),
          inArray(tasks.status, ["queued", "running"]),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);

    if (activeTask) {
      throw new ConflictException("story_graph_build_active");
    }

    const [latestGraph] = await this.databaseService.db
      .select({ version: dramaStoryGraphs.version })
      .from(dramaStoryGraphs)
      .where(
        and(
          eq(dramaStoryGraphs.dramaId, input.dramaId),
          isNull(dramaStoryGraphs.deletedAt),
        ),
      )
      .orderBy(desc(dramaStoryGraphs.version), desc(dramaStoryGraphs.updatedAt))
      .limit(1);

    const timestamp = new Date();
    const episodeScope = scriptEpisodes.map((episode) => episode.episodeNumber);
    const metadata = parseDramaMetadata(drama.metadata);
    const aiFirst = toRecord(metadata.ai_first);
    const nextVersion = (latestGraph?.version || activeGraph?.version || 0) + 1;

    const [graph] = await this.databaseService.db
      .insert(dramaStoryGraphs)
      .values({
        userId: input.userId,
        dramaId: input.dramaId,
        sourceId: Number(aiFirst.source_id) || null,
        graphBasis: "script",
        scriptHash,
        episodeScopeJson: JSON.stringify(episodeScope),
        version: nextVersion,
        status: "building",
        buildMode: "from_script",
        statsJson: "{}",
        summaryJson: "{}",
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();

    const payload = {
      operation: "drama_story_graph_build",
      drama_id: input.dramaId,
      graph_id: graph.id,
      script_hash: scriptHash,
      episode_numbers: episodeScope,
    };

    const [task] = await this.databaseService.db
      .insert(tasks)
      .values({
        userId: input.userId,
        type: STORY_GRAPH_TASK_TYPE,
        status: "queued",
        title: compactText(`故事地图：${drama.title}`, 120),
        progress: 0,
        sourceType: "drama_ai_first",
        dramaId: input.dramaId,
        domainTable: STORY_GRAPH_DOMAIN,
        domainId: input.dramaId,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify({
          phase: "queued",
          drama_id: input.dramaId,
          graph_id: graph.id,
        }),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();

    await this.databaseService.db
      .update(dramaStoryGraphs)
      .set({ taskId: task.id, updatedAt: timestamp })
      .where(eq(dramaStoryGraphs.id, graph.id));

    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...metadata,
          ai_first: {
            ...aiFirst,
            ai_first_stage: "graph_building",
            story_graph_id: graph.id,
            story_graph_task_id: task.id,
            story_graph_task_status: "queued",
            ai_first_updated_at: timestamp.toISOString(),
          },
        }),
        updatedAt: timestamp,
      })
      .where(
        and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
      );

    if (this.taskQueueService) {
      await this.taskQueueService.enqueueTask(task.id);
    } else {
      await this.executeBuildTask({
        taskId: task.id,
        userId: input.userId,
        dramaId: input.dramaId,
        graphId: graph.id,
      });
    }

    return this.getStoryGraphSummary(input.dramaId, input.userId);
  }

  async executeBuildTask(input: {
    taskId: number;
    userId: number;
    dramaId: number;
    graphId: number;
  }) {
    try {
      await this.assertBuildTaskNotCanceled(input.taskId);
      const timestamp = new Date();
      await this.databaseService.db
        .update(tasks)
        .set({
          status: "running",
          progress: 5,
          startedAt: timestamp,
          resultSummaryJson: JSON.stringify({
            phase: "collecting_scripts",
            drama_id: input.dramaId,
            graph_id: input.graphId,
          }),
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(tasks.id, input.taskId),
            inArray(tasks.status, ["queued", "running"]),
          ),
        );

      const drama = await this.assertOwnedDrama(input.dramaId, input.userId);
      const coverage = await this.requireCurrentScriptsForGraph(
        input.dramaId,
        input.userId,
        drama,
      );
      const scriptEpisodes = coverage.currentScriptEpisodes;
      const currentScriptHash = computeScriptHash(scriptEpisodes);
      const [graph] = await this.databaseService.db
        .select({
          id: dramaStoryGraphs.id,
          scriptHash: dramaStoryGraphs.scriptHash,
        })
        .from(dramaStoryGraphs)
        .where(
          and(
            eq(dramaStoryGraphs.id, input.graphId),
            eq(dramaStoryGraphs.dramaId, input.dramaId),
            isNull(dramaStoryGraphs.deletedAt),
          ),
        )
        .limit(1);
      if (!graph) throw new NotFoundException("story_graph_not_found");
      if (graph.scriptHash !== currentScriptHash)
        throw new ConflictException("story_graph_source_changed");

      const metadata = parseDramaMetadata(drama.metadata);
      const aiFirst = toRecord(metadata.ai_first);
      const sourceAnalysis = toRecord(aiFirst.source_analysis);
      const writingId = this.resolveWritingId(metadata);

      await this.updateBuildProgress(
        input.taskId,
        20,
        "extracting_entities",
        input.dramaId,
        input.graphId,
      );
      let extracted = this.extractFromScripts(scriptEpisodes, sourceAnalysis);
      if (writingId && this.indexService) {
        const cards = await this.indexService.loadWritingKnowledgeCards(
          writingId,
          input.userId,
        );
        extracted = mergeWritingKnowledgeCards(extracted, cards);
      }

      return this.completeBuildTaskWithExtracted({
        ...input,
        metadata,
        aiFirst,
        sourceAnalysis,
        scriptEpisodes,
        writingId,
        extracted,
      });
    } catch (error) {
      if (await this.isBuildTaskCanceled(input.taskId)) {
        return { graph_id: input.graphId, status: "canceled" };
      }
      await this.failBuildTask(
        input.taskId,
        input.graphId,
        input.dramaId,
        input.userId,
        error,
      );
      throw error;
    }
  }

  /**
   * Finalizes a graph from a structured Agent draft. The caller must already
   * be scoped to one task, drama, graph and user; this service still reloads
   * the script basis so stale user edits cannot be silently accepted.
   */
  async completeBuildTaskFromAgent(input: {
    taskId: number;
    userId: number;
    dramaId: number;
    graphId: number;
    extracted: StoryGraphDraft;
  }) {
    try {
      await this.assertBuildTaskNotCanceled(input.taskId);
      const drama = await this.assertOwnedDrama(input.dramaId, input.userId);
      const coverage = await this.requireCurrentScriptsForGraph(
        input.dramaId,
        input.userId,
        drama,
      );
      const scriptEpisodes = coverage.currentScriptEpisodes;
      const currentScriptHash = computeScriptHash(scriptEpisodes);
      const [graph] = await this.databaseService.db
        .select({
          id: dramaStoryGraphs.id,
          scriptHash: dramaStoryGraphs.scriptHash,
        })
        .from(dramaStoryGraphs)
        .where(
          and(
            eq(dramaStoryGraphs.id, input.graphId),
            eq(dramaStoryGraphs.dramaId, input.dramaId),
            eq(dramaStoryGraphs.userId, input.userId),
            isNull(dramaStoryGraphs.deletedAt),
          ),
        )
        .limit(1);
      if (!graph) throw new NotFoundException("story_graph_not_found");
      if (graph.scriptHash !== currentScriptHash)
        throw new ConflictException("story_graph_source_changed");

      const metadata = parseDramaMetadata(drama.metadata);
      const aiFirst = toRecord(metadata.ai_first);
      const sourceAnalysis = toRecord(aiFirst.source_analysis);
      const writingId = this.resolveWritingId(metadata);
      let extracted = input.extracted;
      if (writingId && this.indexService) {
        const cards = await this.indexService.loadWritingKnowledgeCards(
          writingId,
          input.userId,
        );
        extracted = mergeWritingKnowledgeCards(extracted, cards);
      }

      return this.completeBuildTaskWithExtracted({
        ...input,
        metadata,
        aiFirst,
        sourceAnalysis,
        scriptEpisodes,
        writingId,
        extracted,
      });
    } catch (error) {
      if (await this.isBuildTaskCanceled(input.taskId)) {
        return { graph_id: input.graphId, status: "canceled" };
      }
      await this.failBuildTask(
        input.taskId,
        input.graphId,
        input.dramaId,
        input.userId,
        error,
      );
      throw error;
    }
  }

  private async completeBuildTaskWithExtracted(input: {
    taskId: number;
    userId: number;
    dramaId: number;
    graphId: number;
    metadata: Record<string, unknown>;
    aiFirst: Record<string, unknown>;
    sourceAnalysis: Record<string, unknown>;
    scriptEpisodes: Array<{
      id: number;
      episodeNumber: number;
      scriptContent: string;
    }>;
    writingId: number | null;
    extracted: StoryGraphDraft;
  }) {
    const timestamp = new Date();
    await this.updateBuildProgress(
      input.taskId,
      55,
      "writing_graph",
      input.dramaId,
      input.graphId,
    );
    const diffStats = await this.persistGraphDiff(
      input.graphId,
      input.dramaId,
      input.userId,
      input.extracted,
    );

    await this.updateBuildProgress(
      input.taskId,
      78,
      "seeding_assets",
      input.dramaId,
      input.graphId,
    );
    const seedStats = await this.seedAssetsInternal(
      input.graphId,
      input.dramaId,
      input.userId,
    );

    await this.updateBuildProgress(
      input.taskId,
      90,
      "indexing_search",
      input.dramaId,
      input.graphId,
    );
    const indexStats = this.indexService
      ? await this.indexService.rebuildIndex({
          graphId: input.graphId,
          dramaId: input.dramaId,
          userId: input.userId,
          scriptEpisodes: input.scriptEpisodes,
          writingId: input.writingId,
        })
      : null;

    const stats = {
      entity_count: input.extracted.entities.length,
      relation_count: input.extracted.relations.length,
      event_count: input.extracted.events.length,
      alias_count: input.extracted.entities.reduce(
        (sum, entity) => sum + (entity.aliases?.length || 0),
        0,
      ),
      seeded_characters: seedStats.seededCharacters,
      linked_characters: seedStats.linkedCharacters,
      seeded_scenes: seedStats.seededScenes,
      linked_scenes: seedStats.linkedScenes,
      episode_character_links: seedStats.episodeCharacterLinks,
      episode_scene_links: seedStats.episodeSceneLinks,
      diff: diffStats,
      writing_preseed_count: input.writingId
        ? input.extracted.entities.filter((entity) =>
            (entity.sourceTrace || []).some(
              (trace) => trace.kind === "writing_knowledge_card",
            ),
          ).length
        : 0,
      search_index: indexStats,
    };
    const summary = {
      theme: compactText(String(input.sourceAnalysis.theme || ""), 120) || null,
      core_conflict:
        compactText(String(input.sourceAnalysis.core_conflict || ""), 160) ||
        null,
      protagonist:
        compactText(String(input.sourceAnalysis.protagonist || ""), 80) || null,
    };

    await this.assertBuildTaskNotCanceled(input.taskId);
    const [completedGraph] = await this.databaseService.db
      .update(dramaStoryGraphs)
      .set({
        status: "ready",
        statsJson: JSON.stringify(stats),
        summaryJson: JSON.stringify(summary),
        failureReason: null,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(dramaStoryGraphs.id, input.graphId),
          eq(dramaStoryGraphs.status, "building"),
        ),
      )
      .returning({ id: dramaStoryGraphs.id });
    if (!completedGraph) {
      if (await this.isBuildTaskCanceled(input.taskId)) {
        return { graph_id: input.graphId, status: "canceled" };
      }
      throw new ConflictException("story_graph_build_not_active");
    }

    const [currentTask] = await this.databaseService.db
      .select({ resultSummaryJson: tasks.resultSummaryJson })
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .limit(1);
    const currentSummary = parseJsonObject(currentTask?.resultSummaryJson);
    await this.databaseService.db
      .update(tasks)
      .set({
        status: "completed",
        progress: 100,
        resultSummaryJson: JSON.stringify({
          ...currentSummary,
          phase: "completed",
          drama_id: input.dramaId,
          graph_id: input.graphId,
          ...stats,
        }),
        completedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(tasks.id, input.taskId),
          inArray(tasks.status, ["queued", "running"]),
        ),
      );

    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...input.metadata,
          ai_first: {
            ...input.aiFirst,
            ai_first_stage: "graph_ready",
            story_graph_id: input.graphId,
            story_graph_task_id: input.taskId,
            story_graph_task_status: "completed",
            story_graph_status: "ready",
            story_graph_stats: stats,
            ai_first_updated_at: timestamp.toISOString(),
          },
        }),
        updatedAt: timestamp,
      })
      .where(
        and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
      );

    return { graph_id: input.graphId, status: "ready", stats };
  }

  private async isBuildTaskCanceled(taskId: number) {
    const [task] = await this.databaseService.db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    return task?.status === "canceled";
  }

  private async assertBuildTaskNotCanceled(taskId: number) {
    if (await this.isBuildTaskCanceled(taskId)) {
      throw new Error("story_graph_build_canceled");
    }
  }

  async cancelBuildTask(input: {
    taskId: number;
    graphId: number;
    dramaId: number;
    userId: number;
  }) {
    const drama = await this.assertOwnedDrama(input.dramaId, input.userId);
    const timestamp = new Date();
    await this.databaseService.db
      .update(dramaStoryGraphs)
      .set({
        status: "canceled",
        failureReason: "Canceled by user",
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(dramaStoryGraphs.id, input.graphId),
          eq(dramaStoryGraphs.dramaId, input.dramaId),
          eq(dramaStoryGraphs.userId, input.userId),
          eq(dramaStoryGraphs.status, "building"),
        ),
      );

    const metadata = parseDramaMetadata(drama.metadata);
    const aiFirst = toRecord(metadata.ai_first);
    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...metadata,
          ai_first: {
            ...aiFirst,
            ai_first_stage: "script_ready",
            story_graph_id: input.graphId,
            story_graph_task_id: input.taskId,
            story_graph_task_status: "canceled",
            story_graph_status: "canceled",
            ai_first_updated_at: timestamp.toISOString(),
          },
        }),
        updatedAt: timestamp,
      })
      .where(
        and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
      );
  }

  async retryBuildTask(input: {
    taskId: number;
    graphId: number;
    dramaId: number;
    userId: number;
  }) {
    const drama = await this.assertOwnedDrama(input.dramaId, input.userId);
    const timestamp = new Date();
    await this.databaseService.db
      .update(dramaStoryGraphs)
      .set({
        status: "building",
        failureReason: null,
        taskId: input.taskId,
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(dramaStoryGraphs.id, input.graphId),
          eq(dramaStoryGraphs.dramaId, input.dramaId),
          eq(dramaStoryGraphs.userId, input.userId),
        ),
      );

    const metadata = parseDramaMetadata(drama.metadata);
    const aiFirst = toRecord(metadata.ai_first);
    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...metadata,
          ai_first: {
            ...aiFirst,
            ai_first_stage: "graph_building",
            story_graph_id: input.graphId,
            story_graph_task_id: input.taskId,
            story_graph_task_status: "queued",
            story_graph_status: "building",
            ai_first_updated_at: timestamp.toISOString(),
          },
        }),
        updatedAt: timestamp,
      })
      .where(
        and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
      );
  }

  private async updateBuildProgress(
    taskId: number,
    progress: number,
    phase: string,
    dramaId: number,
    graphId: number,
  ) {
    await this.databaseService.db
      .update(tasks)
      .set({
        status: "running",
        progress,
        resultSummaryJson: JSON.stringify({
          phase,
          drama_id: dramaId,
          graph_id: graphId,
        }),
        updatedAt: new Date(),
      })
      .where(
        and(eq(tasks.id, taskId), inArray(tasks.status, ["queued", "running"])),
      );
  }

  async failBuildTask(
    taskId: number,
    graphId: number,
    dramaId: number,
    userId: number,
    error: unknown,
  ) {
    if (await this.isBuildTaskCanceled(taskId)) return;
    const message =
      error instanceof Error ? error.message : "story_graph_build_failed";
    const timestamp = new Date();
    await this.databaseService.db
      .update(dramaStoryGraphs)
      .set({
        status: "failed",
        failureReason: compactText(message, 500),
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(dramaStoryGraphs.id, graphId),
          eq(dramaStoryGraphs.status, "building"),
        ),
      );

    await this.databaseService.db
      .update(tasks)
      .set({
        status: "failed",
        errorKind: "provider",
        errorMessage: compactText(message, 500),
        completedAt: timestamp,
        updatedAt: timestamp,
      })
      .where(
        and(eq(tasks.id, taskId), inArray(tasks.status, ["queued", "running"])),
      );

    const drama = await this.assertOwnedDrama(dramaId, userId);
    const metadata = parseDramaMetadata(drama.metadata);
    const aiFirst = toRecord(metadata.ai_first);
    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...metadata,
          ai_first: {
            ...aiFirst,
            ai_first_stage: "script_ready",
            story_graph_task_status: "failed",
            ai_first_updated_at: timestamp.toISOString(),
          },
        }),
        updatedAt: timestamp,
      })
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId)));
  }

  private extractFromScripts(
    scriptEpisodes: Array<{
      id: number;
      episodeNumber: number;
      scriptContent: string;
    }>,
    sourceAnalysis: Record<string, unknown>,
  ) {
    const entityMap = new Map<string, StoryGraphEntityDraft>();
    const relations: StoryGraphRelationDraft[] = [];
    const events: StoryGraphEventDraft[] = [];

    const upsertEntity = (draft: StoryGraphEntityDraft) => {
      const key = `${draft.entityType}:${normalizeName(draft.canonicalName)}`;
      const existing = entityMap.get(key);
      if (existing) {
        existing.importance = Math.max(
          existing.importance || 0,
          draft.importance || 0,
        );
        if (!existing.description && draft.description)
          existing.description = draft.description;
        if (!existing.firstSeen && draft.firstSeen)
          existing.firstSeen = draft.firstSeen;
        existing.sourceTrace = mergeSourceTraces(
          existing.sourceTrace,
          draft.sourceTrace,
        );
        if (draft.aliases?.length) {
          existing.aliases = Array.from(
            new Set([...(existing.aliases || []), ...draft.aliases]),
          );
        }
        return;
      }
      entityMap.set(key, {
        ...draft,
        aliases: draft.aliases ? [...draft.aliases] : [],
      });
    };

    const protagonist = String(sourceAnalysis.protagonist || "").trim();
    const antagonist = String(sourceAnalysis.antagonist || "").trim();
    if (protagonist) {
      upsertEntity({
        entityType: "character",
        canonicalName: protagonist,
        role: "protagonist",
        importance: 1,
        sourceTrace: [{ kind: "source_analysis", field: "protagonist" }],
      });
    }
    if (antagonist) {
      upsertEntity({
        entityType: "character",
        canonicalName: antagonist,
        role: "antagonist",
        importance: 0.9,
        sourceTrace: [{ kind: "source_analysis", field: "antagonist" }],
      });
    }

    const relationshipMap = Array.isArray(sourceAnalysis.relationship_map)
      ? sourceAnalysis.relationship_map
      : [];
    for (const item of relationshipMap) {
      const row = toRecord(item);
      const from = String(row.from || row.subject || "").trim();
      const to = String(row.to || row.object || "").trim();
      const predicate = String(row.relation || row.predicate || "相关").trim();
      if (!from || !to) continue;
      upsertEntity({
        entityType: "character",
        canonicalName: from,
        importance: 0.6,
      });
      upsertEntity({
        entityType: "character",
        canonicalName: to,
        importance: 0.6,
      });
      relations.push({
        subjectName: from,
        objectName: to,
        relationType: "social",
        predicate,
        evidence: [{ kind: "source_analysis", field: "relationship_map" }],
      });
    }

    for (const episode of scriptEpisodes) {
      const meta = extractScriptMeta(episode.scriptContent);
      if (meta.scene) {
        upsertEntity({
          entityType: "scene",
          canonicalName: meta.scene,
          importance: 0.5,
          firstSeen: { episode_number: episode.episodeNumber },
          sourceTrace: [
            {
              kind: "script",
              episode_number: episode.episodeNumber,
              field: "scene",
            },
          ],
        });
      }
      for (const name of meta.cast) {
        upsertEntity({
          entityType: "character",
          canonicalName: name,
          importance: 0.7,
          firstSeen: { episode_number: episode.episodeNumber },
          sourceTrace: [
            {
              kind: "script",
              episode_number: episode.episodeNumber,
              field: "cast",
            },
          ],
        });
      }

      const hookMatch = episode.scriptContent.match(/【开场钩子】(.+)/);
      const plotMatch = episode.scriptContent.match(/【剧情推进】(.+)/);
      events.push({
        episodeId: episode.id,
        episodeNumber: episode.episodeNumber,
        title: meta.title || `第${episode.episodeNumber}集主线`,
        summary: compactText(
          plotMatch?.[1] ||
            hookMatch?.[1] ||
            episode.scriptContent.slice(0, 180),
          240,
        ),
        scriptSpanStart: 0,
        scriptSpanEnd: Math.min(episode.scriptContent.length, 400),
        involvedNames: meta.cast,
        emotionalTone: hookMatch ? "hook" : undefined,
      });

      for (let i = 0; i < meta.cast.length; i += 1) {
        for (let j = i + 1; j < meta.cast.length; j += 1) {
          relations.push({
            subjectName: meta.cast[i],
            objectName: meta.cast[j],
            relationType: "co_occurrence",
            predicate: "同场出现",
            evidence: [
              { kind: "script", episode_number: episode.episodeNumber },
            ],
          });
        }
      }
    }

    return {
      entities: Array.from(entityMap.values()),
      relations,
      events,
    };
  }

  private entityKey(entityType: string, canonicalName: string) {
    return `${entityType}:${normalizeName(canonicalName)}`;
  }

  private async persistGraphDiff(
    graphId: number,
    dramaId: number,
    userId: number,
    extracted: {
      entities: StoryGraphEntityDraft[];
      relations: StoryGraphRelationDraft[];
      events: StoryGraphEventDraft[];
    },
  ) {
    const timestamp = new Date();
    const existingRows = await this.databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(
        and(
          eq(dramaGraphEntities.graphId, graphId),
          isNull(dramaGraphEntities.deletedAt),
        ),
      );

    const existingByKey = new Map(
      existingRows.map((row) => [
        this.entityKey(row.entityType, row.canonicalName),
        row,
      ]),
    );
    const nextKeys = new Set(
      extracted.entities.map((entity) =>
        this.entityKey(entity.entityType, entity.canonicalName),
      ),
    );

    let added = 0;
    let updated = 0;
    let removed = 0;
    const nameToEntityId = new Map<string, number>();

    for (const entity of extracted.entities) {
      const key = this.entityKey(entity.entityType, entity.canonicalName);
      const existing = existingByKey.get(key);
      if (existing) {
        updated += 1;
        const [saved] = await this.databaseService.db
          .update(dramaGraphEntities)
          .set({
            displayName: entity.displayName || entity.canonicalName,
            role: entity.role || existing.role,
            description: entity.description || existing.description,
            importance: Math.max(
              existing.importance || 0,
              entity.importance ?? 0.5,
            ),
            firstSeenJson: JSON.stringify(
              entity.firstSeen || JSON.parse(existing.firstSeenJson || "{}"),
            ),
            sourceTraceJson: JSON.stringify(
              entity.sourceTrace ||
                JSON.parse(existing.sourceTraceJson || "[]"),
            ),
            updatedAt: timestamp,
          })
          .where(eq(dramaGraphEntities.id, existing.id))
          .returning();
        nameToEntityId.set(key, saved.id);
        nameToEntityId.set(normalizeName(entity.canonicalName), saved.id);

        await this.databaseService.db
          .delete(dramaEntityAliases)
          .where(eq(dramaEntityAliases.entityId, saved.id));
        for (const alias of entity.aliases || []) {
          if (!alias.trim()) continue;
          await this.databaseService.db.insert(dramaEntityAliases).values({
            graphId,
            entityId: saved.id,
            alias: alias.trim(),
            aliasType: "title",
            evidenceJson: "[]",
            createdAt: timestamp,
          });
        }
        continue;
      }

      added += 1;
      const [inserted] = await this.databaseService.db
        .insert(dramaGraphEntities)
        .values({
          graphId,
          dramaId,
          entityType: entity.entityType,
          canonicalName: entity.canonicalName,
          displayName: entity.displayName || entity.canonicalName,
          role: entity.role || null,
          description: entity.description || null,
          importance: entity.importance ?? 0.5,
          firstSeenJson: JSON.stringify(entity.firstSeen || {}),
          sourceTraceJson: JSON.stringify(entity.sourceTrace || []),
          seedStatus: "pending",
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning();
      nameToEntityId.set(key, inserted.id);
      nameToEntityId.set(normalizeName(entity.canonicalName), inserted.id);
      for (const alias of entity.aliases || []) {
        if (!alias.trim()) continue;
        await this.databaseService.db.insert(dramaEntityAliases).values({
          graphId,
          entityId: inserted.id,
          alias: alias.trim(),
          aliasType: "title",
          evidenceJson: "[]",
          createdAt: timestamp,
        });
      }
    }

    for (const [key, row] of existingByKey) {
      if (nextKeys.has(key)) continue;
      removed += 1;
      await this.databaseService.db
        .update(dramaGraphEntities)
        .set({ deletedAt: timestamp, updatedAt: timestamp })
        .where(eq(dramaGraphEntities.id, row.id));
    }

    await this.databaseService.db
      .update(dramaGraphRelations)
      .set({ deletedAt: timestamp, updatedAt: timestamp })
      .where(
        and(
          eq(dramaGraphRelations.graphId, graphId),
          isNull(dramaGraphRelations.deletedAt),
        ),
      );

    let relationCount = 0;
    for (const relation of extracted.relations) {
      const subjectId = nameToEntityId.get(normalizeName(relation.subjectName));
      const objectId = nameToEntityId.get(normalizeName(relation.objectName));
      if (!subjectId || !objectId || subjectId === objectId) continue;
      relationCount += 1;
      await this.databaseService.db.insert(dramaGraphRelations).values({
        graphId,
        dramaId,
        subjectEntityId: subjectId,
        objectEntityId: objectId,
        relationType: relation.relationType,
        predicate: relation.predicate,
        description: relation.description || null,
        evidenceJson: JSON.stringify(relation.evidence || []),
        sourceTraceJson: JSON.stringify(relation.evidence || []),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    await this.databaseService.db
      .delete(dramaGraphEvents)
      .where(eq(dramaGraphEvents.graphId, graphId));

    for (const event of extracted.events) {
      const involvedIds = (event.involvedNames || [])
        .map((name) => nameToEntityId.get(normalizeName(name)))
        .filter((id): id is number => Number.isInteger(id));
      await this.databaseService.db.insert(dramaGraphEvents).values({
        graphId,
        dramaId,
        eventType: "plot",
        title: event.title,
        summary: event.summary || null,
        episodeId: event.episodeId ?? null,
        episodeNumber: event.episodeNumber,
        scriptSpanStart: event.scriptSpanStart ?? null,
        scriptSpanEnd: event.scriptSpanEnd ?? null,
        involvedEntityIdsJson: JSON.stringify(involvedIds),
        emotionalTone: event.emotionalTone || null,
        evidenceJson: JSON.stringify([
          { kind: "script", episode_number: event.episodeNumber },
        ]),
        sourceTraceJson: JSON.stringify([
          { kind: "script", episode_number: event.episodeNumber },
        ]),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return { added, updated, removed, relation_count: relationCount };
  }

  private async seedAssetsInternal(
    graphId: number,
    dramaId: number,
    userId: number,
  ) {
    const entityRows = await this.databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(
        and(
          eq(dramaGraphEntities.graphId, graphId),
          isNull(dramaGraphEntities.deletedAt),
        ),
      );

    const timestamp = new Date();
    let seededCharacters = 0;
    let linkedCharacters = 0;
    let seededScenes = 0;
    let linkedScenes = 0;

    for (const entity of entityRows) {
      if (entity.entityType === "character") {
        const [existing] = await this.databaseService.db
          .select({ id: characters.id })
          .from(characters)
          .where(
            and(
              eq(characters.dramaId, dramaId),
              eq(characters.name, entity.canonicalName),
              isNull(characters.deletedAt),
            ),
          )
          .limit(1);
        if (existing) {
          await this.databaseService.db
            .update(dramaGraphEntities)
            .set({
              linkedCharacterId: existing.id,
              seedStatus: "linked",
              updatedAt: timestamp,
            })
            .where(eq(dramaGraphEntities.id, entity.id));
          linkedCharacters += 1;
          continue;
        }
        const [created] = await this.databaseService.db
          .insert(characters)
          .values({
            userId,
            dramaId,
            name: entity.canonicalName,
            role: entity.role || null,
            description: entity.description || null,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
        await this.databaseService.db
          .update(dramaGraphEntities)
          .set({
            linkedCharacterId: created.id,
            seedStatus: "seeded",
            updatedAt: timestamp,
          })
          .where(eq(dramaGraphEntities.id, entity.id));
        seededCharacters += 1;
        continue;
      }

      if (entity.entityType === "scene") {
        const [existing] = await this.databaseService.db
          .select({ id: scenes.id })
          .from(scenes)
          .where(
            and(
              eq(scenes.dramaId, dramaId),
              eq(scenes.location, entity.canonicalName),
              isNull(scenes.deletedAt),
            ),
          )
          .limit(1);
        if (existing) {
          await this.databaseService.db
            .update(dramaGraphEntities)
            .set({
              linkedSceneId: existing.id,
              seedStatus: "linked",
              updatedAt: timestamp,
            })
            .where(eq(dramaGraphEntities.id, entity.id));
          linkedScenes += 1;
          continue;
        }
        const [created] = await this.databaseService.db
          .insert(scenes)
          .values({
            userId,
            dramaId,
            location: entity.canonicalName,
            time: "日",
            prompt: entity.description || entity.canonicalName,
            createdAt: timestamp,
            updatedAt: timestamp,
          })
          .returning();
        await this.databaseService.db
          .update(dramaGraphEntities)
          .set({
            linkedSceneId: created.id,
            seedStatus: "seeded",
            updatedAt: timestamp,
          })
          .where(eq(dramaGraphEntities.id, entity.id));
        seededScenes += 1;
      }
    }

    const episodeLinkStats = await this.linkSeededAssetsToEpisodes(
      graphId,
      dramaId,
      userId,
      timestamp,
    );
    return {
      seededCharacters,
      linkedCharacters,
      seededScenes,
      linkedScenes,
      ...episodeLinkStats,
    };
  }

  /**
   * Story graph assets are project-level, while storyboard persistence is
   * intentionally episode-scoped. Connect the graph's cast and scenes to
   * their script episodes before asking the storyboard model to use them.
   */
  private async linkSeededAssetsToEpisodes(
    graphId: number,
    dramaId: number,
    userId: number,
    timestamp: Date,
  ) {
    const [entityRows, eventRows, episodeRows] = await Promise.all([
      this.databaseService.db
        .select({
          id: dramaGraphEntities.id,
          entityType: dramaGraphEntities.entityType,
          linkedCharacterId: dramaGraphEntities.linkedCharacterId,
          linkedSceneId: dramaGraphEntities.linkedSceneId,
          sourceTraceJson: dramaGraphEntities.sourceTraceJson,
        })
        .from(dramaGraphEntities)
        .where(
          and(
            eq(dramaGraphEntities.graphId, graphId),
            isNull(dramaGraphEntities.deletedAt),
          ),
        ),
      this.databaseService.db
        .select({
          episodeNumber: dramaGraphEvents.episodeNumber,
          involvedEntityIdsJson: dramaGraphEvents.involvedEntityIdsJson,
        })
        .from(dramaGraphEvents)
        .where(eq(dramaGraphEvents.graphId, graphId)),
      this.databaseService.db
        .select({ id: episodes.id, episodeNumber: episodes.episodeNumber })
        .from(episodes)
        .where(
          and(
            eq(episodes.dramaId, dramaId),
            eq(episodes.userId, userId),
            isNull(episodes.deletedAt),
          ),
        ),
    ]);

    const episodeIdByNumber = new Map(
      episodeRows.map((episode) => [episode.episodeNumber, episode.id]),
    );
    const characterIdByEntityId = new Map(
      entityRows
        .filter(
          (entity) =>
            entity.entityType === "character" && entity.linkedCharacterId,
        )
        .map((entity) => [entity.id, entity.linkedCharacterId!] as const),
    );
    const characterLinks = new Map<number, Set<number>>();
    const sceneLinks = new Map<number, Set<number>>();

    const addLink = (
      links: Map<number, Set<number>>,
      episodeNumber: number | null,
      assetId: number | null,
    ) => {
      const episodeId =
        episodeNumber == null
          ? undefined
          : episodeIdByNumber.get(episodeNumber);
      if (!episodeId || !assetId) return;
      const assetIds = links.get(episodeId) || new Set<number>();
      assetIds.add(assetId);
      links.set(episodeId, assetIds);
    };

    for (const event of eventRows) {
      const episodeNumber = Number(event.episodeNumber);
      if (!Number.isInteger(episodeNumber) || episodeNumber <= 0) continue;
      for (const entityId of parseJsonArray(event.involvedEntityIdsJson)) {
        const characterId = characterIdByEntityId.get(Number(entityId));
        addLink(characterLinks, episodeNumber, characterId || null);
      }
    }

    for (const entity of entityRows) {
      const assetId =
        entity.entityType === "character"
          ? entity.linkedCharacterId
          : entity.entityType === "scene"
            ? entity.linkedSceneId
            : null;
      if (!assetId) continue;
      const links =
        entity.entityType === "character" ? characterLinks : sceneLinks;
      for (const episodeNumber of episodeNumbersFromTrace(
        entity.sourceTraceJson,
      )) {
        addLink(links, episodeNumber, assetId);
      }
    }

    const episodeIds = Array.from(
      new Set([...characterLinks.keys(), ...sceneLinks.keys()]),
    );
    if (!episodeIds.length)
      return { episodeCharacterLinks: 0, episodeSceneLinks: 0 };

    const [existingCharacterLinks, existingSceneLinks] = await Promise.all([
      this.databaseService.db
        .select()
        .from(episodeCharacters)
        .where(inArray(episodeCharacters.episodeId, episodeIds)),
      this.databaseService.db
        .select()
        .from(episodeScenes)
        .where(inArray(episodeScenes.episodeId, episodeIds)),
    ]);
    const existingCharacterKeys = new Set(
      existingCharacterLinks.map(
        (link) => `${link.episodeId}:${link.characterId}`,
      ),
    );
    const existingSceneKeys = new Set(
      existingSceneLinks.map((link) => `${link.episodeId}:${link.sceneId}`),
    );
    const nextCharacterLinks = Array.from(characterLinks.entries()).flatMap(
      ([episodeId, characterIds]) =>
        Array.from(characterIds)
          .filter(
            (characterId) =>
              !existingCharacterKeys.has(`${episodeId}:${characterId}`),
          )
          .map((characterId) => ({
            episodeId,
            characterId,
            createdAt: timestamp,
          })),
    );
    const nextSceneLinks = Array.from(sceneLinks.entries()).flatMap(
      ([episodeId, sceneIds]) =>
        Array.from(sceneIds)
          .filter(
            (sceneId) => !existingSceneKeys.has(`${episodeId}:${sceneId}`),
          )
          .map((sceneId) => ({ episodeId, sceneId, createdAt: timestamp })),
    );

    if (nextCharacterLinks.length) {
      await this.databaseService.db
        .insert(episodeCharacters)
        .values(nextCharacterLinks);
    }
    if (nextSceneLinks.length) {
      await this.databaseService.db
        .insert(episodeScenes)
        .values(nextSceneLinks);
    }

    return {
      episodeCharacterLinks: nextCharacterLinks.length,
      episodeSceneLinks: nextSceneLinks.length,
    };
  }

  async getEntityDetail(dramaId: number, userId: number, entityId: number) {
    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph) throw new NotFoundException("story_graph_not_found");

    const [entity] = await this.databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(
        and(
          eq(dramaGraphEntities.id, entityId),
          eq(dramaGraphEntities.graphId, graph.id),
          isNull(dramaGraphEntities.deletedAt),
        ),
      )
      .limit(1);
    if (!entity) throw new NotFoundException("graph_entity_not_found");

    const aliasRows = await this.databaseService.db
      .select()
      .from(dramaEntityAliases)
      .where(
        and(
          eq(dramaEntityAliases.graphId, graph.id),
          eq(dramaEntityAliases.entityId, entity.id),
        ),
      );

    const relationRows = await this.databaseService.db
      .select()
      .from(dramaGraphRelations)
      .where(
        and(
          eq(dramaGraphRelations.graphId, graph.id),
          isNull(dramaGraphRelations.deletedAt),
          or(
            eq(dramaGraphRelations.subjectEntityId, entity.id),
            eq(dramaGraphRelations.objectEntityId, entity.id),
          ),
        ),
      );

    const relatedEntityIds = Array.from(
      new Set(
        relationRows.flatMap((row) => [
          row.subjectEntityId,
          row.objectEntityId,
        ]),
      ),
    );
    const relatedEntities = relatedEntityIds.length
      ? await this.databaseService.db
          .select({
            id: dramaGraphEntities.id,
            canonicalName: dramaGraphEntities.canonicalName,
          })
          .from(dramaGraphEntities)
          .where(inArray(dramaGraphEntities.id, relatedEntityIds))
      : [];
    const nameById = new Map(
      relatedEntities.map((row) => [row.id, row.canonicalName]),
    );

    let sourceTrace: Array<Record<string, unknown>> = [];
    try {
      sourceTrace = JSON.parse(entity.sourceTraceJson || "[]") as Array<
        Record<string, unknown>
      >;
    } catch {
      sourceTrace = [];
    }

    let seedConflict: Record<string, unknown> = {};
    try {
      seedConflict = toRecord(JSON.parse(entity.seedConflictJson || "{}"));
    } catch {
      seedConflict = {};
    }

    return {
      entity: {
        id: entity.id,
        entity_type: entity.entityType,
        canonical_name: entity.canonicalName,
        display_name: entity.displayName,
        role: entity.role,
        description: entity.description,
        importance: entity.importance,
        seed_status: entity.seedStatus,
        linked_character_id: entity.linkedCharacterId,
        linked_scene_id: entity.linkedSceneId,
        linked_prop_id: entity.linkedPropId,
        seed_conflict: seedConflict,
        source_trace: sourceTrace,
      },
      aliases: aliasRows.map((row) => ({
        id: row.id,
        alias: row.alias,
        alias_type: row.aliasType,
      })),
      relations: relationRows.map((row) => ({
        id: row.id,
        subject_entity_id: row.subjectEntityId,
        object_entity_id: row.objectEntityId,
        subject_name: nameById.get(row.subjectEntityId) || null,
        object_name: nameById.get(row.objectEntityId) || null,
        predicate: row.predicate,
        relation_type: row.relationType,
        description: row.description,
      })),
    };
  }

  async listEntities(dramaId: number, userId: number, entityType?: string) {
    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph) return { items: [] };
    const rows = await this.databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(
        and(
          eq(dramaGraphEntities.graphId, graph.id),
          isNull(dramaGraphEntities.deletedAt),
          entityType
            ? eq(dramaGraphEntities.entityType, entityType)
            : undefined,
        ),
      )
      .orderBy(
        desc(dramaGraphEntities.importance),
        dramaGraphEntities.canonicalName,
      );

    return {
      items: rows.map((row) => ({
        id: row.id,
        entity_type: row.entityType,
        canonical_name: row.canonicalName,
        display_name: row.displayName,
        role: row.role,
        description: row.description,
        importance: row.importance,
        seed_status: row.seedStatus,
        linked_character_id: row.linkedCharacterId,
        linked_scene_id: row.linkedSceneId,
        linked_prop_id: row.linkedPropId,
        seed_conflict: toRecord(JSON.parse(row.seedConflictJson || "{}")),
      })),
    };
  }

  async listRelations(dramaId: number, userId: number) {
    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph) return { items: [] };

    const entityRows = await this.databaseService.db
      .select({
        id: dramaGraphEntities.id,
        canonicalName: dramaGraphEntities.canonicalName,
        entityType: dramaGraphEntities.entityType,
      })
      .from(dramaGraphEntities)
      .where(
        and(
          eq(dramaGraphEntities.graphId, graph.id),
          isNull(dramaGraphEntities.deletedAt),
        ),
      );

    const entityNameById = new Map(
      entityRows.map((row) => [row.id, row.canonicalName]),
    );
    const relationRows = await this.databaseService.db
      .select()
      .from(dramaGraphRelations)
      .where(
        and(
          eq(dramaGraphRelations.graphId, graph.id),
          isNull(dramaGraphRelations.deletedAt),
        ),
      );

    return {
      items: relationRows.map((row) => ({
        id: row.id,
        subject_entity_id: row.subjectEntityId,
        object_entity_id: row.objectEntityId,
        subject_name: entityNameById.get(row.subjectEntityId) || null,
        object_name: entityNameById.get(row.objectEntityId) || null,
        relation_type: row.relationType,
        predicate: row.predicate,
        description: row.description,
        strength: row.strength,
      })),
    };
  }

  async listEvents(dramaId: number, userId: number) {
    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph) return { items: [] };
    const rows = await this.databaseService.db
      .select()
      .from(dramaGraphEvents)
      .where(eq(dramaGraphEvents.graphId, graph.id))
      .orderBy(dramaGraphEvents.episodeNumber, dramaGraphEvents.id);

    return {
      items: rows.map((row) => ({
        id: row.id,
        event_type: row.eventType,
        title: row.title,
        summary: row.summary,
        episode_id: row.episodeId,
        episode_number: row.episodeNumber,
        script_span_start: row.scriptSpanStart,
        script_span_end: row.scriptSpanEnd,
        emotional_tone: row.emotionalTone,
        importance: row.importance,
      })),
    };
  }

  async getCastSubgraph(
    dramaId: number,
    userId: number,
    episodeNumber?: number,
  ) {
    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph) return { entities: [], relations: [] };

    let entityIds: number[] | null = null;
    if (episodeNumber != null) {
      const eventRows = await this.databaseService.db
        .select({
          involvedEntityIdsJson: dramaGraphEvents.involvedEntityIdsJson,
        })
        .from(dramaGraphEvents)
        .where(
          and(
            eq(dramaGraphEvents.graphId, graph.id),
            eq(dramaGraphEvents.episodeNumber, episodeNumber),
          ),
        );
      entityIds = Array.from(
        new Set(
          eventRows.flatMap(
            (row) => parseJsonArray(row.involvedEntityIdsJson) as number[],
          ),
        ),
      );
    }

    const entityRows = await this.databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(
        and(
          eq(dramaGraphEntities.graphId, graph.id),
          eq(dramaGraphEntities.entityType, "character"),
          isNull(dramaGraphEntities.deletedAt),
          entityIds?.length
            ? inArray(dramaGraphEntities.id, entityIds)
            : undefined,
        ),
      );

    const ids = entityRows.map((row) => row.id);
    const relationRows = ids.length
      ? await this.databaseService.db
          .select()
          .from(dramaGraphRelations)
          .where(
            and(
              eq(dramaGraphRelations.graphId, graph.id),
              isNull(dramaGraphRelations.deletedAt),
              or(
                inArray(dramaGraphRelations.subjectEntityId, ids),
                inArray(dramaGraphRelations.objectEntityId, ids),
              ),
            ),
          )
      : [];

    return {
      entities: entityRows.map((row) => ({
        id: row.id,
        canonical_name: row.canonicalName,
        role: row.role,
      })),
      relations: relationRows.map((row) => ({
        id: row.id,
        subject_entity_id: row.subjectEntityId,
        object_entity_id: row.objectEntityId,
        predicate: row.predicate,
      })),
    };
  }

  async seedAssets(dramaId: number, userId: number) {
    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph || graph.status !== "ready")
      throw new BadRequestException("story_graph_not_ready");
    const stats = await this.seedAssetsInternal(graph.id, dramaId, userId);
    return { seeded: true, stats };
  }

  private resolveWritingId(metadata: Record<string, unknown>) {
    const direct = metadata.source_writing_id;
    if (typeof direct === "number" && Number.isInteger(direct) && direct > 0)
      return direct;
    if (typeof direct === "string" && /^\d+$/.test(direct.trim()))
      return Number(direct.trim());
    return null;
  }

  async getSearchIndexStatus(dramaId: number, userId: number) {
    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph || !this.indexService) {
      return {
        available: false,
        total_chunks: 0,
        by_kind: {},
        embedding_model: null,
        updated_at: null,
        pgvector_enabled: false,
      };
    }
    const status = await this.indexService.getIndexStatus(
      graph.id,
      dramaId,
      userId,
    );
    return { available: true, ...status };
  }

  async searchStoryGraph(
    dramaId: number,
    userId: number,
    input: { query: string; kinds?: string[]; limit?: number },
  ) {
    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph || graph.status !== "ready")
      throw new BadRequestException("story_graph_not_ready");
    if (!this.indexService)
      throw new BadRequestException("story_graph_search_unavailable");

    return this.indexService.search({
      graphId: graph.id,
      dramaId,
      userId,
      query: input.query,
      kinds: input.kinds,
      limit: input.limit,
    });
  }

  async preSeedFromWriting(
    dramaId: number,
    userId: number,
    input?: { writing_id?: number; rebuild_index?: boolean },
  ) {
    const drama = await this.assertOwnedDrama(dramaId, userId);
    const metadata = parseDramaMetadata(drama.metadata);
    const writingId = input?.writing_id || this.resolveWritingId(metadata);
    if (!writingId) throw new BadRequestException("writing_id_required");

    if (!this.indexService)
      throw new BadRequestException("story_graph_search_unavailable");
    const cards = await this.indexService.loadWritingKnowledgeCards(
      writingId,
      userId,
    );
    if (!cards.length) {
      return {
        writing_id: writingId,
        merged_entities: 0,
        indexed_chunks: 0,
      };
    }

    const graph = await this.getActiveGraph(dramaId, userId);
    if (!graph) throw new BadRequestException("story_graph_not_ready");

    const entityRows = await this.databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(
        and(
          eq(dramaGraphEntities.graphId, graph.id),
          isNull(dramaGraphEntities.deletedAt),
        ),
      );

    const extracted = mergeWritingKnowledgeCards(
      {
        entities: entityRows.map((row) => ({
          entityType: row.entityType as "character" | "scene" | "prop",
          canonicalName: row.canonicalName,
          displayName: row.displayName || undefined,
          role: row.role || undefined,
          description: row.description || undefined,
          importance: row.importance || undefined,
          sourceTrace: parseJsonArray(row.sourceTraceJson) as Array<
            Record<string, unknown>
          >,
          aliases: [],
        })),
        relations: [],
        events: [],
      },
      cards,
    );

    const diffStats = await this.persistGraphDiff(
      graph.id,
      dramaId,
      userId,
      extracted,
    );
    let indexStats: {
      chunk_count: number;
      embedding_model: string | null;
    } | null = null;
    if (input?.rebuild_index !== false) {
      const scriptEpisodes = (await this.loadScriptCoverage(dramaId, userId))
        .currentScriptEpisodes;
      indexStats = await this.indexService.rebuildIndex({
        graphId: graph.id,
        dramaId,
        userId,
        scriptEpisodes,
        writingId,
      });
    }

    return {
      writing_id: writingId,
      merged_entities: diffStats.added + diffStats.updated,
      diff: diffStats,
      search_index: indexStats,
    };
  }
}
