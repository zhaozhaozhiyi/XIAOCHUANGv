import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { createHash } from "node:crypto";

import { DatabaseService } from "../../db/database.service";
import {
  aiRuns,
  dramaSourceChunks,
  dramaSources,
  dramas,
  episodes,
  storyboards,
  tasks,
} from "../../db/schema";
import { TaskQueueService } from "../queue/task-queue.service";
import { DramaAgentService } from "./drama-agent.service";
import { parseDramaMetadata, resolveProjectConfigId } from "./drama-metadata";
import { STORY_GRAPH_DOMAIN } from "./drama-story-graph.service";

const TOKEN_PER_SOURCE_CHAR = 1.6;
const DIRECT_TOKEN_LIMIT = 60_000;
const ASYNC_TOKEN_LIMIT = 400_000;
const DEFAULT_CHUNK_TOKENS = 12_000;
const SOURCE_PREVIEW_CHARS = 12_000;
const SOURCE_GLOBAL_SUMMARY_MAX_INPUT_CHARS = 60_000;
const SOURCE_SUMMARY_REDUCE_BATCH_SIZE = 6;
const DEFAULT_EPISODE_BLUEPRINT_BATCH_SIZE = 4;
const MAX_EPISODE_BLUEPRINT_BATCH_SIZE = 8;
const REMOTE_AGENT_MODE = "remote_agent";
const AI_FIRST_TASK_TYPE = "source_analysis";
const AI_FIRST_BRIEF_TASK_TYPE = "adaptation_briefs";
const AI_FIRST_BLUEPRINT_TASK_TYPE = "episode_blueprints";
const AI_FIRST_PILOT_TASK_TYPE = "pilot_scripts";
const AI_FIRST_TASK_SOURCE_TYPE = "drama_ai_first";
const AI_FIRST_SOURCE_DOMAIN = "drama_sources";
const AI_FIRST_BRIEF_DOMAIN = "drama_adaptation_briefs";
const AI_FIRST_BLUEPRINT_DOMAIN = "drama_episode_blueprints";
const AI_FIRST_PILOT_DOMAIN = "drama_pilot_scripts";

type SourceType = "paste" | "upload" | "writing_project";
type EpisodeStaleReason = "source" | "analysis" | "strategy" | "blueprint";
type EpisodeStaleDb = Pick<DatabaseService["db"], "select" | "update">;
type DramaAiFirstStage =
  | "source_pending"
  | "source_ready"
  | "brief_pending"
  | "brief_selected"
  | "blueprint_generating"
  | "blueprint_ready"
  | "script_generating"
  | "script_ready"
  | "graph_building"
  | "graph_ready"
  | "in_production"
  | "deliverable_ready";
type SourceHealth = {
  status: "ok" | "warning" | "blocked";
  word_count: number;
  chapter_count: number;
  estimated_tokens: number;
  over_context_limit: boolean;
  chunk_count: number;
  recommended_mode: "direct" | "long_source" | "long_source_async";
  chapter_index?: Array<{
    chapter_no: number;
    title: string;
    word_count: number;
    brief: string;
  }>;
  anomalies?: Array<{
    type: string;
    severity: "info" | "warning" | "blocked";
    message: string;
    evidence?: string;
  }>;
  named_entity_density?: number | null;
  continuity_score?: number | null;
  generated_at?: string | null;
};

type SourceChunkDraft = {
  sourceId: number;
  chunkNo: number;
  title: string;
  contentStart: number;
  contentEnd: number;
  contentHash: string;
  estimatedTokens: number;
  sourceTrace: string;
};

type SourceAnalysisPayload = {
  theme: string;
  core_conflict: string;
  protagonist: string;
  antagonist?: string | null;
  protagonist_goal: string;
  target_episode_count?: number | null;
  episode_duration?: string | null;
  adaptation_mode?: "faithful" | "moderate_expansion" | "continuation";
  source_completeness?: "complete" | "incomplete" | "uncertain";
  major_beat_count?: number;
  supported_duration_seconds?: { min: number; max: number };
  recommended_episode_count?: { min: number; preferred: number; max: number };
  episode_duration_seconds?: { min: number; max: number };
  recommendation_confidence?: number;
  recommendation_basis?: Array<{
    claim: string;
    source_trace: Array<Record<string, unknown>>;
  }>;
  expansion_notes?: string[];
  relationship_map: Array<Record<string, unknown>>;
  world_rules: string[];
  emotional_curve: Array<Record<string, unknown>>;
  adaptation_risks: string[];
  evidence: Array<{
    claim: string;
    source_trace: Array<Record<string, unknown>>;
  }>;
  ai_run_id: number;
  remote_run_id?: string | null;
  generated_at: string;
  generation_mode: "local_rule_seed" | "remote_agent";
};

type SourceChunkAnalysisPayload = {
  summary: string;
  key_events: string[];
  characters: string[];
  scenes: string[];
  risks: string[];
  source_trace: Array<Record<string, unknown>>;
  ai_run_id?: number | null;
  remote_run_id?: string | null;
  generated_at?: string | null;
};

type SourceChunkAnalysisAggregate = SourceChunkAnalysisPayload & {
  chunk_id?: number;
  chunk_no?: number;
  reduction_level?: number;
};

type AdaptationBriefPayload = {
  id: string;
  name: string;
  claim: string;
  rhythm_model: string;
  target_episode_count: number;
  episode_duration: string;
  style_direction: string;
  hook_density: string;
  retained_points: string[];
  removed_points: string[];
  risk_notes: string[];
  production_cost: string;
  recommended_for: string;
  ai_run_id: number;
  remote_run_id?: string | null;
  generated_at: string;
  generation_mode: "local_rule_seed" | "remote_agent";
};

type AdaptationConfigPayload = {
  target_episode_count: number;
  episode_duration: string;
  style_direction: string;
  aspect_rhythm?: string;
  project_type?: string;
  visual_style?: string;
  target_audience?: string;
};

type AdaptationConfigInput = Partial<AdaptationConfigPayload>;

type EpisodeBlueprintPayload = {
  episode_number: number;
  title: string;
  positioning: string;
  opening_hook: string;
  summary: string;
  source_trace: Array<Record<string, unknown>>;
  characters: string[];
  scenes: string[];
  ending_hook: string;
  risk_notes: string[];
  brief_id: string;
  ai_run_id: number;
  remote_run_id?: string | null;
  generated_at: string;
  generation_mode: "local_rule_seed" | "remote_agent";
};

type DetectedChapter = {
  chapter_no: number;
  title: string;
  start: number;
  end: number;
};

type SaveSourceInput = {
  userId: number;
  dramaId: number;
  content: string;
  title?: string | null;
  sourceType?: SourceType | string | null;
};

type HealthCheckInput = {
  userId: number;
  dramaId: number;
  content?: string | null;
};

type GenerateBriefInput = {
  userId: number;
  dramaId: number;
  count?: number;
  targetEpisodeCount?: number | null;
  episodeDuration?: string | null;
  styleDirection?: string | null;
};

type GenerateBlueprintInput = {
  userId: number;
  dramaId: number;
  replaceWithoutScript?: boolean;
  adaptationConfig?: AdaptationConfigInput;
};

type RegenerateEpisodeBlueprintInput = {
  userId: number;
  episodeId: number;
};

type GenerateEpisodeScriptInput = {
  userId: number;
  episodeId: number;
  rewrite?: boolean;
};

type GeneratePilotScriptsInput = {
  userId: number;
  dramaId: number;
  limit?: number;
  episodeIds?: number[];
};

type SourceAnalysisContext = {
  drama: typeof dramas.$inferSelect;
  metadata: Record<string, unknown>;
  aiFirst: Record<string, unknown>;
  health: SourceHealth;
  source: typeof dramaSources.$inferSelect;
};

type AdaptationBriefContext = {
  drama: typeof dramas.$inferSelect;
  metadata: Record<string, unknown>;
  aiFirst: Record<string, unknown>;
  analysis: SourceAnalysisPayload;
  health: SourceHealth;
  count: number;
  targetEpisodeCount?: number;
  episodeDuration?: string | null;
  styleDirection?: string | null;
};

type EpisodeBlueprintContext = {
  drama: typeof dramas.$inferSelect;
  metadata: Record<string, unknown>;
  aiFirst: Record<string, unknown>;
  health: SourceHealth;
  analysis: SourceAnalysisPayload;
  adaptationConfig: AdaptationConfigPayload;
  effectiveBrief: AdaptationBriefPayload;
  selectedBrief: AdaptationBriefPayload | null;
  existingEpisodes: Array<typeof episodes.$inferSelect>;
  sourceId: number;
  replaceWithoutScript?: boolean;
};

type PilotScriptsContext = {
  drama: typeof dramas.$inferSelect;
  metadata: Record<string, unknown>;
  aiFirst: Record<string, unknown>;
  targets: Array<typeof episodes.$inferSelect>;
  targetCount: number;
};

type AiFirstTaskSummary = {
  id: number;
  type: string;
  status: string;
  title: string | null;
  progress: number | null;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
};

function toRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNumberValue(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeContent(content: string) {
  return content.replace(/\r\n/g, "\n").trim();
}

function countSourceWords(content: string) {
  return content.replace(/\s/g, "").length;
}

function estimateTokensByWordCount(wordCount: number) {
  return Math.ceil(Math.max(wordCount, 0) * TOKEN_PER_SOURCE_CHAR);
}

function hashText(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

function mergeSourceTraces(
  analyses: SourceChunkAnalysisPayload[],
  maxItems = 64,
) {
  const traces: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const analysis of analyses) {
    for (const trace of analysis.source_trace || []) {
      const key = JSON.stringify(trace);
      if (seen.has(key)) continue;
      seen.add(key);
      traces.push(trace);
    }
  }
  if (traces.length <= maxItems) return traces;
  return Array.from({ length: maxItems }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (traces.length - 1)) / Math.max(1, maxItems - 1),
    );
    return traces[sourceIndex];
  });
}

function normalizeSourceType(
  value: SourceType | string | null | undefined,
): SourceType {
  return value === "upload" || value === "writing_project" ? value : "paste";
}

const EPISODE_STALE_SUFFIX_PATTERN =
  /(?:_(?:source|analysis|strategy|blueprint)_stale)+$/;

export function markEpisodeGenerationModeStale(
  mode: string | null | undefined,
  hasScript: boolean,
  reason: EpisodeStaleReason,
) {
  const normalized = String(mode || "").trim();
  const staleSuffix = `_${reason}_stale`;
  if (normalized.endsWith(staleSuffix)) return normalized;
  const base =
    normalized.replace(EPISODE_STALE_SUFFIX_PATTERN, "") ||
    (hasScript ? "script" : "blueprint");
  return `${base}${staleSuffix}`;
}

export function markEpisodeGenerationModeSourceStale(
  mode: string | null | undefined,
  hasScript: boolean,
) {
  return markEpisodeGenerationModeStale(mode, hasScript, "source");
}

export function resolveWholePlanBlueprintState(
  episode: Pick<
    typeof episodes.$inferSelect,
    "scriptContent" | "generationMode"
  >,
  blueprintGenerationMode: string | null | undefined,
) {
  const hasScript = Boolean(episode.scriptContent?.trim());
  const generatedBlueprintMode =
    blueprintGenerationMode === REMOTE_AGENT_MODE
      ? "remote_agent_blueprint"
      : "local_rule_blueprint";

  return {
    generationMode: hasScript
      ? markEpisodeGenerationModeStale(
          episode.generationMode,
          true,
          "blueprint",
        )
      : generatedBlueprintMode,
    status: hasScript ? "script_ready" : "blueprint",
  };
}

export function buildEpisodeBlueprintBatchRanges(
  targetEpisodeCount: number,
  batchSize = DEFAULT_EPISODE_BLUEPRINT_BATCH_SIZE,
) {
  const target = Math.max(0, Math.trunc(targetEpisodeCount));
  const normalizedBatchSize = Number.isFinite(batchSize)
    ? Math.min(
        MAX_EPISODE_BLUEPRINT_BATCH_SIZE,
        Math.max(1, Math.trunc(batchSize)),
      )
    : DEFAULT_EPISODE_BLUEPRINT_BATCH_SIZE;
  const ranges: Array<{ start: number; end: number }> = [];
  for (let start = 1; start <= target; start += normalizedBatchSize) {
    ranges.push({
      start,
      end: Math.min(target, start + normalizedBatchSize - 1),
    });
  }
  return ranges;
}

async function markEpisodeOutputsStale(
  db: EpisodeStaleDb,
  input: {
    userId: number;
    dramaId: number;
    reason: EpisodeStaleReason;
    timestamp: Date;
  },
) {
  const episodeRows = await db
    .select({
      id: episodes.id,
      blueprintPayload: episodes.blueprintPayload,
      generationMode: episodes.generationMode,
      scriptContent: episodes.scriptContent,
    })
    .from(episodes)
    .where(
      and(
        eq(episodes.dramaId, input.dramaId),
        eq(episodes.userId, input.userId),
        isNull(episodes.deletedAt),
      ),
    );

  for (const episode of episodeRows) {
    const hasScript = Boolean(episode.scriptContent?.trim());
    if (!hasScript && !episode.blueprintPayload) continue;
    await db
      .update(episodes)
      .set({
        generationMode: markEpisodeGenerationModeStale(
          episode.generationMode,
          hasScript,
          input.reason,
        ),
        updatedAt: input.timestamp,
      })
      .where(
        and(eq(episodes.id, episode.id), eq(episodes.userId, input.userId)),
      );
  }
}

function looksLikeApiEnvelope(content: string) {
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  return (
    /"code"\s*:/.test(trimmed) &&
    /"message"\s*:/.test(trimmed) &&
    /"data"\s*:/.test(trimmed)
  );
}

function looksLikeHtmlDocument(content: string) {
  const trimmed = content.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<body")
  );
}

function isChapterHeading(line: string) {
  const normalized = line.trim();
  if (!normalized || normalized.length > 90) return false;
  return /^(?:#{1,6}\s*)?(?:第\s*[0-9０-９一二三四五六七八九十百千万零〇两俩]+\s*[章节集卷回幕]|chapter\s*\d+|episode\s*\d+|ep\.?\s*\d+)/i.test(
    normalized,
  );
}

function detectChapters(content: string): DetectedChapter[] {
  const lines = content.split("\n");
  const markers: Array<{ title: string; start: number }> = [];
  let offset = 0;

  for (const line of lines) {
    const lineStart = offset;
    const lineEnd = lineStart + line.length;
    if (isChapterHeading(line)) {
      markers.push({
        title: line.trim().replace(/^#{1,6}\s*/, ""),
        start: lineStart,
      });
    }
    offset = lineEnd + 1;
  }

  if (!markers.length) {
    return content.trim()
      ? [{ chapter_no: 1, title: "全文", start: 0, end: content.length }]
      : [];
  }

  return markers.map((marker, index) => ({
    chapter_no: index + 1,
    title: marker.title || `第 ${index + 1} 章`,
    start: marker.start,
    end: markers[index + 1]?.start ?? content.length,
  }));
}

function buildChapterIndex(content: string, chapters: DetectedChapter[]) {
  return chapters.map((chapter) => {
    const chapterContent = content.slice(chapter.start, chapter.end).trim();
    const brief = chapterContent.replace(/\s+/g, " ").slice(0, 120);
    return {
      chapter_no: chapter.chapter_no,
      title: chapter.title,
      word_count: countSourceWords(chapterContent),
      brief,
    };
  });
}

function countDuplicateParagraphs(content: string) {
  const seen = new Map<string, number>();
  for (const paragraph of content.split(/\n{2,}/)) {
    const normalized = paragraph.replace(/\s+/g, "");
    if (normalized.length < 40) continue;
    seen.set(normalized, (seen.get(normalized) || 0) + 1);
  }
  return Array.from(seen.values()).filter((count) => count > 1).length;
}

function buildHealth(content: string): SourceHealth {
  const normalized = normalizeContent(content);
  const wordCount = countSourceWords(normalized);
  const estimatedTokens = estimateTokensByWordCount(wordCount);
  const chapters = detectChapters(normalized);
  const chapterIndex = buildChapterIndex(normalized, chapters);
  const anomalies: NonNullable<SourceHealth["anomalies"]> = [];

  if (!normalized) {
    anomalies.push({
      type: "empty_source",
      severity: "blocked",
      message: "源稿内容为空，请重新导入完整正文。",
    });
  } else if (looksLikeApiEnvelope(normalized)) {
    anomalies.push({
      type: "api_envelope",
      severity: "blocked",
      message: "源稿看起来像接口返回 JSON，不是可改编正文。",
      evidence: normalized.slice(0, 160),
    });
  } else if (looksLikeHtmlDocument(normalized)) {
    anomalies.push({
      type: "html_document",
      severity: "blocked",
      message: "源稿看起来像 HTML 页面，不是可改编正文。",
      evidence: normalized.slice(0, 160),
    });
  }

  if (normalized && wordCount < 3_000) {
    anomalies.push({
      type: "too_short",
      severity: "warning",
      message: "源稿篇幅偏短，可以分析，但可能不足以支撑完整短剧改编。",
    });
  }

  if (normalized && chapters.length <= 1) {
    anomalies.push({
      type: "chapter_index_missing",
      severity: "warning",
      message: "未识别到明确章节结构，系统会按全文或 token 分块处理。",
    });
  }

  const duplicateParagraphs = countDuplicateParagraphs(normalized);
  if (duplicateParagraphs > 0) {
    anomalies.push({
      type: "duplicate_paragraphs",
      severity: "warning",
      message: `检测到 ${duplicateParagraphs} 处疑似重复段落，建议检查源稿是否重复粘贴。`,
    });
  }

  const hasBlockedIssue = anomalies.some(
    (anomaly) => anomaly.severity === "blocked",
  );
  const hasWarningIssue = anomalies.some(
    (anomaly) => anomaly.severity === "warning",
  );
  const recommendedMode: SourceHealth["recommended_mode"] =
    estimatedTokens > ASYNC_TOKEN_LIMIT
      ? "long_source_async"
      : estimatedTokens > DIRECT_TOKEN_LIMIT
        ? "long_source"
        : "direct";
  const overContextLimit = recommendedMode !== "direct";
  const chunkCount =
    overContextLimit && !hasBlockedIssue
      ? buildChunkRanges(
          normalized,
          Math.max(
            1_000,
            Math.floor(DEFAULT_CHUNK_TOKENS / TOKEN_PER_SOURCE_CHAR),
          ),
        ).length
      : 0;

  return {
    status: hasBlockedIssue ? "blocked" : hasWarningIssue ? "warning" : "ok",
    word_count: wordCount,
    chapter_count: chapterIndex.length,
    estimated_tokens: estimatedTokens,
    over_context_limit: overContextLimit,
    chunk_count: chunkCount,
    recommended_mode: recommendedMode,
    chapter_index: chapterIndex,
    anomalies,
    named_entity_density: null,
    continuity_score: null,
    generated_at: new Date().toISOString(),
  };
}

function buildChunks(content: string, sourceId: number, health: SourceHealth) {
  if (!health.over_context_limit || health.status === "blocked") return [];

  const maxChars = Math.max(
    1_000,
    Math.floor(DEFAULT_CHUNK_TOKENS / TOKEN_PER_SOURCE_CHAR),
  );
  const ranges = buildChunkRanges(content, maxChars);
  return ranges.map((range, index) => {
    const chunkText = content.slice(range.contentStart, range.contentEnd);
    const chunkNo = index + 1;
    const sourceTrace = range.trace.length
      ? range.trace
      : [
          {
            source_id: sourceId,
            content_start: range.contentStart,
            content_end: range.contentEnd,
          },
        ];

    return {
      sourceId,
      chunkNo,
      title: range.title || `分块 ${chunkNo}`,
      contentStart: range.contentStart,
      contentEnd: range.contentEnd,
      contentHash: hashText(chunkText),
      estimatedTokens: estimateTokensByWordCount(countSourceWords(chunkText)),
      sourceTrace: JSON.stringify(
        sourceTrace.map((item) => ({ source_id: sourceId, ...item })),
      ),
    };
  });
}

function buildChunkRanges(content: string, maxChars: number) {
  const chapters = detectChapters(content);
  const ranges: Array<{
    title: string;
    contentStart: number;
    contentEnd: number;
    trace: Array<Record<string, unknown>>;
  }> = [];
  let group: DetectedChapter[] = [];

  const flushGroup = () => {
    if (!group.length) return;
    const first = group[0];
    const last = group[group.length - 1];
    ranges.push({
      title:
        group.length === 1 ? first.title : `${first.title} - ${last.title}`,
      contentStart: first.start,
      contentEnd: last.end,
      trace: group.map((chapter) => ({
        chapter_no: chapter.chapter_no,
        chapter_title: chapter.title,
        content_start: chapter.start,
        content_end: chapter.end,
      })),
    });
    group = [];
  };

  const sourceRanges = chapters.length
    ? chapters
    : [{ chapter_no: 1, title: "全文", start: 0, end: content.length }];

  for (const chapter of sourceRanges) {
    const chapterLength = chapter.end - chapter.start;
    if (chapterLength > maxChars) {
      flushGroup();
      const parts = splitRangeByBoundary(
        content,
        chapter.start,
        chapter.end,
        maxChars,
      );
      for (const [partIndex, part] of parts.entries()) {
        ranges.push({
          title:
            parts.length > 1
              ? `${chapter.title} - ${partIndex + 1}`
              : chapter.title,
          contentStart: part.start,
          contentEnd: part.end,
          trace: [
            {
              chapter_no: chapter.chapter_no,
              chapter_title: chapter.title,
              content_start: part.start,
              content_end: part.end,
            },
          ],
        });
      }
      continue;
    }

    if (!group.length) {
      group.push(chapter);
      continue;
    }

    const groupStart = group[0].start;
    if (chapter.end - groupStart <= maxChars) {
      group.push(chapter);
    } else {
      flushGroup();
      group.push(chapter);
    }
  }

  flushGroup();
  return ranges;
}

function splitRangeByBoundary(
  content: string,
  rangeStart: number,
  rangeEnd: number,
  maxChars: number,
) {
  const ranges: Array<{ start: number; end: number }> = [];
  let start = rangeStart;

  while (start < rangeEnd) {
    const hardEnd = Math.min(rangeEnd, start + maxChars);
    let end = chooseChunkBoundary(content, start, hardEnd, maxChars, rangeEnd);
    if (end <= start) end = hardEnd;
    ranges.push({ start, end });
    start = end;
    while (start < rangeEnd && /[\r\n]/.test(content[start] || "")) start += 1;
  }

  return ranges;
}

function chooseChunkBoundary(
  content: string,
  start: number,
  hardEnd: number,
  maxChars: number,
  rangeEnd: number,
) {
  if (hardEnd >= rangeEnd) return rangeEnd;

  const minEnd = start + Math.floor(maxChars * 0.6);
  const slice = content.slice(start, hardEnd);
  const paragraphBreak = slice.lastIndexOf("\n\n");
  if (paragraphBreak >= 0 && start + paragraphBreak >= minEnd)
    return start + paragraphBreak;

  const lineBreak = slice.lastIndexOf("\n");
  if (lineBreak >= 0 && start + lineBreak >= minEnd) return start + lineBreak;

  for (
    let index = slice.length - 1;
    index >= Math.max(0, minEnd - start);
    index -= 1
  ) {
    if ("。！？!?；;".includes(slice[index])) return start + index + 1;
  }

  return hardEnd;
}

function pickAiFirstStage(health: SourceHealth): DramaAiFirstStage {
  return health.status === "blocked" ? "source_pending" : "source_ready";
}

function buildNovelSourcePreview(input: {
  sourceType: SourceType;
  title: string;
  content: string;
  health: SourceHealth;
  importedAt: string;
  contentHash: string;
}) {
  return {
    type: input.sourceType,
    title: input.title,
    content: input.content.slice(0, SOURCE_PREVIEW_CHARS),
    content_preview: input.content.slice(0, SOURCE_PREVIEW_CHARS),
    content_truncated: input.content.length > SOURCE_PREVIEW_CHARS,
    content_hash: input.contentHash,
    word_count: input.health.word_count,
    chapter_count: input.health.chapter_count,
    imported_at: input.importedAt,
    chapter_index: input.health.chapter_index || [],
  };
}

function compactText(value: unknown, maxLength: number) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function firstNonEmpty<T>(items: T[], fallback: T) {
  return items.find((item) => Boolean(String(item || "").trim())) ?? fallback;
}

function pickLikelyCharacterNames(content: string) {
  const denylist = new Set([
    "旁白",
    "字幕",
    "镜头",
    "系统",
    "众人",
    "大家",
    "我们",
    "他们",
  ]);
  const counts = new Map<string, number>();

  for (const match of content.matchAll(
    /([\u4e00-\u9fa5]{1,4})(?:说|问|喊|笑|看|推开|走进|回头|皱眉|沉默|冷笑|握住)/g,
  )) {
    const name = String(match[1] || "").trim();
    if (!name || denylist.has(name)) continue;
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  for (const match of content.matchAll(
    /(?:主角|女主|男主|少女|少年|总裁|医生|律师|皇帝|王爷|夫人|小姐)[：:，,]?([\u4e00-\u9fa5]{1,4})/g,
  )) {
    const name = String(match[1] || "").trim();
    if (!name || denylist.has(name)) continue;
    counts.set(name, (counts.get(name) || 0) + 2);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([name]) => name)
    .slice(0, 6);
}

function pickSceneNames(
  chapterIndex: NonNullable<SourceHealth["chapter_index"]>,
  content: string,
) {
  const names = new Set<string>();
  for (const match of content.matchAll(
    /(?:在|到|回到|来到)([\u4e00-\u9fa5]{2,8})(?:里|中|前|后|门口|大厅|房间|院子|街头|医院|公司|学校|宫殿|客厅|书房)/g,
  )) {
    const name = String(match[1] || "").trim();
    if (name) names.add(name);
    if (names.size >= 6) break;
  }
  for (const chapter of chapterIndex.slice(0, 6)) {
    if (names.size >= 6) break;
    names.add(chapter.title);
  }
  return [...names].slice(0, 6);
}

function createSourceTrace(sourceId: number, health: SourceHealth, index = 0) {
  const chapter =
    health.chapter_index?.[index % Math.max(health.chapter_index.length, 1)];
  return [
    {
      source_id: sourceId,
      chapter_no: chapter?.chapter_no ?? null,
      chapter_title: chapter?.title ?? null,
      excerpt: chapter?.brief ?? null,
    },
  ];
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return compactText(error.message, 500);
  return compactText(error, 500) || "remote_agent_failed";
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseJsonArray(
  value: string | null | undefined,
): Array<Record<string, unknown>> {
  const parsed = parseJsonValue(value);
  return Array.isArray(parsed) ? parsed.map((item) => toRecord(item)) : [];
}

function toNumberArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function readBooleanEnv(name: string, defaultValue: boolean) {
  const value = process.env[name];
  if (value == null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return defaultValue;
}

function readEpisodeBlueprintBatchSize() {
  const configured = Number(process.env.DRAMA_AGENT_BLUEPRINT_BATCH_SIZE);
  return Number.isFinite(configured) && configured > 0
    ? Math.min(MAX_EPISODE_BLUEPRINT_BATCH_SIZE, Math.trunc(configured))
    : DEFAULT_EPISODE_BLUEPRINT_BATCH_SIZE;
}

function readAiFirst(metadataValue: string | null | undefined) {
  const metadata = parseDramaMetadata(metadataValue);
  return { metadata, aiFirst: toRecord(metadata.ai_first) };
}

function readSourceHealth(
  aiFirst: Record<string, unknown>,
): SourceHealth | null {
  const health = toRecord(aiFirst.source_health);
  if (!health.status) return null;
  return health as SourceHealth;
}

function readSourceAnalysis(
  aiFirst: Record<string, unknown>,
): SourceAnalysisPayload | null {
  const analysis = toRecord(aiFirst.source_analysis);
  if (!analysis.theme && !analysis.core_conflict) return null;
  return analysis as SourceAnalysisPayload;
}

function readAdaptationBriefs(aiFirst: Record<string, unknown>) {
  return Array.isArray(aiFirst.adaptation_briefs)
    ? (aiFirst.adaptation_briefs as AdaptationBriefPayload[])
    : [];
}

function estimateTargetEpisodeCountFromSourceHealth(
  health: SourceHealth | null | undefined,
) {
  if (!health) return 24;
  const chapterCount = Math.max(0, Number(health.chapter_count) || 0);
  const wordCount = Math.max(0, Number(health.word_count) || 0);
  const chapterEstimate =
    chapterCount > 0 ? Math.ceil(Math.max(chapterCount, 3) * 1.5) : 0;
  const wordEstimate = wordCount > 0 ? Math.ceil(wordCount / 900) : 0;
  const estimate = Math.max(chapterEstimate, wordEstimate, 3);
  return Math.min(80, Math.max(1, estimate));
}

function readAdaptationConfig(
  aiFirst: Record<string, unknown>,
  metadata: Record<string, unknown>,
  drama: typeof dramas.$inferSelect,
  health?: SourceHealth | null,
): AdaptationConfigPayload {
  const raw = toRecord(aiFirst.adaptation_config);
  const plan = toRecord(metadata.adaptation_plan);
  const briefs = readAdaptationBriefs(aiFirst);
  const selectedBrief = briefs.find(
    (brief) => brief.id === toStringValue(aiFirst.selected_brief_id),
  );
  const analysis = readSourceAnalysis(aiFirst);

  const targetEpisodeCount = Number(
    raw.target_episode_count ||
      selectedBrief?.target_episode_count ||
      plan.target_episode_count ||
      analysis?.target_episode_count ||
      drama.totalEpisodes ||
      estimateTargetEpisodeCountFromSourceHealth(health),
  );

  return {
    target_episode_count: Math.max(
      1,
      Number.isFinite(targetEpisodeCount)
        ? targetEpisodeCount
        : estimateTargetEpisodeCountFromSourceHealth(health),
    ),
    episode_duration:
      toStringValue(raw.episode_duration) ||
      selectedBrief?.episode_duration ||
      toStringValue(plan.episode_duration) ||
      toStringValue(analysis?.episode_duration) ||
      "60-90 秒",
    style_direction:
      toStringValue(raw.style_direction) ||
      selectedBrief?.style_direction ||
      drama.style ||
      "精品短剧",
    aspect_rhythm:
      toStringValue(raw.aspect_rhythm) ||
      toStringValue(plan.aspect_rhythm) ||
      "16:9 · 高密度钩子",
    project_type:
      toStringValue(raw.project_type) ||
      selectedBrief?.rhythm_model ||
      "精品剧",
    visual_style:
      toStringValue(raw.visual_style) ||
      toStringValue(plan.visual_style) ||
      drama.style ||
      "",
    target_audience:
      toStringValue(raw.target_audience) ||
      selectedBrief?.recommended_for ||
      "短剧平台",
  };
}

function synthesizeBriefFromConfig(
  config: AdaptationConfigPayload,
  analysis: SourceAnalysisPayload,
): AdaptationBriefPayload {
  return {
    id: "adaptation-config",
    name: "改编配置",
    claim: compactText(analysis.theme || analysis.core_conflict, 120),
    rhythm_model: config.aspect_rhythm || config.project_type || "精品剧",
    target_episode_count: config.target_episode_count,
    episode_duration: config.episode_duration,
    style_direction: config.style_direction,
    hook_density: "高密度",
    retained_points: [analysis.protagonist, analysis.core_conflict].filter(
      Boolean,
    ),
    removed_points: [],
    risk_notes: analysis.adaptation_risks || [],
    production_cost: "中",
    recommended_for: config.target_audience || "短剧平台",
    ai_run_id: 0,
    generated_at: new Date().toISOString(),
    generation_mode: "local_rule_seed",
  };
}

@Injectable()
export class DramaAiFirstService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Optional()
    @Inject(DramaAgentService)
    private readonly dramaAgentService?: DramaAgentService,
    @Optional()
    @Inject(TaskQueueService)
    private readonly taskQueueService?: TaskQueueService,
  ) {}

  buildSourceHealth(content: string) {
    return buildHealth(content);
  }

  private async persistAdaptationConfig(input: GenerateBlueprintInput) {
    if (!input.adaptationConfig) return;
    const override = input.adaptationConfig;
    if (!Object.keys(override).length) return;

    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, input.dramaId),
          eq(dramas.userId, input.userId),
          isNull(dramas.deletedAt),
        ),
      )
      .limit(1);
    if (!drama) throw new NotFoundException("drama_not_found");

    const { metadata, aiFirst } = readAiFirst(drama.metadata);
    const existingExplicitConfig = toRecord(
      aiFirst.adaptation_config ?? metadata.adaptation_config,
    );
    const next: Record<string, unknown> = { ...existingExplicitConfig };
    if (Object.prototype.hasOwnProperty.call(override, "target_episode_count")) {
      const targetEpisodeCount = Number(override.target_episode_count);
      if (Number.isFinite(targetEpisodeCount)) {
        next.target_episode_count = Math.max(1, targetEpisodeCount);
      }
    }
    if (Object.prototype.hasOwnProperty.call(override, "episode_duration")) {
      const value = toStringValue(override.episode_duration);
      if (value) next.episode_duration = value;
    }
    if (Object.prototype.hasOwnProperty.call(override, "style_direction")) {
      const value = toStringValue(override.style_direction);
      if (value) next.style_direction = value;
    }
    if (Object.prototype.hasOwnProperty.call(override, "visual_style")) {
      const value = toStringValue(override.visual_style);
      if (value) next.visual_style = value;
    }
    if (Object.prototype.hasOwnProperty.call(override, "aspect_rhythm")) {
      const value = toStringValue(override.aspect_rhythm);
      if (value) next.aspect_rhythm = value;
    }

    const updates: Record<string, unknown> = {
      metadata: JSON.stringify({
        ...metadata,
        ai_first: {
          ...aiFirst,
          adaptation_config: next,
          ai_first_updated_at: new Date().toISOString(),
        },
      }),
      updatedAt: new Date(),
    };
    const explicitTargetEpisodeCount = Number(next.target_episode_count);
    if (Number.isFinite(explicitTargetEpisodeCount) && explicitTargetEpisodeCount > 0) {
      updates.totalEpisodes = explicitTargetEpisodeCount;
    }

    await this.databaseService.db
      .update(dramas)
      .set(updates)
      .where(
        and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
      );
  }

  buildSourceChunks(
    content: string,
    sourceId: number,
    health: SourceHealth,
  ): SourceChunkDraft[] {
    return buildChunks(content, sourceId, health);
  }

  private assertAiFirstEnabled() {
    if (!readBooleanEnv("DRAMA_AI_FIRST_ENABLED", true)) {
      throw new BadRequestException("drama_ai_first_disabled");
    }
  }

  private shouldUseLocalRuleFallback() {
    return readBooleanEnv(
      "DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK",
      process.env.NODE_ENV === "test",
    );
  }

  private buildAiFirstAgentRequiredError(mode: string) {
    return new BadRequestException(`drama_ai_first_agent_required:${mode}`);
  }

  async getAiFirst(dramaId: number, userId: number) {
    this.assertAiFirstEnabled();
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, dramaId),
          eq(dramas.userId, userId),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) throw new NotFoundException("drama_not_found");

    return this.buildAiFirstPayload(drama);
  }

  async saveSource(input: SaveSourceInput) {
    this.assertAiFirstEnabled();
    const content = normalizeContent(input.content);
    if (!content) throw new BadRequestException("source_content_required");

    const sourceType = normalizeSourceType(input.sourceType);
    const health = buildHealth(content);
    const contentHash = hashText(content);
    const importedAt = new Date().toISOString();
    const title = input.title?.trim() || "未命名源稿";

    await this.databaseService.db.transaction(async (tx) => {
      const [drama] = await tx
        .select()
        .from(dramas)
        .where(
          and(
            eq(dramas.id, input.dramaId),
            eq(dramas.userId, input.userId),
            isNull(dramas.deletedAt),
          ),
        );

      if (!drama) throw new NotFoundException("drama_not_found");

      const metadata = parseDramaMetadata(drama.metadata);
      const aiFirst = toRecord(metadata.ai_first);
      const previousHash = toStringValue(aiFirst.content_hash);
      const sourceChanged = previousHash !== contentHash;
      const ts = new Date();

      const [source] = await tx
        .insert(dramaSources)
        .values({
          userId: input.userId,
          dramaId: input.dramaId,
          sourceType,
          title,
          contentHash,
          content,
          wordCount: health.word_count,
          estimatedTokens: health.estimated_tokens,
          chapterCount: health.chapter_count,
          status: health.status === "blocked" ? "blocked" : "ready",
          createdAt: ts,
          updatedAt: ts,
        })
        .returning();

      const chunkDrafts = buildChunks(content, source.id, health);
      if (chunkDrafts.length) {
        await tx.insert(dramaSourceChunks).values(
          chunkDrafts.map((chunk) => ({
            userId: input.userId,
            dramaId: input.dramaId,
            sourceId: chunk.sourceId,
            chunkNo: chunk.chunkNo,
            title: chunk.title,
            contentStart: chunk.contentStart,
            contentEnd: chunk.contentEnd,
            contentHash: chunk.contentHash,
            estimatedTokens: chunk.estimatedTokens,
            sourceTrace: chunk.sourceTrace,
            status: "pending",
            createdAt: ts,
            updatedAt: ts,
          })),
        );
      }

      const nextMetadata: Record<string, unknown> = {
        ...metadata,
        novel_source: buildNovelSourcePreview({
          sourceType,
          title,
          content,
          health,
          importedAt,
          contentHash,
        }),
        ai_first: {
          ...aiFirst,
          source_id: source.id,
          source_title: title,
          source_type: sourceType,
          content_hash: contentHash,
          source_health: health,
          source_analysis: sourceChanged
            ? null
            : (aiFirst.source_analysis ?? null),
          adaptation_briefs: sourceChanged
            ? []
            : Array.isArray(aiFirst.adaptation_briefs)
              ? aiFirst.adaptation_briefs
              : [],
          selected_brief_id: sourceChanged
            ? ""
            : toStringValue(aiFirst.selected_brief_id),
          ai_first_stage: pickAiFirstStage(health),
          source_chunk_count: chunkDrafts.length,
          source_imported_at: importedAt,
          ai_first_updated_at: importedAt,
        },
      };

      if (metadata.adaptation_plan) {
        nextMetadata.legacy_adaptation_plan = metadata.adaptation_plan;
        nextMetadata.adaptation_plan = null;
        nextMetadata.adaptation_plan_invalidated_at = importedAt;
      }

      if (sourceChanged) {
        await markEpisodeOutputsStale(tx, {
          userId: input.userId,
          dramaId: input.dramaId,
          reason: "source",
          timestamp: ts,
        });
      }

      await tx
        .update(dramas)
        .set({
          metadata: JSON.stringify(nextMetadata),
          updatedAt: ts,
        })
        .where(
          and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
        );

      return { source_id: source.id };
    });

    return this.getAiFirst(input.dramaId, input.userId);
  }

  async healthCheck(input: HealthCheckInput) {
    this.assertAiFirstEnabled();
    if (input.content != null) {
      return { source_health: buildHealth(input.content) };
    }

    const [source] = await this.databaseService.db
      .select()
      .from(dramaSources)
      .where(
        and(
          eq(dramaSources.dramaId, input.dramaId),
          eq(dramaSources.userId, input.userId),
          isNull(dramaSources.deletedAt),
        ),
      )
      .orderBy(desc(dramaSources.createdAt))
      .limit(1);

    if (!source) throw new NotFoundException("source_not_found");

    const health = buildHealth(source.content);
    const metadataUpdatedAt = new Date().toISOString();
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, input.dramaId),
          eq(dramas.userId, input.userId),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) throw new NotFoundException("drama_not_found");

    const metadata = parseDramaMetadata(drama.metadata);
    const aiFirst = toRecord(metadata.ai_first);
    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...metadata,
          ai_first: {
            ...aiFirst,
            source_health: health,
            ai_first_stage: pickAiFirstStage(health),
            ai_first_updated_at: metadataUpdatedAt,
          },
        }),
        updatedAt: new Date(),
      })
      .where(
        and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
      );

    return { source_health: health };
  }

  async analyzeSource(input: { userId: number; dramaId: number }) {
    this.assertAiFirstEnabled();
    const context = await this.loadSourceAnalysisContext(input);
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);

    if (!useRemoteAgent && !this.shouldUseLocalRuleFallback()) {
      throw this.buildAiFirstAgentRequiredError("source_analysis");
    }
    if (!this.taskQueueService) {
      throw new BadRequestException("source_analysis_queue_unavailable");
    }
    const task = await this.createOrReuseSourceAnalysisTask(context);
    await this.markSourceAnalysisTaskQueuedInMetadata(context, task.id);
    await this.taskQueueService.enqueueTask(task.id);
    return this.getAiFirst(input.dramaId, input.userId);
  }

  async executeSourceAnalysisTask(input: {
    taskId: number;
    userId: number;
    dramaId: number;
    sourceId: number;
  }) {
    await this.updateSourceAnalysisTask(input.taskId, {
      status: "running",
      progress: 3,
      startedAt: new Date(),
      completedAt: null,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      resultSummaryJson: JSON.stringify({
        phase: "loading_source",
        source_id: input.sourceId,
      }),
    });

    try {
      const result = await this.analyzeSourceNow(input);
      const resultAnalysis = toRecord(result.source_analysis);
      await this.completeSourceAnalysisTask(input.taskId, {
        source_id: input.sourceId,
        drama_id: input.dramaId,
        phase: "completed",
        generation_mode: toStringValue(resultAnalysis.generation_mode) || null,
      });
      return result;
    } catch (error) {
      await this.failSourceAnalysisTask(input.taskId, error);
      throw error;
    }
  }

  private async analyzeSourceNow(input: {
    userId: number;
    dramaId: number;
    sourceId?: number;
    taskId?: number;
  }) {
    const { drama, metadata, aiFirst, health, source } =
      await this.loadSourceAnalysisContext(input);
    if (input.taskId && Number(aiFirst.source_id) !== source.id) {
      throw new ConflictException("source_analysis_task_outdated");
    }

    const generatedAt = new Date().toISOString();
    let run: typeof aiRuns.$inferSelect;
    let analysis: SourceAnalysisPayload;

    if (input.taskId) {
      await this.updateSourceAnalysisTask(input.taskId, {
        status: "running",
        progress: health.over_context_limit ? 5 : 30,
        resultSummaryJson: JSON.stringify({
          phase: health.over_context_limit
            ? "chunk_analysis"
            : "source_analysis",
          source_id: source.id,
          total_chunks: health.chunk_count,
        }),
      });
    }

    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);

    if (useRemoteAgent) {
      try {
        if (health.over_context_limit) {
          const longSource = await this.analyzeLongSourceWithRemoteAgent({
            userId: input.userId,
            dramaId: input.dramaId,
            dramaTitle: drama.title,
            source,
            health,
            generatedAt,
            taskId: input.taskId,
          });
          run = longSource.run;
          analysis = longSource.analysis;
        } else {
          const agent = await this.dramaAgentService!.analyzeSource({
            userId: input.userId,
            dramaId: input.dramaId,
            dramaTitle: drama.title,
            sourceId: source.id,
            content: source.content,
            health,
          });
          run = await this.recordRemoteRun({
            userId: input.userId,
            dramaId: input.dramaId,
            skillId: "drama_source_analyzer",
            mode: "source_analysis",
            userMessage: `Analyze drama source ${source.id}`,
            remoteRunId: agent.remoteRunId,
            usage: agent.usage,
            result: agent.analysis,
          });
          analysis = {
            ...agent.analysis,
            ai_run_id: run.id,
            remote_run_id: agent.remoteRunId,
            generated_at: generatedAt,
            generation_mode: REMOTE_AGENT_MODE,
          };
        }
      } catch (error) {
        await this.recordRemoteFailure({
          userId: input.userId,
          dramaId: input.dramaId,
          skillId: "drama_source_analyzer",
          mode: "source_analysis",
          userMessage: `Analyze drama source ${source.id}`,
          error,
        });
        throw error;
      }
    } else if (this.shouldUseLocalRuleFallback()) {
      run = await this.recordLocalRun({
        userId: input.userId,
        dramaId: input.dramaId,
        skillId: "drama_source_analyzer",
        mode: "source_analysis",
        userMessage: `Analyze drama source ${source.id}`,
      });
      analysis = this.buildLocalSourceAnalysis({
        dramaTitle: drama.title,
        sourceId: source.id,
        content: source.content,
        health,
        aiRunId: run.id,
      });
    } else {
      throw this.buildAiFirstAgentRequiredError("source_analysis");
    }

    if (input.taskId && !health.over_context_limit) {
      await this.updateSourceAnalysisTask(input.taskId, {
        status: "running",
        progress: 95,
        resultSummaryJson: JSON.stringify({
          phase: "writing_analysis",
          source_id: source.id,
        }),
      });
    }

    const updatedAt = new Date();
    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(dramas)
        .set({
          metadata: JSON.stringify({
            ...metadata,
            ai_first: {
              ...aiFirst,
              source_analysis: analysis,
              adaptation_briefs: [],
              selected_brief_id: "",
              source_analysis_task_id:
                input.taskId ||
                toNumberValue(aiFirst.source_analysis_task_id) ||
                null,
              source_analysis_task_status: input.taskId
                ? "completed"
                : toStringValue(aiFirst.source_analysis_task_status),
              ai_first_stage: "source_ready",
              ai_first_updated_at: generatedAt,
            },
          }),
          updatedAt,
        })
        .where(
          and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
        );

      await markEpisodeOutputsStale(tx, {
        userId: input.userId,
        dramaId: input.dramaId,
        reason: "analysis",
        timestamp: updatedAt,
      });
    });

    if (
      health.over_context_limit &&
      analysis.generation_mode !== REMOTE_AGENT_MODE
    ) {
      await this.databaseService.db
        .update(dramaSourceChunks)
        .set({
          status: "ready",
          aiRunId: String(run.id),
          remoteRunId: analysis.remote_run_id || null,
          updatedAt,
        })
        .where(
          and(
            eq(dramaSourceChunks.sourceId, source.id),
            eq(dramaSourceChunks.userId, input.userId),
          ),
        );
    }

    return this.getAiFirst(input.dramaId, input.userId);
  }

  private async loadSourceAnalysisContext(input: {
    userId: number;
    dramaId: number;
    sourceId?: number;
  }): Promise<SourceAnalysisContext> {
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, input.dramaId),
          eq(dramas.userId, input.userId),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) throw new NotFoundException("drama_not_found");

    const { metadata, aiFirst } = readAiFirst(drama.metadata);
    const health = readSourceHealth(aiFirst);
    if (!health) throw new BadRequestException("source_health_required");
    if (health.status === "blocked")
      throw new BadRequestException("source_blocked");

    const metadataSourceId = Number(aiFirst.source_id);
    const sourceId =
      Number.isInteger(input.sourceId) && Number(input.sourceId) > 0
        ? Number(input.sourceId)
        : Number.isInteger(metadataSourceId) && metadataSourceId > 0
          ? metadataSourceId
          : null;
    const [source] = sourceId
      ? await this.databaseService.db
          .select()
          .from(dramaSources)
          .where(
            and(
              eq(dramaSources.id, sourceId),
              eq(dramaSources.dramaId, input.dramaId),
              eq(dramaSources.userId, input.userId),
              isNull(dramaSources.deletedAt),
            ),
          )
          .limit(1)
      : await this.databaseService.db
          .select()
          .from(dramaSources)
          .where(
            and(
              eq(dramaSources.dramaId, input.dramaId),
              eq(dramaSources.userId, input.userId),
              isNull(dramaSources.deletedAt),
            ),
          )
          .orderBy(desc(dramaSources.createdAt))
          .limit(1);

    if (!source) throw new NotFoundException("source_not_found");
    return { drama, metadata, aiFirst, health, source };
  }

  private async createOrReuseSourceAnalysisTask(
    context: SourceAnalysisContext,
  ) {
    const timestamp = new Date();
    const title = compactText(
      `AI-first 源稿理解：${context.source.title || context.drama.title}`,
      120,
    );
    const payload = {
      operation: "drama_ai_first_source_analysis",
      drama_id: context.drama.id,
      source_id: context.source.id,
      content_hash: context.source.contentHash,
      recommended_mode: context.health.recommended_mode,
      total_chunks: context.health.chunk_count,
    };
    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, AI_FIRST_SOURCE_DOMAIN),
          eq(tasks.domainId, context.source.id),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);

    if (existing && ["queued", "running"].includes(existing.status)) {
      await this.updateSourceAnalysisTask(existing.id, {
        title,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify({
          phase: existing.status,
          source_id: context.source.id,
          total_chunks: context.health.chunk_count,
        }),
      });
      return { ...existing, title };
    }

    if (existing) {
      const [updated] = await this.databaseService.db
        .update(tasks)
        .set({
          userId: context.drama.userId,
          type: AI_FIRST_TASK_TYPE,
          status: "queued",
          title,
          progress: 0,
          sourceType: AI_FIRST_TASK_SOURCE_TYPE,
          dramaId: context.drama.id,
          episodeId: null,
          storyboardId: null,
          aiConfigId: null,
          providerTaskId: null,
          attemptCount:
            existing.status === "failed" || existing.status === "dead_letter"
              ? 0
              : existing.attemptCount,
          lockedBy: null,
          lockedAt: null,
          lockExpiresAt: null,
          payloadJson: JSON.stringify(payload),
          resultSummaryJson: JSON.stringify({
            phase: "queued",
            source_id: context.source.id,
            total_chunks: context.health.chunk_count,
          }),
          errorKind: null,
          errorMessage: null,
          errorDetailsJson: null,
          startedAt: null,
          completedAt: null,
          updatedAt: timestamp,
        })
        .where(eq(tasks.id, existing.id))
        .returning();
      return updated;
    }

    const [task] = await this.databaseService.db
      .insert(tasks)
      .values({
        userId: context.drama.userId,
        type: AI_FIRST_TASK_TYPE,
        status: "queued",
        title,
        progress: 0,
        sourceType: AI_FIRST_TASK_SOURCE_TYPE,
        dramaId: context.drama.id,
        domainTable: AI_FIRST_SOURCE_DOMAIN,
        domainId: context.source.id,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify({
          phase: "queued",
          source_id: context.source.id,
          total_chunks: context.health.chunk_count,
        }),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return task;
  }

  private async markSourceAnalysisTaskQueuedInMetadata(
    context: SourceAnalysisContext,
    taskId: number,
  ) {
    const nowIso = new Date().toISOString();
    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...context.metadata,
          ai_first: {
            ...context.aiFirst,
            source_analysis_task_id: taskId,
            source_analysis_task_status: "queued",
            ai_first_updated_at: nowIso,
          },
        }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(dramas.id, context.drama.id),
          eq(dramas.userId, context.source.userId),
        ),
      );
  }

  private async updateSourceAnalysisTask(
    taskId: number,
    values: Partial<typeof tasks.$inferInsert>,
  ) {
    await this.databaseService.db
      .update(tasks)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
  }

  private async completeSourceAnalysisTask(
    taskId: number,
    summary: Record<string, unknown>,
  ) {
    const timestamp = new Date();
    await this.databaseService.db
      .update(tasks)
      .set({
        status: "completed",
        progress: 100,
        resultSummaryJson: JSON.stringify(summary),
        errorKind: null,
        errorMessage: null,
        errorDetailsJson: null,
        completedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId));
  }

  async failSourceAnalysisTask(taskId: number, error: unknown) {
    const message = getErrorMessage(error);
    const timestamp = new Date();
    await this.databaseService.db
      .update(tasks)
      .set({
        status: "failed",
        errorKind: message.toLowerCase().includes("outdated")
          ? "outdated"
          : "provider",
        errorMessage: compactText(message, 500),
        errorDetailsJson: JSON.stringify({
          error_kind: message.toLowerCase().includes("outdated")
            ? "outdated"
            : "provider",
          raw_error: message,
        }),
        completedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId));
  }

  async generateAdaptationBriefs(input: GenerateBriefInput) {
    this.assertAiFirstEnabled();
    const context = await this.loadAdaptationBriefContext(input);
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);

    if (this.taskQueueService) {
      if (!useRemoteAgent && !this.shouldUseLocalRuleFallback()) {
        throw this.buildAiFirstAgentRequiredError("adaptation_briefs");
      }
      const task = await this.createOrReuseAdaptationBriefsTask(context);
      await this.markAdaptationBriefsTaskQueued(context, task.id);
      await this.taskQueueService.enqueueTask(task.id);
      return this.getAiFirst(input.dramaId, input.userId);
    }

    return this.generateAdaptationBriefsNow(input);
  }

  async executeAdaptationBriefsTask(
    input: GenerateBriefInput & { taskId: number },
  ) {
    await this.updateAdaptationBriefsTask(input.taskId, {
      status: "running",
      progress: 5,
      startedAt: new Date(),
      completedAt: null,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      resultSummaryJson: JSON.stringify({
        phase: "loading_context",
        drama_id: input.dramaId,
      }),
    });

    try {
      const result = await this.generateAdaptationBriefsNow(input);
      await this.completeAdaptationBriefsTask(input.taskId, {
        phase: "completed",
        drama_id: input.dramaId,
      });
      return result;
    } catch (error) {
      await this.failAdaptationBriefsTask(input.taskId, error);
      throw error;
    }
  }

  private async generateAdaptationBriefsNow(
    input: GenerateBriefInput & { taskId?: number },
  ) {
    const {
      drama,
      metadata,
      aiFirst,
      analysis,
      health,
      count,
      targetEpisodeCount,
      episodeDuration,
      styleDirection,
    } = await this.loadAdaptationBriefContext(input);

    if (input.taskId) {
      await this.updateAdaptationBriefsTask(input.taskId, {
        status: "running",
        progress: 20,
        resultSummaryJson: JSON.stringify({
          phase: "adaptation_briefs",
          drama_id: input.dramaId,
          target_episode_count:
            targetEpisodeCount ||
            analysis.target_episode_count ||
            drama.totalEpisodes ||
            null,
          brief_count: count,
        }),
      });
    }

    await this.assertAiFirstTaskNotCanceled(input.taskId);
    const generatedAt = new Date().toISOString();
    let briefs: AdaptationBriefPayload[];
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);

    if (useRemoteAgent) {
      try {
        const agent = await this.dramaAgentService!.generateAdaptationBriefs({
          userId: input.userId,
          dramaId: input.dramaId,
          dramaTitle: drama.title,
          analysis,
          health,
          count,
          targetEpisodeCount:
            targetEpisodeCount ||
            analysis.target_episode_count ||
            drama.totalEpisodes ||
            undefined,
          episodeDuration,
          styleDirection: styleDirection || drama.style,
        });
        const run = await this.recordRemoteRun({
          userId: input.userId,
          dramaId: input.dramaId,
          skillId: "drama_adaptation_brief_generator",
          mode: "adaptation_briefs",
          userMessage: `Generate adaptation briefs for drama ${input.dramaId}`,
          remoteRunId: agent.remoteRunId,
          usage: agent.usage,
          result: agent.briefs,
        });
        briefs = agent.briefs.map((brief, index) => ({
          ...brief,
          id: brief.id || `brief-${run.id}-${index + 1}`,
          ai_run_id: run.id,
          remote_run_id: agent.remoteRunId,
          generated_at: generatedAt,
          generation_mode: REMOTE_AGENT_MODE,
        }));
      } catch (error) {
        await this.recordRemoteFailure({
          userId: input.userId,
          dramaId: input.dramaId,
          skillId: "drama_adaptation_brief_generator",
          mode: "adaptation_briefs",
          userMessage: `Generate adaptation briefs for drama ${input.dramaId}`,
          error,
        });
        throw error;
      }
    } else if (this.shouldUseLocalRuleFallback()) {
      const run = await this.recordLocalRun({
        userId: input.userId,
        dramaId: input.dramaId,
        skillId: "drama_adaptation_brief_generator",
        mode: "adaptation_briefs",
        userMessage: `Generate adaptation briefs for drama ${input.dramaId}`,
      });
      briefs = this.buildLocalAdaptationBriefs({
        dramaTitle: drama.title,
        analysis,
        health,
        count,
        targetEpisodeCount:
          targetEpisodeCount ||
          analysis.target_episode_count ||
          drama.totalEpisodes ||
          undefined,
        episodeDuration,
        styleDirection: styleDirection || drama.style,
        aiRunId: run.id,
        generatedAt,
      });
    } else {
      throw this.buildAiFirstAgentRequiredError("adaptation_briefs");
    }

    await this.assertAiFirstTaskNotCanceled(input.taskId);
    if (input.taskId) {
      await this.updateAdaptationBriefsTask(input.taskId, {
        status: "running",
        progress: 82,
        resultSummaryJson: JSON.stringify({
          phase: "writing_briefs",
          drama_id: input.dramaId,
          brief_count: briefs.length,
        }),
      });
    }

    const updatedAt = new Date();
    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(dramas)
        .set({
          metadata: JSON.stringify({
            ...metadata,
            ai_first: {
              ...aiFirst,
              adaptation_briefs: briefs,
              selected_brief_id: "",
              ai_first_stage: "brief_pending",
              brief_task_id:
                input.taskId || toNumberValue(aiFirst.brief_task_id) || null,
              brief_task_status: input.taskId
                ? "completed"
                : toStringValue(aiFirst.brief_task_status),
              ai_first_updated_at: generatedAt,
            },
          }),
          updatedAt,
        })
        .where(
          and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
        );

      await markEpisodeOutputsStale(tx, {
        userId: input.userId,
        dramaId: input.dramaId,
        reason: "strategy",
        timestamp: updatedAt,
      });
    });

    return this.getAiFirst(input.dramaId, input.userId);
  }

  private async loadAdaptationBriefContext(
    input: GenerateBriefInput,
  ): Promise<AdaptationBriefContext> {
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, input.dramaId),
          eq(dramas.userId, input.userId),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) throw new NotFoundException("drama_not_found");

    const { metadata, aiFirst } = readAiFirst(drama.metadata);
    const analysis = readSourceAnalysis(aiFirst);
    const health = readSourceHealth(aiFirst);
    if (!health || health.status === "blocked")
      throw new BadRequestException("usable_source_required");
    if (!analysis) throw new BadRequestException("source_analysis_required");

    const count = Math.min(3, Math.max(2, input.count || 2));
    return {
      drama,
      metadata,
      aiFirst,
      analysis,
      health,
      count,
      targetEpisodeCount: input.targetEpisodeCount || undefined,
      episodeDuration: input.episodeDuration,
      styleDirection: input.styleDirection,
    };
  }

  private async createOrReuseAdaptationBriefsTask(
    context: AdaptationBriefContext,
  ) {
    const timestamp = new Date();
    const title = compactText(`AI-first 改编策略：${context.drama.title}`, 120);
    const payload = {
      operation: "drama_ai_first_adaptation_briefs",
      drama_id: context.drama.id,
      source_id: toNumberValue(context.aiFirst.source_id) || null,
      content_hash: toStringValue(context.aiFirst.content_hash) || null,
      count: context.count,
      target_episode_count:
        context.targetEpisodeCount ||
        context.analysis.target_episode_count ||
        context.drama.totalEpisodes ||
        null,
      episode_duration: context.episodeDuration || null,
      style_direction: context.styleDirection || context.drama.style || null,
    };
    const summary = {
      phase: "queued",
      drama_id: context.drama.id,
      brief_count: context.count,
      target_episode_count: payload.target_episode_count,
    };
    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, AI_FIRST_BRIEF_DOMAIN),
          eq(tasks.domainId, context.drama.id),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);

    if (existing && ["queued", "running"].includes(existing.status)) {
      await this.updateAdaptationBriefsTask(existing.id, {
        title,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify({
          ...summary,
          phase: existing.status,
        }),
      });
      return { ...existing, title };
    }

    if (existing) {
      const [updated] = await this.databaseService.db
        .update(tasks)
        .set({
          userId: context.drama.userId,
          type: AI_FIRST_BRIEF_TASK_TYPE,
          status: "queued",
          title,
          progress: 0,
          sourceType: AI_FIRST_TASK_SOURCE_TYPE,
          dramaId: context.drama.id,
          episodeId: null,
          storyboardId: null,
          aiConfigId: null,
          providerTaskId: null,
          attemptCount:
            existing.status === "failed" || existing.status === "dead_letter"
              ? 0
              : existing.attemptCount,
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
        })
        .where(eq(tasks.id, existing.id))
        .returning();
      return updated;
    }

    const [task] = await this.databaseService.db
      .insert(tasks)
      .values({
        userId: context.drama.userId,
        type: AI_FIRST_BRIEF_TASK_TYPE,
        status: "queued",
        title,
        progress: 0,
        sourceType: AI_FIRST_TASK_SOURCE_TYPE,
        dramaId: context.drama.id,
        domainTable: AI_FIRST_BRIEF_DOMAIN,
        domainId: context.drama.id,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify(summary),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return task;
  }

  private async markAdaptationBriefsTaskQueued(
    context: AdaptationBriefContext,
    taskId: number,
  ) {
    const timestamp = new Date();
    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...context.metadata,
          ai_first: {
            ...context.aiFirst,
            ai_first_stage: "brief_pending",
            brief_task_id: taskId,
            brief_task_status: "queued",
            ai_first_updated_at: timestamp.toISOString(),
          },
        }),
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(dramas.id, context.drama.id),
          eq(dramas.userId, Number(context.drama.userId)),
        ),
      );
  }

  private async updateAdaptationBriefsTask(
    taskId: number,
    values: Partial<typeof tasks.$inferInsert>,
  ) {
    await this.databaseService.db
      .update(tasks)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
  }

  private async completeAdaptationBriefsTask(
    taskId: number,
    summary: Record<string, unknown>,
  ) {
    const timestamp = new Date();
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const currentSummary = toRecord(parseJsonValue(task?.resultSummaryJson));
    await this.databaseService.db
      .update(tasks)
      .set({
        status: "completed",
        progress: 100,
        resultSummaryJson: JSON.stringify({
          ...currentSummary,
          ...summary,
          phase: "completed",
        }),
        errorKind: null,
        errorMessage: null,
        errorDetailsJson: null,
        completedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId));
  }

  async failAdaptationBriefsTask(taskId: number, error: unknown) {
    const message = getErrorMessage(error);
    const canceled = message.toLowerCase().includes("cancel");
    const errorKind = canceled ? "canceled" : "provider";
    const timestamp = new Date();
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const currentSummary = toRecord(parseJsonValue(task?.resultSummaryJson));

    await this.databaseService.db
      .update(tasks)
      .set({
        status: canceled ? "canceled" : "failed",
        errorKind,
        errorMessage: compactText(message, 500),
        errorDetailsJson: JSON.stringify({
          error_kind: errorKind,
          raw_error: message,
        }),
        resultSummaryJson: JSON.stringify({
          ...currentSummary,
          phase: canceled ? "canceled" : "failed",
        }),
        completedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId));

    if (task?.dramaId && task.userId) {
      const [drama] = await this.databaseService.db
        .select()
        .from(dramas)
        .where(
          and(
            eq(dramas.id, task.dramaId),
            eq(dramas.userId, task.userId),
            isNull(dramas.deletedAt),
          ),
        )
        .limit(1);
      if (drama) {
        const { metadata, aiFirst } = readAiFirst(drama.metadata);
        await this.databaseService.db
          .update(dramas)
          .set({
            metadata: JSON.stringify({
              ...metadata,
              ai_first: {
                ...aiFirst,
                ai_first_stage:
                  toStringValue(aiFirst.ai_first_stage) || "brief_pending",
                brief_task_id: taskId,
                brief_task_status: canceled ? "canceled" : "failed",
                ai_first_updated_at: timestamp.toISOString(),
              },
            }),
            updatedAt: timestamp,
          })
          .where(and(eq(dramas.id, drama.id), eq(dramas.userId, task.userId)));
      }
    }
  }

  async selectAdaptationBrief(input: {
    userId: number;
    dramaId: number;
    briefId: string;
  }) {
    this.assertAiFirstEnabled();
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, input.dramaId),
          eq(dramas.userId, input.userId),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) throw new NotFoundException("drama_not_found");

    const { metadata, aiFirst } = readAiFirst(drama.metadata);
    const briefs = readAdaptationBriefs(aiFirst);
    if (!briefs.some((brief) => brief.id === input.briefId))
      throw new NotFoundException("adaptation_brief_not_found");
    const nowIso = new Date().toISOString();

    const updatedAt = new Date();
    const selectedBriefChanged =
      toStringValue(aiFirst.selected_brief_id) !== input.briefId;
    await this.databaseService.db.transaction(async (tx) => {
      await tx
        .update(dramas)
        .set({
          metadata: JSON.stringify({
            ...metadata,
            ai_first: {
              ...aiFirst,
              selected_brief_id: input.briefId,
              ai_first_stage: "brief_selected",
              ai_first_updated_at: nowIso,
            },
          }),
          updatedAt,
        })
        .where(
          and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
        );

      if (selectedBriefChanged) {
        await markEpisodeOutputsStale(tx, {
          userId: input.userId,
          dramaId: input.dramaId,
          reason: "strategy",
          timestamp: updatedAt,
        });
      }
    });

    return this.getAiFirst(input.dramaId, input.userId);
  }

  async generateEpisodeBlueprints(input: GenerateBlueprintInput) {
    this.assertAiFirstEnabled();
    await this.persistAdaptationConfig(input);
    const context = await this.loadEpisodeBlueprintContext(input);
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);

    if (this.taskQueueService) {
      if (!useRemoteAgent && !this.shouldUseLocalRuleFallback()) {
        throw this.buildAiFirstAgentRequiredError("episode_blueprints");
      }
      const task = await this.createOrReuseEpisodeBlueprintsTask(context);
      await this.markEpisodeBlueprintsTaskQueued(context, task.id);
      await this.taskQueueService.enqueueTask(task.id);
      return this.getAiFirst(input.dramaId, input.userId);
    }

    return this.generateEpisodeBlueprintsNow(input);
  }

  async executeEpisodeBlueprintsTask(
    input: GenerateBlueprintInput & { taskId: number },
  ) {
    await this.updateEpisodeBlueprintsTask(input.taskId, {
      status: "running",
      progress: 3,
      startedAt: new Date(),
      completedAt: null,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      resultSummaryJson: JSON.stringify({
        phase: "loading_context",
        drama_id: input.dramaId,
      }),
    });

    try {
      const result = await this.generateEpisodeBlueprintsNow(input);
      await this.completeEpisodeBlueprintsTask(input.taskId, {
        phase: "completed",
        drama_id: input.dramaId,
      });
      return result;
    } catch (error) {
      await this.failEpisodeBlueprintsTask(input.taskId, error);
      throw error;
    }
  }

  private async generateEpisodeBlueprintsNow(
    input: GenerateBlueprintInput & { taskId?: number },
  ) {
    const context = await this.loadEpisodeBlueprintContext(input);
    const {
      drama,
      metadata,
      aiFirst,
      health,
      analysis,
      effectiveBrief,
      existingEpisodes,
      sourceId,
    } = context;

    if (input.taskId) {
      await this.updateEpisodeBlueprintsTask(input.taskId, {
        status: "running",
        progress: 12,
        resultSummaryJson: JSON.stringify({
          phase: "blueprint_generate",
          drama_id: input.dramaId,
          selected_brief_id: effectiveBrief.id,
          target_episodes: effectiveBrief.target_episode_count,
        }),
      });
    }

    await this.assertAiFirstTaskNotCanceled(input.taskId);
    const generatedAt = new Date().toISOString();
    let blueprints: EpisodeBlueprintPayload[];
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);

    if (useRemoteAgent) {
      blueprints = [];
      const ranges = buildEpisodeBlueprintBatchRanges(
        effectiveBrief.target_episode_count,
        readEpisodeBlueprintBatchSize(),
      );
      let previousBlueprint: EpisodeBlueprintPayload | null = null;

      for (const range of ranges) {
        await this.assertAiFirstTaskNotCanceled(input.taskId);
        const userMessage = `Generate episode blueprints ${range.start}-${range.end} for brief ${effectiveBrief.id}`;
        try {
          const agent = await this.dramaAgentService!.generateEpisodeBlueprints({
            userId: input.userId,
            dramaId: input.dramaId,
            sourceId,
            health,
            analysis,
            brief: effectiveBrief,
            episodeStart: range.start,
            episodeEnd: range.end,
            previousBlueprint,
          });
          const run = await this.recordRemoteRun({
            userId: input.userId,
            dramaId: input.dramaId,
            skillId: "drama_episode_blueprint_generator",
            mode: "episode_blueprints",
            userMessage,
            remoteRunId: agent.remoteRunId,
            usage: agent.usage,
            result: agent.blueprints,
          });
          const batch: EpisodeBlueprintPayload[] = agent.blueprints.map((blueprint) => ({
            ...blueprint,
            brief_id: blueprint.brief_id || effectiveBrief.id,
            ai_run_id: run.id,
            remote_run_id: agent.remoteRunId,
            generated_at: generatedAt,
            generation_mode: REMOTE_AGENT_MODE,
          }));
          blueprints.push(...batch);
          previousBlueprint = batch[batch.length - 1] || previousBlueprint;
        } catch (error) {
          await this.recordRemoteFailure({
            userId: input.userId,
            dramaId: input.dramaId,
            skillId: "drama_episode_blueprint_generator",
            mode: "episode_blueprints",
            userMessage,
            error,
          });
          throw error;
        }

        await this.assertAiFirstTaskNotCanceled(input.taskId);
        if (input.taskId) {
          await this.updateEpisodeBlueprintsTask(input.taskId, {
            status: "running",
            progress: 12 + Math.round(
              (blueprints.length / effectiveBrief.target_episode_count) * 60,
            ),
            resultSummaryJson: JSON.stringify({
              phase: "blueprint_generate",
              drama_id: input.dramaId,
              selected_brief_id: effectiveBrief.id,
              target_episodes: effectiveBrief.target_episode_count,
              generated_episodes: blueprints.length,
              current_range: [range.start, range.end],
            }),
          });
        }
      }
    } else if (this.shouldUseLocalRuleFallback()) {
      const run = await this.recordLocalRun({
        userId: input.userId,
        dramaId: input.dramaId,
        skillId: "drama_episode_blueprint_generator",
        mode: "episode_blueprints",
        userMessage: `Generate episode blueprints for brief ${effectiveBrief.id}`,
      });
      blueprints = this.buildLocalEpisodeBlueprints({
        sourceId,
        health,
        analysis,
        brief: effectiveBrief,
        aiRunId: run.id,
        generatedAt,
      });
    } else {
      throw this.buildAiFirstAgentRequiredError("episode_blueprints");
    }

    await this.assertAiFirstTaskNotCanceled(input.taskId);
    if (input.taskId) {
      await this.updateEpisodeBlueprintsTask(input.taskId, {
        status: "running",
        progress: 78,
        resultSummaryJson: JSON.stringify({
          phase: "writing_blueprints",
          drama_id: input.dramaId,
          selected_brief_id: effectiveBrief.id,
          total_episodes: blueprints.length,
        }),
      });
    }
    const ts = new Date();

    await this.databaseService.db.transaction(async (tx) => {
      const generatedEpisodeNumbers = new Set(
        blueprints.map((blueprint) => blueprint.episode_number),
      );
      for (const blueprint of blueprints) {
        const existing = existingEpisodes.find(
          (episode) => episode.episodeNumber === blueprint.episode_number,
        );
        if (existing) {
          if (existing.scriptContent?.trim() && !input.replaceWithoutScript)
            continue;
          const nextState = resolveWholePlanBlueprintState(
            existing,
            blueprint.generation_mode,
          );
          await tx
            .update(episodes)
            .set({
              title: blueprint.title,
              description: blueprint.summary,
              blueprintPayload: JSON.stringify(blueprint),
              sourceTrace: JSON.stringify(blueprint.source_trace),
              generationMode: nextState.generationMode,
              failureReason: null,
              status: nextState.status,
              updatedAt: ts,
            })
            .where(
              and(
                eq(episodes.id, existing.id),
                eq(episodes.userId, input.userId),
              ),
            );
        } else {
          await tx.insert(episodes).values({
            userId: input.userId,
            dramaId: input.dramaId,
            episodeNumber: blueprint.episode_number,
            title: blueprint.title,
            description: blueprint.summary,
            blueprintPayload: JSON.stringify(blueprint),
            sourceTrace: JSON.stringify(blueprint.source_trace),
            generationMode:
              blueprint.generation_mode === REMOTE_AGENT_MODE
                ? "remote_agent_blueprint"
                : "local_rule_blueprint",
            status: "blueprint",
            imageConfigId: resolveProjectConfigId(drama.metadata, "image"),
            videoConfigId: resolveProjectConfigId(drama.metadata, "video"),
            audioConfigId: resolveProjectConfigId(drama.metadata, "audio"),
            createdAt: ts,
            updatedAt: ts,
          });
        }
      }

      if (input.replaceWithoutScript) {
        for (const existing of existingEpisodes) {
          if (generatedEpisodeNumbers.has(existing.episodeNumber)) continue;
          const hasScript = Boolean(existing.scriptContent?.trim());
          if (!hasScript && !existing.blueprintPayload) continue;
          await tx
            .update(episodes)
            .set({
              generationMode: markEpisodeGenerationModeStale(
                existing.generationMode,
                hasScript,
                "blueprint",
              ),
              updatedAt: ts,
            })
            .where(
              and(
                eq(episodes.id, existing.id),
                eq(episodes.userId, input.userId),
              ),
            );
        }
      }

      await tx
        .update(dramas)
        .set({
          totalEpisodes: Math.max(drama.totalEpisodes || 0, blueprints.length),
          metadata: JSON.stringify({
            ...metadata,
            ai_first: {
              ...aiFirst,
              ai_first_stage: "blueprint_ready",
              blueprint_task_id:
                input.taskId ||
                toNumberValue(aiFirst.blueprint_task_id) ||
                null,
              blueprint_task_status: input.taskId
                ? "completed"
                : toStringValue(aiFirst.blueprint_task_status),
              ai_first_updated_at: generatedAt,
            },
          }),
          updatedAt: ts,
        })
        .where(
          and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
        );
    });

    return this.getAiFirst(input.dramaId, input.userId);
  }

  async regenerateEpisodeBlueprint(input: RegenerateEpisodeBlueprintInput) {
    this.assertAiFirstEnabled();
    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, input.episodeId),
          eq(episodes.userId, input.userId),
          isNull(episodes.deletedAt),
        ),
      )
      .limit(1);
    if (!episode) throw new NotFoundException("episode_not_found");

    const context = await this.loadEpisodeBlueprintContext({
      userId: input.userId,
      dramaId: episode.dramaId,
      replaceWithoutScript: true,
    });
    const targetEpisode = context.existingEpisodes.find(
      (item) => item.id === episode.id,
    );
    if (!targetEpisode) throw new NotFoundException("episode_not_found");
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);
    if (!useRemoteAgent && !this.shouldUseLocalRuleFallback()) {
      throw this.buildAiFirstAgentRequiredError("episode_blueprints");
    }

    const generatedAt = new Date().toISOString();
    let blueprint: EpisodeBlueprintPayload;
    if (useRemoteAgent) {
      try {
        const agent =
          await this.dramaAgentService!.generateSingleEpisodeBlueprint({
            userId: input.userId,
            dramaId: episode.dramaId,
            episodeId: episode.id,
            episodeNumber: episode.episodeNumber,
            sourceId: context.sourceId,
            health: context.health,
            analysis: context.analysis,
            brief: context.effectiveBrief,
            previousBlueprint: this.parseBlueprint(episode.blueprintPayload),
          });
        const run = await this.recordRemoteRun({
          userId: input.userId,
          dramaId: episode.dramaId,
          skillId: "drama_episode_blueprint_generator",
          mode: "episode_blueprint_regenerate",
          userMessage: `Regenerate episode blueprint for episode ${episode.id}`,
          remoteRunId: agent.remoteRunId,
          usage: agent.usage,
          result: agent.blueprint,
        });
        blueprint = {
          ...agent.blueprint,
          episode_number: episode.episodeNumber,
          brief_id: agent.blueprint.brief_id || context.effectiveBrief.id,
          ai_run_id: run.id,
          remote_run_id: agent.remoteRunId,
          generated_at: generatedAt,
          generation_mode: REMOTE_AGENT_MODE,
        };
      } catch (error) {
        await this.recordRemoteFailure({
          userId: input.userId,
          dramaId: episode.dramaId,
          skillId: "drama_episode_blueprint_generator",
          mode: "episode_blueprint_regenerate",
          userMessage: `Regenerate episode blueprint for episode ${episode.id}`,
          error,
        });
        throw error;
      }
    } else {
      const run = await this.recordLocalRun({
        userId: input.userId,
        dramaId: episode.dramaId,
        skillId: "drama_episode_blueprint_generator",
        mode: "episode_blueprint_regenerate",
        userMessage: `Regenerate episode blueprint for episode ${episode.id}`,
      });
      const blueprints = this.buildLocalEpisodeBlueprints({
        sourceId: context.sourceId,
        health: context.health,
        analysis: context.analysis,
        brief: {
          ...context.effectiveBrief,
          target_episode_count: Math.max(
            context.effectiveBrief.target_episode_count || 1,
            episode.episodeNumber,
          ),
        },
        aiRunId: run.id,
        generatedAt,
      });
      const selectedBlueprint = blueprints.find(
        (item) => item.episode_number === episode.episodeNumber,
      );
      if (!selectedBlueprint)
        throw new BadRequestException("episode_blueprint_required");
      blueprint = selectedBlueprint;
    }

    const ts = new Date();
    const hasScript = Boolean(episode.scriptContent?.trim());
    const nextGenerationMode = hasScript
      ? markEpisodeGenerationModeStale(
          episode.generationMode,
          true,
          "blueprint",
        )
      : blueprint.generation_mode === REMOTE_AGENT_MODE
        ? "remote_agent_blueprint"
        : "local_rule_blueprint";
    const nextStatus = hasScript
      ? episode.status && episode.status !== "failed"
        ? episode.status
        : "script_ready"
      : "blueprint";

    let updatedEpisode: typeof episodes.$inferSelect | null = null;
    await this.databaseService.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(episodes)
        .set({
          title: blueprint.title,
          description: blueprint.summary,
          blueprintPayload: JSON.stringify(blueprint),
          sourceTrace: JSON.stringify(blueprint.source_trace),
          generationMode: nextGenerationMode,
          failureReason: null,
          status: nextStatus,
          updatedAt: ts,
        })
        .where(
          and(eq(episodes.id, episode.id), eq(episodes.userId, input.userId)),
        )
        .returning();
      updatedEpisode = updated || null;

      await tx
        .update(dramas)
        .set({
          totalEpisodes: Math.max(
            context.drama.totalEpisodes || 0,
            episode.episodeNumber,
          ),
          metadata: JSON.stringify({
            ...context.metadata,
            ai_first: {
              ...context.aiFirst,
              ai_first_stage: "blueprint_ready",
              latest_episode_blueprint_ai_run_id: blueprint.ai_run_id,
              latest_episode_blueprint_episode_id: episode.id,
              ai_first_updated_at: generatedAt,
            },
          }),
          updatedAt: ts,
        })
        .where(
          and(eq(dramas.id, episode.dramaId), eq(dramas.userId, input.userId)),
        );
    });

    if (!updatedEpisode) throw new NotFoundException("episode_not_found");
    return updatedEpisode;
  }

  private async loadEpisodeBlueprintContext(
    input: GenerateBlueprintInput,
  ): Promise<EpisodeBlueprintContext> {
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, input.dramaId),
          eq(dramas.userId, input.userId),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) throw new NotFoundException("drama_not_found");

    const { metadata, aiFirst } = readAiFirst(drama.metadata);
    const health = readSourceHealth(aiFirst);
    const analysis = readSourceAnalysis(aiFirst);
    const briefs = readAdaptationBriefs(aiFirst);
    const selectedBriefId = toStringValue(aiFirst.selected_brief_id);
    const selectedBrief =
      briefs.find((brief) => brief.id === selectedBriefId) || null;
    if (!health || !analysis)
      throw new BadRequestException("source_analysis_required");

    const adaptationConfig = readAdaptationConfig(
      aiFirst,
      metadata,
      drama,
      health,
    );
    const effectiveBrief =
      selectedBrief || synthesizeBriefFromConfig(adaptationConfig, analysis);

    const existingEpisodes = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.dramaId, input.dramaId),
          eq(episodes.userId, input.userId),
          isNull(episodes.deletedAt),
        ),
      )
      .orderBy(episodes.episodeNumber);
    if (
      existingEpisodes.some((episode) => episode.scriptContent?.trim()) &&
      !input.replaceWithoutScript
    ) {
      throw new ConflictException("episodes_with_script_exist");
    }

    const sourceId = Number(aiFirst.source_id) || 0;
    return {
      drama,
      metadata,
      aiFirst,
      health,
      analysis,
      adaptationConfig,
      effectiveBrief,
      selectedBrief,
      existingEpisodes,
      sourceId,
      replaceWithoutScript: input.replaceWithoutScript,
    };
  }

  private async createOrReuseEpisodeBlueprintsTask(
    context: EpisodeBlueprintContext,
  ) {
    const timestamp = new Date();
    const title = compactText(`AI-first 分集蓝图：${context.drama.title}`, 120);
    const payload = {
      operation: "drama_ai_first_episode_blueprints",
      drama_id: context.drama.id,
      source_id: context.sourceId,
      content_hash: toStringValue(context.aiFirst.content_hash) || null,
      selected_brief_id: context.selectedBrief?.id || null,
      adaptation_config: context.adaptationConfig,
      target_episode_count: context.adaptationConfig.target_episode_count,
      replace_without_script: Boolean(context.replaceWithoutScript),
    };
    const summary = {
      phase: "queued",
      drama_id: context.drama.id,
      selected_brief_id: context.selectedBrief?.id || null,
      target_episode_count: context.adaptationConfig.target_episode_count,
      generated_episodes: 0,
    };
    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, AI_FIRST_BLUEPRINT_DOMAIN),
          eq(tasks.domainId, context.drama.id),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);

    if (existing && ["queued", "running"].includes(existing.status)) {
      await this.updateEpisodeBlueprintsTask(existing.id, {
        title,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify({
          ...summary,
          phase: existing.status,
        }),
      });
      return { ...existing, title };
    }

    if (existing) {
      const [updated] = await this.databaseService.db
        .update(tasks)
        .set({
          userId: context.drama.userId,
          type: AI_FIRST_BLUEPRINT_TASK_TYPE,
          status: "queued",
          title,
          progress: 0,
          sourceType: AI_FIRST_TASK_SOURCE_TYPE,
          dramaId: context.drama.id,
          episodeId: null,
          storyboardId: null,
          aiConfigId: null,
          providerTaskId: null,
          attemptCount:
            existing.status === "failed" || existing.status === "dead_letter"
              ? 0
              : existing.attemptCount,
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
        })
        .where(eq(tasks.id, existing.id))
        .returning();
      return updated;
    }

    const [task] = await this.databaseService.db
      .insert(tasks)
      .values({
        userId: context.drama.userId,
        type: AI_FIRST_BLUEPRINT_TASK_TYPE,
        status: "queued",
        title,
        progress: 0,
        sourceType: AI_FIRST_TASK_SOURCE_TYPE,
        dramaId: context.drama.id,
        domainTable: AI_FIRST_BLUEPRINT_DOMAIN,
        domainId: context.drama.id,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify(summary),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return task;
  }

  private async markEpisodeBlueprintsTaskQueued(
    context: EpisodeBlueprintContext,
    taskId: number,
  ) {
    const timestamp = new Date();
    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...context.metadata,
          ai_first: {
            ...context.aiFirst,
            ai_first_stage: "blueprint_generating",
            blueprint_task_id: taskId,
            blueprint_task_status: "queued",
            ai_first_updated_at: timestamp.toISOString(),
          },
        }),
        updatedAt: timestamp,
      })
      .where(
        and(
          eq(dramas.id, context.drama.id),
          eq(dramas.userId, Number(context.drama.userId)),
        ),
      );
  }

  private async updateEpisodeBlueprintsTask(
    taskId: number,
    values: Partial<typeof tasks.$inferInsert>,
  ) {
    await this.databaseService.db
      .update(tasks)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
  }

  private async completeEpisodeBlueprintsTask(
    taskId: number,
    summary: Record<string, unknown>,
  ) {
    const timestamp = new Date();
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const currentSummary = toRecord(parseJsonValue(task?.resultSummaryJson));
    await this.databaseService.db
      .update(tasks)
      .set({
        status: "completed",
        progress: 100,
        resultSummaryJson: JSON.stringify({
          ...currentSummary,
          ...summary,
          phase: "completed",
        }),
        errorKind: null,
        errorMessage: null,
        errorDetailsJson: null,
        completedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId));
  }

  async failEpisodeBlueprintsTask(taskId: number, error: unknown) {
    const message = getErrorMessage(error);
    const canceled = message.toLowerCase().includes("cancel");
    const errorKind = canceled ? "canceled" : "provider";
    const timestamp = new Date();
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const currentSummary = toRecord(parseJsonValue(task?.resultSummaryJson));

    await this.databaseService.db
      .update(tasks)
      .set({
        status: canceled ? "canceled" : "failed",
        errorKind,
        errorMessage: compactText(message, 500),
        errorDetailsJson: JSON.stringify({
          error_kind: errorKind,
          raw_error: message,
        }),
        resultSummaryJson: JSON.stringify({
          ...currentSummary,
          phase: canceled ? "canceled" : "failed",
        }),
        completedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId));

    if (task?.dramaId && task.userId) {
      const [drama] = await this.databaseService.db
        .select()
        .from(dramas)
        .where(
          and(
            eq(dramas.id, task.dramaId),
            eq(dramas.userId, task.userId),
            isNull(dramas.deletedAt),
          ),
        )
        .limit(1);
      if (drama) {
        const { metadata, aiFirst } = readAiFirst(drama.metadata);
        const currentStage = toStringValue(aiFirst.ai_first_stage);
        const fallbackStage = "source_ready";
        await this.databaseService.db
          .update(dramas)
          .set({
            metadata: JSON.stringify({
              ...metadata,
              ai_first: {
                ...aiFirst,
                ai_first_stage:
                  currentStage === "blueprint_generating"
                    ? fallbackStage
                    : currentStage,
                blueprint_task_id: taskId,
                blueprint_task_status: canceled ? "canceled" : "failed",
                ai_first_updated_at: timestamp.toISOString(),
              },
            }),
            updatedAt: timestamp,
          })
          .where(and(eq(dramas.id, drama.id), eq(dramas.userId, task.userId)));
      }
    }
  }

  async generateEpisodeScript(input: GenerateEpisodeScriptInput) {
    this.assertAiFirstEnabled();
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);
    if (!useRemoteAgent && !this.shouldUseLocalRuleFallback()) {
      throw this.buildAiFirstAgentRequiredError("pilot_scripts");
    }

    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.id, input.episodeId),
          eq(episodes.userId, input.userId),
          isNull(episodes.deletedAt),
        ),
      )
      .limit(1);
    if (!episode) throw new NotFoundException("episode_not_found");
    if (!episode.blueprintPayload)
      throw new BadRequestException("episode_blueprint_required");
    if (episode.scriptContent?.trim() && !input.rewrite) {
      throw new ConflictException("episode_script_exists");
    }
    const existingStoryboards = input.rewrite
      ? await this.databaseService.db
          .select({ id: storyboards.id })
          .from(storyboards)
          .where(
            and(
              eq(storyboards.episodeId, episode.id),
              eq(storyboards.userId, input.userId),
              isNull(storyboards.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const requiresStoryboardReview = existingStoryboards.length > 0;

    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, episode.dramaId),
          eq(dramas.userId, input.userId),
          isNull(dramas.deletedAt),
        ),
      )
      .limit(1);
    if (!drama) throw new NotFoundException("drama_not_found");

    const { metadata, aiFirst } = readAiFirst(drama.metadata);
    const briefs = readAdaptationBriefs(aiFirst);
    const selectedBriefId = toStringValue(aiFirst.selected_brief_id);
    const blueprint = this.parseBlueprint(episode.blueprintPayload);
    const selectedBrief =
      briefs.find((brief) => brief.id === selectedBriefId) ||
      briefs.find((brief) => brief.id === blueprint?.brief_id) ||
      null;
    const sourceTrace = parseJsonArray(episode.sourceTrace);
    const effectiveSourceTrace = sourceTrace.length
      ? sourceTrace
      : blueprint?.source_trace || [];
    const startedAt = new Date();

    await this.databaseService.db
      .update(episodes)
      .set({
        status: "script_generating",
        scriptAiRunId: null,
        scriptRemoteRunId: null,
        failureReason: null,
        updatedAt: startedAt,
      })
      .where(
        and(eq(episodes.id, episode.id), eq(episodes.userId, input.userId)),
      );

    try {
      let scriptContent: string;
      let latestRunId: number | null = null;
      let remoteRunId: string | null = null;
      let generationMode = "local_rule_script";

      if (useRemoteAgent) {
        const agent = await this.dramaAgentService!.generateEpisodeScript({
          userId: input.userId,
          dramaId: episode.dramaId,
          episodeId: episode.id,
          brief: selectedBrief,
          blueprint,
          sourceTrace: effectiveSourceTrace,
        });
        const run = await this.recordRemoteRun({
          userId: input.userId,
          dramaId: episode.dramaId,
          skillId: "drama_episode_script_generator",
          mode: input.rewrite
            ? "episode_script_rewrite"
            : "episode_script_generate",
          userMessage: `${input.rewrite ? "Rewrite" : "Generate"} script for episode ${episode.id}`,
          remoteRunId: agent.remoteRunId,
          usage: agent.usage,
          result: {
            episode_id: episode.id,
            selected_brief_id: selectedBrief?.id || blueprint?.brief_id || null,
            source_trace_count: effectiveSourceTrace.length,
            script_content: agent.scriptContent.slice(0, 800),
          },
        });
        scriptContent = agent.scriptContent;
        latestRunId = run.id;
        remoteRunId = agent.remoteRunId;
        generationMode = "remote_agent_script";
      } else {
        const run = await this.recordLocalRun({
          userId: input.userId,
          dramaId: episode.dramaId,
          skillId: "drama_episode_script_generator",
          mode: input.rewrite
            ? "episode_script_rewrite"
            : "episode_script_generate",
          userMessage: `${input.rewrite ? "Rewrite" : "Generate"} script for episode ${episode.id}`,
        });
        scriptContent = this.buildLocalPilotScript(
          blueprint,
          episode.episodeNumber,
        );
        latestRunId = run.id;
      }

      const completedAt = new Date();
      let updatedEpisode: typeof episodes.$inferSelect | null = null;
      await this.databaseService.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(episodes)
          .set({
            content: scriptContent,
            scriptContent,
            generationMode,
            scriptAiRunId: latestRunId ? String(latestRunId) : null,
            scriptRemoteRunId: remoteRunId,
            failureReason: null,
            status: "script_ready",
            reviewStatus: requiresStoryboardReview
              ? "storyboard_review_required"
              : "pending",
            updatedAt: completedAt,
          })
          .where(
            and(eq(episodes.id, episode.id), eq(episodes.userId, input.userId)),
          )
          .returning();
        updatedEpisode = updated || null;

        await tx
          .update(dramas)
          .set({
            metadata: JSON.stringify({
              ...metadata,
              ai_first: {
                ...aiFirst,
                ai_first_stage: "script_ready",
                latest_script_ai_run_id: latestRunId,
                ai_first_updated_at: completedAt.toISOString(),
              },
            }),
            updatedAt: completedAt,
          })
          .where(
            and(
              eq(dramas.id, episode.dramaId),
              eq(dramas.userId, input.userId),
            ),
          );
      });
      if (!updatedEpisode) throw new NotFoundException("episode_not_found");
      return updatedEpisode;
    } catch (error) {
      if (useRemoteAgent) {
        await this.recordRemoteFailure({
          userId: input.userId,
          dramaId: episode.dramaId,
          skillId: "drama_episode_script_generator",
          mode: input.rewrite
            ? "episode_script_rewrite"
            : "episode_script_generate",
          userMessage: `${input.rewrite ? "Rewrite" : "Generate"} script for episode ${episode.id}`,
          error,
        });
      }
      await this.databaseService.db
        .update(episodes)
        .set({
          failureReason: getErrorMessage(error),
          status: "failed",
          updatedAt: new Date(),
        })
        .where(
          and(eq(episodes.id, episode.id), eq(episodes.userId, input.userId)),
        );
      throw error;
    }
  }

  async generatePilotScripts(input: GeneratePilotScriptsInput) {
    this.assertAiFirstEnabled();
    const context = await this.loadPilotScriptsContext(input);
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);

    if (this.taskQueueService) {
      if (!useRemoteAgent && !this.shouldUseLocalRuleFallback()) {
        throw this.buildAiFirstAgentRequiredError("pilot_scripts");
      }
      const task = await this.createOrReusePilotScriptsTask(context);
      await this.markPilotScriptsTaskQueued(context, task.id);
      await this.taskQueueService.enqueueTask(task.id);
      return this.getAiFirst(input.dramaId, input.userId);
    }

    return this.generatePilotScriptsNow({
      ...input,
      episodeIds: context.targets.map((episode) => episode.id),
    });
  }

  async executePilotScriptsTask(input: {
    taskId: number;
    userId: number;
    dramaId: number;
    episodeIds: number[];
    limit: number;
  }) {
    await this.updatePilotScriptsTask(input.taskId, {
      status: "running",
      progress: 3,
      startedAt: new Date(),
      completedAt: null,
      errorKind: null,
      errorMessage: null,
      errorDetailsJson: null,
      resultSummaryJson: JSON.stringify({
        phase: "loading_episodes",
        drama_id: input.dramaId,
        episode_ids: input.episodeIds,
      }),
    });

    try {
      const result = await this.generatePilotScriptsNow(input);
      await this.completePilotScriptsTask(input.taskId, {
        phase: "completed",
        drama_id: input.dramaId,
        episode_ids: input.episodeIds,
      });
      return result;
    } catch (error) {
      await this.failPilotScriptsTask(input.taskId, error);
      throw error;
    }
  }

  private async generatePilotScriptsNow(
    input: GeneratePilotScriptsInput & {
      taskId?: number;
      episodeIds?: number[];
    },
  ) {
    const { drama, metadata, aiFirst, targets } =
      await this.loadPilotScriptsContext(input);

    const ts = new Date();
    let latestRunId: number | null = null;
    let successCount = 0;
    let failedCount = 0;
    const briefs = readAdaptationBriefs(aiFirst);
    const selectedBriefId = toStringValue(aiFirst.selected_brief_id);
    const selectedBrief =
      briefs.find((brief) => brief.id === selectedBriefId) || null;
    const useRemoteAgent = await this.shouldUseRemoteAgent(input.userId);
    const storyboardRows = targets.length
      ? await this.databaseService.db
          .select({ episodeId: storyboards.episodeId })
          .from(storyboards)
          .where(
            and(
              eq(storyboards.userId, input.userId),
              inArray(
                storyboards.episodeId,
                targets.map((episode) => episode.id),
              ),
              isNull(storyboards.deletedAt),
            ),
          )
      : [];
    const storyboardEpisodeIds = new Set(
      storyboardRows.map((row) => row.episodeId),
    );

    await this.databaseService.db
      .update(episodes)
      .set({
        status: "script_generating",
        scriptAiRunId: null,
        scriptRemoteRunId: null,
        failureReason: null,
        updatedAt: ts,
      })
      .where(
        and(
          eq(episodes.userId, input.userId),
          inArray(
            episodes.id,
            targets.map((episode) => episode.id),
          ),
        ),
      );

    if (input.taskId) {
      await this.updatePilotScriptsTask(input.taskId, {
        status: "running",
        progress: 8,
        resultSummaryJson: JSON.stringify({
          phase: "pilot_scripts",
          drama_id: input.dramaId,
          total_episodes: targets.length,
          completed_episodes: 0,
          failed_episodes: 0,
          episode_ids: targets.map((episode) => episode.id),
        }),
      });
    }

    const updateProgress = async (
      phase: string,
      currentEpisodeNumber?: number | null,
    ) => {
      if (!input.taskId) return;
      const progress = Math.min(
        96,
        8 + Math.round(((successCount + failedCount) / targets.length) * 84),
      );
      await this.updatePilotScriptsTask(input.taskId, {
        status: "running",
        progress,
        resultSummaryJson: JSON.stringify({
          phase,
          drama_id: input.dramaId,
          total_episodes: targets.length,
          completed_episodes: successCount,
          failed_episodes: failedCount,
          current_episode_number: currentEpisodeNumber ?? null,
          episode_ids: targets.map((episode) => episode.id),
        }),
      });
    };

    if (useRemoteAgent) {
      for (const episode of targets) {
        await this.assertAiFirstTaskNotCanceled(input.taskId);
        const blueprint = this.parseBlueprint(episode.blueprintPayload);
        const sourceTrace = parseJsonArray(episode.sourceTrace);
        const effectiveSourceTrace = sourceTrace.length
          ? sourceTrace
          : blueprint?.source_trace || [];
        try {
          await updateProgress("episode_script", episode.episodeNumber);
          const agent = await this.dramaAgentService!.generateEpisodeScript({
            userId: input.userId,
            dramaId: input.dramaId,
            episodeId: episode.id,
            brief: selectedBrief,
            blueprint,
            sourceTrace: effectiveSourceTrace,
          });
          const run = await this.recordRemoteRun({
            userId: input.userId,
            dramaId: input.dramaId,
            skillId: "drama_episode_script_generator",
            mode: "pilot_scripts",
            userMessage: `Generate pilot script for episode ${episode.id}`,
            remoteRunId: agent.remoteRunId,
            usage: agent.usage,
            result: {
              episode_id: episode.id,
              selected_brief_id:
                selectedBrief?.id || blueprint?.brief_id || null,
              source_trace_count: effectiveSourceTrace.length,
              script_content: agent.scriptContent.slice(0, 800),
            },
          });
          latestRunId = run.id;
          successCount += 1;
          await this.databaseService.db
            .update(episodes)
            .set({
              content: agent.scriptContent,
              scriptContent: agent.scriptContent,
              generationMode: "remote_agent_script",
              scriptAiRunId: String(run.id),
              scriptRemoteRunId: agent.remoteRunId,
              failureReason: null,
              status: "script_ready",
              reviewStatus: storyboardEpisodeIds.has(episode.id)
                ? "storyboard_review_required"
                : "pending",
              updatedAt: ts,
            })
            .where(
              and(
                eq(episodes.id, episode.id),
                eq(episodes.userId, input.userId),
              ),
            );
          await updateProgress("episode_script", episode.episodeNumber);
        } catch (error) {
          failedCount += 1;
          await this.recordRemoteFailure({
            userId: input.userId,
            dramaId: input.dramaId,
            skillId: "drama_episode_script_generator",
            mode: "pilot_scripts",
            userMessage: `Generate pilot script for episode ${episode.id}`,
            error,
          });
          await this.databaseService.db
            .update(episodes)
            .set({
              failureReason: getErrorMessage(error),
              status: "failed",
              updatedAt: ts,
            })
            .where(
              and(
                eq(episodes.id, episode.id),
                eq(episodes.userId, input.userId),
              ),
            );
          await updateProgress("episode_failed", episode.episodeNumber);
        }
      }
      if (!successCount)
        throw new BadRequestException("pilot_script_generation_failed");
    } else if (this.shouldUseLocalRuleFallback()) {
      const run = await this.recordLocalRun({
        userId: input.userId,
        dramaId: input.dramaId,
        skillId: "drama_episode_script_generator",
        mode: "pilot_scripts",
        userMessage: `Generate pilot scripts for ${targets.length} episode(s)`,
      });
      latestRunId = run.id;
      for (const episode of targets) {
        await this.assertAiFirstTaskNotCanceled(input.taskId);
        await updateProgress("episode_script", episode.episodeNumber);
        const blueprint = this.parseBlueprint(episode.blueprintPayload);
        const script = this.buildLocalPilotScript(
          blueprint,
          episode.episodeNumber,
        );
        await this.databaseService.db
          .update(episodes)
          .set({
            content: script,
            scriptContent: script,
            generationMode: "local_rule_script",
            scriptAiRunId: String(run.id),
            scriptRemoteRunId: null,
            failureReason: null,
            status: "script_ready",
            reviewStatus: storyboardEpisodeIds.has(episode.id)
              ? "storyboard_review_required"
              : "pending",
            updatedAt: ts,
          })
          .where(
            and(eq(episodes.id, episode.id), eq(episodes.userId, input.userId)),
          );
        successCount += 1;
        await updateProgress("episode_script", episode.episodeNumber);
      }
    } else {
      throw this.buildAiFirstAgentRequiredError("pilot_scripts");
    }

    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...metadata,
          ai_first: {
            ...aiFirst,
            ai_first_stage: "script_ready",
            latest_script_ai_run_id: latestRunId,
            pilot_scripts_task_id:
              input.taskId ||
              toNumberValue(aiFirst.pilot_scripts_task_id) ||
              null,
            pilot_scripts_task_status: input.taskId
              ? "completed"
              : toStringValue(aiFirst.pilot_scripts_task_status),
            ai_first_updated_at: ts.toISOString(),
          },
        }),
        updatedAt: ts,
      })
      .where(
        and(eq(dramas.id, input.dramaId), eq(dramas.userId, input.userId)),
      );

    return this.getAiFirst(input.dramaId, input.userId);
  }

  private async loadPilotScriptsContext(
    input: GeneratePilotScriptsInput,
  ): Promise<PilotScriptsContext> {
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(
        and(
          eq(dramas.id, input.dramaId),
          eq(dramas.userId, input.userId),
          isNull(dramas.deletedAt),
        ),
      );

    if (!drama) throw new NotFoundException("drama_not_found");

    const { metadata, aiFirst } = readAiFirst(drama.metadata);
    const limit = Math.max(1, input.limit || input.episodeIds?.length || 1);
    const episodeRows = await this.databaseService.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.dramaId, input.dramaId),
          eq(episodes.userId, input.userId),
          isNull(episodes.deletedAt),
        ),
      )
      .orderBy(episodes.episodeNumber);
    const targetIds = input.episodeIds?.length
      ? new Set(input.episodeIds)
      : null;
    const targets = episodeRows
      .filter((episode) => {
        const stale = EPISODE_STALE_SUFFIX_PATTERN.test(
          String(episode.generationMode || ""),
        );
        return (
          Boolean(episode.blueprintPayload) &&
          (!episode.scriptContent?.trim() || stale)
        );
      })
      .filter((episode) => !targetIds || targetIds.has(episode.id))
      .slice(0, limit);

    if (!targets.length)
      throw new BadRequestException("episode_blueprint_required");
    return { drama, metadata, aiFirst, targets, targetCount: targets.length };
  }

  private async createOrReusePilotScriptsTask(context: PilotScriptsContext) {
    const timestamp = new Date();
    const targetEpisodeNumbers = context.targets.map(
      (episode) => episode.episodeNumber,
    );
    const targetEpisodeIds = context.targets.map((episode) => episode.id);
    const title = compactText(`AI-first 剧本正文：${context.drama.title}`, 120);
    const payload = {
      operation: "drama_ai_first_pilot_scripts",
      drama_id: context.drama.id,
      episode_ids: targetEpisodeIds,
      episode_numbers: targetEpisodeNumbers,
      target_count: context.targetCount,
    };
    const summary = {
      phase: "queued",
      drama_id: context.drama.id,
      total_episodes: targetEpisodeIds.length,
      completed_episodes: 0,
      failed_episodes: 0,
      episode_ids: targetEpisodeIds,
      episode_numbers: targetEpisodeNumbers,
    };
    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, AI_FIRST_PILOT_DOMAIN),
          eq(tasks.domainId, context.drama.id),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);

    if (existing && ["queued", "running"].includes(existing.status)) {
      await this.updatePilotScriptsTask(existing.id, {
        title,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify({
          ...summary,
          phase: existing.status,
        }),
      });
      return { ...existing, title };
    }

    if (existing) {
      const [updated] = await this.databaseService.db
        .update(tasks)
        .set({
          userId: context.drama.userId,
          type: AI_FIRST_PILOT_TASK_TYPE,
          status: "queued",
          title,
          progress: 0,
          sourceType: AI_FIRST_TASK_SOURCE_TYPE,
          dramaId: context.drama.id,
          episodeId: targetEpisodeIds[0] || null,
          storyboardId: null,
          aiConfigId: null,
          providerTaskId: null,
          attemptCount:
            existing.status === "failed" || existing.status === "dead_letter"
              ? 0
              : existing.attemptCount,
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
        })
        .where(eq(tasks.id, existing.id))
        .returning();
      return updated;
    }

    const [task] = await this.databaseService.db
      .insert(tasks)
      .values({
        userId: context.drama.userId,
        type: AI_FIRST_PILOT_TASK_TYPE,
        status: "queued",
        title,
        progress: 0,
        sourceType: AI_FIRST_TASK_SOURCE_TYPE,
        dramaId: context.drama.id,
        episodeId: targetEpisodeIds[0] || null,
        domainTable: AI_FIRST_PILOT_DOMAIN,
        domainId: context.drama.id,
        payloadJson: JSON.stringify(payload),
        resultSummaryJson: JSON.stringify(summary),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .returning();
    return task;
  }

  private async markPilotScriptsTaskQueued(
    context: PilotScriptsContext,
    taskId: number,
  ) {
    const timestamp = new Date();
    const nowIso = timestamp.toISOString();
    const userId = Number(context.drama.userId);
    const episodeIds = context.targets.map((episode) => episode.id);

    await this.databaseService.db
      .update(episodes)
      .set({
        status: "script_generating",
        failureReason: null,
        updatedAt: timestamp,
      })
      .where(
        and(eq(episodes.userId, userId), inArray(episodes.id, episodeIds)),
      );

    await this.databaseService.db
      .update(dramas)
      .set({
        metadata: JSON.stringify({
          ...context.metadata,
          ai_first: {
            ...context.aiFirst,
            ai_first_stage: "script_generating",
            pilot_scripts_task_id: taskId,
            pilot_scripts_task_status: "queued",
            ai_first_updated_at: nowIso,
          },
        }),
        updatedAt: timestamp,
      })
      .where(and(eq(dramas.id, context.drama.id), eq(dramas.userId, userId)));
  }

  private async updatePilotScriptsTask(
    taskId: number,
    values: Partial<typeof tasks.$inferInsert>,
  ) {
    await this.databaseService.db
      .update(tasks)
      .set({
        ...values,
        updatedAt: new Date(),
      })
      .where(eq(tasks.id, taskId));
  }

  private async completePilotScriptsTask(
    taskId: number,
    summary: Record<string, unknown>,
  ) {
    const timestamp = new Date();
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const currentSummary = toRecord(parseJsonValue(task?.resultSummaryJson));
    await this.databaseService.db
      .update(tasks)
      .set({
        status: "completed",
        progress: 100,
        resultSummaryJson: JSON.stringify({
          ...currentSummary,
          ...summary,
          phase: "completed",
        }),
        errorKind: null,
        errorMessage: null,
        errorDetailsJson: null,
        completedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId));
  }

  async failPilotScriptsTask(taskId: number, error: unknown) {
    const message = getErrorMessage(error);
    const canceled = message.toLowerCase().includes("cancel");
    const timestamp = new Date();
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    const payload = toRecord(parseJsonValue(task?.payloadJson));
    const episodeIds = toNumberArray(payload.episode_ids);
    if (episodeIds.length) {
      await this.databaseService.db
        .update(episodes)
        .set({
          status: canceled ? "blueprint" : "failed",
          failureReason: canceled ? "Canceled by user" : message,
          updatedAt: timestamp,
        })
        .where(
          and(
            eq(episodes.userId, task?.userId ?? 0),
            inArray(episodes.id, episodeIds),
            eq(episodes.status, "script_generating"),
          ),
        );
    }

    const errorKind = canceled ? "canceled" : "provider";
    const currentSummary = toRecord(parseJsonValue(task?.resultSummaryJson));
    await this.databaseService.db
      .update(tasks)
      .set({
        status: canceled ? "canceled" : "failed",
        errorKind,
        errorMessage: compactText(message, 500),
        errorDetailsJson: JSON.stringify({
          error_kind: errorKind,
          raw_error: message,
        }),
        resultSummaryJson: JSON.stringify({
          ...currentSummary,
          phase: canceled ? "canceled" : "failed",
        }),
        completedAt: timestamp,
        lockedBy: null,
        lockedAt: null,
        lockExpiresAt: null,
        updatedAt: timestamp,
      })
      .where(eq(tasks.id, taskId));
  }

  private async assertAiFirstTaskNotCanceled(taskId?: number) {
    if (!taskId) return;
    const [task] = await this.databaseService.db
      .select({ status: tasks.status })
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);
    if (task?.status === "canceled") throw new Error("canceled");
  }

  private async recordLocalRun(input: {
    userId: number;
    dramaId: number;
    skillId: string;
    mode: string;
    userMessage: string;
  }) {
    const [run] = await this.databaseService.db
      .insert(aiRuns)
      .values({
        userId: input.userId,
        skillId: input.skillId,
        mode: input.mode,
        scene: "drama_ai_first_local_rule",
        targetType: "drama",
        targetId: input.dramaId,
        status: "completed",
        userMessage: input.userMessage,
        assistantMessage:
          "Internal demo fallback only: local rule executor produced a structured seed for integration testing. Not acceptable as formal 0.23.1 AI output.",
        referencesJson: JSON.stringify([
          {
            kind: "internal_demo",
            title: "DRAMA_AI_FIRST_LOCAL_RULE_FALLBACK",
            reason:
              "Local rule fallback is gated and must not be used for formal release acceptance",
          },
        ]),
        actionsJson: JSON.stringify([]),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return run;
  }

  private async shouldUseRemoteAgent(userId: number) {
    if (
      String(process.env.DRAMA_AGENT_PROVIDER || "")
        .trim()
        .toLowerCase() === "disabled"
    ) {
      return false;
    }
    return Boolean(
      this.dramaAgentService &&
      (await this.dramaAgentService.canExecute(userId)),
    );
  }

  private async ensureSourceChunks(
    source: typeof dramaSources.$inferSelect,
    health: SourceHealth,
  ) {
    const existing = await this.databaseService.db
      .select()
      .from(dramaSourceChunks)
      .where(
        and(
          eq(dramaSourceChunks.sourceId, source.id),
          eq(dramaSourceChunks.userId, source.userId),
        ),
      )
      .orderBy(dramaSourceChunks.chunkNo);
    if (existing.length) return existing;

    const drafts = buildChunks(source.content, source.id, health);
    if (!drafts.length) return [];

    const ts = new Date();
    await this.databaseService.db
      .insert(dramaSourceChunks)
      .values(
        drafts.map((chunk) => ({
          userId: source.userId,
          dramaId: source.dramaId,
          sourceId: chunk.sourceId,
          chunkNo: chunk.chunkNo,
          title: chunk.title,
          contentStart: chunk.contentStart,
          contentEnd: chunk.contentEnd,
          contentHash: chunk.contentHash,
          estimatedTokens: chunk.estimatedTokens,
          sourceTrace: chunk.sourceTrace,
          status: "pending",
          createdAt: ts,
          updatedAt: ts,
        })),
      )
      .onConflictDoNothing({
        target: [dramaSourceChunks.sourceId, dramaSourceChunks.chunkNo],
      });

    return this.databaseService.db
      .select()
      .from(dramaSourceChunks)
      .where(
        and(
          eq(dramaSourceChunks.sourceId, source.id),
          eq(dramaSourceChunks.userId, source.userId),
        ),
      )
      .orderBy(dramaSourceChunks.chunkNo);
  }

  private async analyzeLongSourceWithRemoteAgent(input: {
    userId: number;
    dramaId: number;
    dramaTitle: string;
    source: typeof dramaSources.$inferSelect;
    health: SourceHealth;
    generatedAt: string;
    taskId?: number;
  }) {
    const chunks = await this.ensureSourceChunks(input.source, input.health);
    if (!chunks.length) throw new BadRequestException("source_chunks_required");

    const chunkAnalyses: SourceChunkAnalysisAggregate[] = [];
    const reportChunkProgress = async (
      phase: "chunk_analysis" | "global_summary" = "chunk_analysis",
    ) => {
      if (!input.taskId) return;
      const readyChunks = chunkAnalyses.length;
      const progress =
        phase === "global_summary"
          ? 88
          : Math.min(82, 5 + Math.round((readyChunks / chunks.length) * 72));
      await this.updateSourceAnalysisTask(input.taskId, {
        status: "running",
        progress,
        resultSummaryJson: JSON.stringify({
          phase,
          source_id: input.source.id,
          total_chunks: chunks.length,
          ready_chunks: readyChunks,
          failed_chunks: 0,
        }),
      });
    };

    await reportChunkProgress();
    for (const chunk of chunks) {
      const existingPayload = toRecord(parseJsonValue(chunk.summaryPayload));
      if (chunk.status === "ready" && existingPayload.summary) {
        chunkAnalyses.push({
          summary: toStringValue(existingPayload.summary),
          key_events: Array.isArray(existingPayload.key_events)
            ? existingPayload.key_events.map(String)
            : [],
          characters: Array.isArray(existingPayload.characters)
            ? existingPayload.characters.map(String)
            : [],
          scenes: Array.isArray(existingPayload.scenes)
            ? existingPayload.scenes.map(String)
            : [],
          risks: Array.isArray(existingPayload.risks)
            ? existingPayload.risks.map(String)
            : [],
          source_trace: Array.isArray(existingPayload.source_trace)
            ? existingPayload.source_trace.map((item) => toRecord(item))
            : parseJsonArray(chunk.sourceTrace),
          ai_run_id: toNumberValue(existingPayload.ai_run_id),
          remote_run_id: toStringValue(existingPayload.remote_run_id),
          generated_at: toStringValue(existingPayload.generated_at),
          chunk_id: chunk.id,
          chunk_no: chunk.chunkNo,
        });
        await reportChunkProgress();
        continue;
      }

      await this.databaseService.db
        .update(dramaSourceChunks)
        .set({
          status: "running",
          failureReason: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(dramaSourceChunks.id, chunk.id),
            eq(dramaSourceChunks.userId, input.userId),
          ),
        );

      const sourceTrace = parseJsonArray(chunk.sourceTrace);
      const chunkContent = input.source.content.slice(
        chunk.contentStart,
        chunk.contentEnd,
      );
      try {
        const agent = await this.dramaAgentService!.analyzeSourceChunk({
          userId: input.userId,
          dramaId: input.dramaId,
          sourceId: input.source.id,
          chunkId: chunk.id,
          chunkNo: chunk.chunkNo,
          contentHash: chunk.contentHash,
          content: chunkContent,
          sourceTrace,
        });
        const run = await this.recordRemoteRun({
          userId: input.userId,
          dramaId: input.dramaId,
          skillId: "drama_source_chunk_analyzer",
          mode: "source_chunk_analyze",
          userMessage: `Analyze drama source chunk ${chunk.id}`,
          remoteRunId: agent.remoteRunId,
          usage: agent.usage,
          result: agent.chunkAnalysis,
        });
        const payload: SourceChunkAnalysisPayload & {
          chunk_id: number;
          chunk_no: number;
        } = {
          ...agent.chunkAnalysis,
          source_trace: agent.chunkAnalysis.source_trace?.length
            ? agent.chunkAnalysis.source_trace
            : sourceTrace,
          ai_run_id: run.id,
          remote_run_id: agent.remoteRunId,
          generated_at: input.generatedAt,
          chunk_id: chunk.id,
          chunk_no: chunk.chunkNo,
        };
        await this.databaseService.db
          .update(dramaSourceChunks)
          .set({
            status: "ready",
            summaryPayload: JSON.stringify(payload),
            extractionPayload: JSON.stringify({
              key_events: payload.key_events,
              characters: payload.characters,
              scenes: payload.scenes,
              risks: payload.risks,
            }),
            sourceTrace: JSON.stringify(payload.source_trace),
            aiRunId: String(run.id),
            remoteRunId: agent.remoteRunId,
            failureReason: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dramaSourceChunks.id, chunk.id),
              eq(dramaSourceChunks.userId, input.userId),
            ),
          );
        chunkAnalyses.push(payload);
        await reportChunkProgress();
      } catch (error) {
        await this.recordRemoteFailure({
          userId: input.userId,
          dramaId: input.dramaId,
          skillId: "drama_source_chunk_analyzer",
          mode: "source_chunk_analyze",
          userMessage: `Analyze drama source chunk ${chunk.id}`,
          error,
        });
        await this.databaseService.db
          .update(dramaSourceChunks)
          .set({
            status: "failed",
            failureReason: getErrorMessage(error),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dramaSourceChunks.id, chunk.id),
              eq(dramaSourceChunks.userId, input.userId),
            ),
          );
        throw error;
      }
    }

    await reportChunkProgress("global_summary");
    let globalSummaryInput = chunkAnalyses;
    let reductionLevel = 0;
    while (
      JSON.stringify(globalSummaryInput).length >
        SOURCE_GLOBAL_SUMMARY_MAX_INPUT_CHARS &&
      globalSummaryInput.length > 1
    ) {
      reductionLevel += 1;
      const reduced: SourceChunkAnalysisAggregate[] = [];
      for (
        let offset = 0;
        offset < globalSummaryInput.length;
        offset += SOURCE_SUMMARY_REDUCE_BATCH_SIZE
      ) {
        const batch = globalSummaryInput.slice(
          offset,
          offset + SOURCE_SUMMARY_REDUCE_BATCH_SIZE,
        );
        if (batch.length === 1) {
          reduced.push(batch[0]);
          continue;
        }
        const batchNo = Math.floor(offset / SOURCE_SUMMARY_REDUCE_BATCH_SIZE) + 1;
        const agent = await this.dramaAgentService!.reduceSourceChunkAnalyses({
          userId: input.userId,
          dramaId: input.dramaId,
          sourceId: input.source.id,
          level: reductionLevel,
          batchNo,
          chunkAnalyses: batch,
        });
        const run = await this.recordRemoteRun({
          userId: input.userId,
          dramaId: input.dramaId,
          skillId: "drama_source_chunk_reducer",
          mode: "source_chunk_reduce",
          userMessage: `Reduce source ${input.source.id} summaries at level ${reductionLevel}, batch ${batchNo}`,
          remoteRunId: agent.remoteRunId,
          usage: agent.usage,
          result: agent.chunkAnalysis,
        });
        reduced.push({
          ...agent.chunkAnalysis,
          source_trace: mergeSourceTraces([
            ...batch,
            agent.chunkAnalysis,
          ]),
          ai_run_id: run.id,
          remote_run_id: agent.remoteRunId,
          generated_at: input.generatedAt,
          chunk_id: batch[0]?.chunk_id,
          chunk_no: batch[0]?.chunk_no,
          reduction_level: reductionLevel,
        });
      }
      globalSummaryInput = reduced;
      if (input.taskId) {
        await this.updateSourceAnalysisTask(input.taskId, {
          status: "running",
          progress: Math.min(92, 87 + reductionLevel),
          resultSummaryJson: JSON.stringify({
            phase: "global_summary_reduce",
            source_id: input.source.id,
            total_chunks: chunks.length,
            ready_chunks: chunkAnalyses.length,
            reduction_level: reductionLevel,
            summary_batches: reduced.length,
          }),
        });
      }
    }
    const globalAgent = await this.dramaAgentService!.analyzeSourceFromChunks({
      userId: input.userId,
      dramaId: input.dramaId,
      dramaTitle: input.dramaTitle,
      sourceId: input.source.id,
      health: input.health,
      chunkAnalyses: globalSummaryInput,
    });
    const run = await this.recordRemoteRun({
      userId: input.userId,
      dramaId: input.dramaId,
      skillId: "drama_source_analyzer",
      mode: "source_analysis",
      userMessage: `Analyze drama source ${input.source.id} from ${chunkAnalyses.length} chunk(s) in ${globalSummaryInput.length} summary input(s)`,
      remoteRunId: globalAgent.remoteRunId,
      usage: globalAgent.usage,
      result: globalAgent.analysis,
    });
    if (input.taskId) {
      await this.updateSourceAnalysisTask(input.taskId, {
        status: "running",
        progress: 95,
        resultSummaryJson: JSON.stringify({
          phase: "writing_analysis",
          source_id: input.source.id,
          total_chunks: chunks.length,
          ready_chunks: chunkAnalyses.length,
          failed_chunks: 0,
        }),
      });
    }
    return {
      run,
      analysis: {
        ...globalAgent.analysis,
        ai_run_id: run.id,
        remote_run_id: globalAgent.remoteRunId,
        generated_at: input.generatedAt,
        generation_mode: REMOTE_AGENT_MODE,
      } satisfies SourceAnalysisPayload,
    };
  }

  private async recordRemoteRun(input: {
    userId: number;
    dramaId: number;
    skillId: string;
    mode: string;
    userMessage: string;
    remoteRunId: string;
    usage: Record<string, unknown> | null;
    result: unknown;
  }) {
    const [run] = await this.databaseService.db
      .insert(aiRuns)
      .values({
        userId: input.userId,
        skillId: input.skillId,
        mode: input.mode,
        scene: "drama_ai_first_remote_agent",
        targetType: "drama",
        targetId: input.dramaId,
        status: "completed",
        userMessage: input.userMessage,
        assistantMessage: JSON.stringify({
          remote_run_id: input.remoteRunId,
          usage: input.usage || null,
          result_preview: compactText(JSON.stringify(input.result), 1800),
        }),
        referencesJson: JSON.stringify([
          {
            kind: "remote_run",
            title: input.remoteRunId,
            reason: "RemoteDramaAgentAdapter execution",
          },
        ]),
        actionsJson: JSON.stringify([]),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return run;
  }

  private async recordRemoteFailure(input: {
    userId: number;
    dramaId: number;
    skillId: string;
    mode: string;
    userMessage: string;
    error: unknown;
  }) {
    await this.databaseService.db.insert(aiRuns).values({
      userId: input.userId,
      skillId: input.skillId,
      mode: input.mode,
      scene: "drama_ai_first_remote_agent",
      targetType: "drama",
      targetId: input.dramaId,
      status: "failed",
      userMessage: input.userMessage,
      assistantMessage: getErrorMessage(input.error),
      referencesJson: JSON.stringify([]),
      actionsJson: JSON.stringify([]),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  private buildLocalSourceAnalysis(input: {
    dramaTitle: string;
    sourceId: number;
    content: string;
    health: SourceHealth;
    aiRunId: number;
  }): SourceAnalysisPayload {
    const chapterIndex = input.health.chapter_index || [];
    const characterNames = pickLikelyCharacterNames(input.content);
    const protagonist = firstNonEmpty(characterNames, "待确认主角");
    const antagonist =
      characterNames.find((name) => name !== protagonist) || null;
    const firstChapter = chapterIndex[0];
    const lastChapter = chapterIndex[chapterIndex.length - 1];
    const generatedAt = new Date().toISOString();
    const preferredEpisodeCount = estimateTargetEpisodeCountFromSourceHealth(
      input.health,
    );
    const minEpisodeCount = Math.max(
      1,
      Math.floor(preferredEpisodeCount * 0.75),
    );
    const maxEpisodeCount = Math.max(
      preferredEpisodeCount,
      Math.ceil(preferredEpisodeCount * 1.25),
    );
    const durationMinSeconds = 60;
    const durationMaxSeconds = 90;
    const recommendationTrace = createSourceTrace(
      input.sourceId,
      input.health,
      0,
    );

    return {
      theme: `${input.dramaTitle}的核心情绪与关系冲突`,
      core_conflict: firstChapter?.brief
        ? `从“${compactText(firstChapter.brief, 48)}”展开，围绕主角目标、阻力与反转推进。`
        : "待从源稿理解中进一步确认核心冲突。",
      protagonist,
      antagonist,
      protagonist_goal: lastChapter?.brief
        ? `推动剧情抵达“${compactText(lastChapter.brief, 48)}”所代表的阶段性结果。`
        : "完成自我目标并解决核心冲突。",
      target_episode_count: preferredEpisodeCount,
      episode_duration: `${durationMinSeconds}-${durationMaxSeconds} 秒`,
      adaptation_mode: "faithful",
      source_completeness: "uncertain",
      major_beat_count: Math.max(1, chapterIndex.length * 2),
      supported_duration_seconds: {
        min: minEpisodeCount * durationMinSeconds,
        max: maxEpisodeCount * durationMaxSeconds,
      },
      recommended_episode_count: {
        min: minEpisodeCount,
        preferred: preferredEpisodeCount,
        max: maxEpisodeCount,
      },
      episode_duration_seconds: {
        min: durationMinSeconds,
        max: durationMaxSeconds,
      },
      recommendation_confidence: 0.2,
      recommendation_basis: [
        {
          claim:
            "本地规则仅依据源稿规模和章节索引给出粗略区间，必须在分集规划阶段复核。",
          source_trace: recommendationTrace,
        },
      ],
      expansion_notes: [
        "本地规则无法判断故事是否完整，也无法可靠区分对白、动作与描写时长。",
      ],
      relationship_map: characterNames.slice(0, 4).map((name, index) => {
        const trace = createSourceTrace(input.sourceId, input.health, index);
        if (index === 0) {
          return {
            character: name,
            role: "protagonist_candidate",
            evidence: trace,
            source_trace: [trace],
          };
        }
        return {
          subject: protagonist,
          object: name,
          predicate: antagonist === name ? "主要冲突/对照" : "关键关系待确认",
          description:
            antagonist === name
              ? `${name}是${protagonist}目标推进中的主要阻力或对照关系。`
              : `${name}与${protagonist}存在需要在改编中确认的关键关系。`,
          character: name,
          role: "supporting_or_opposing_force",
          source_trace: [trace],
        };
      }),
      world_rules: [
        input.health.chapter_count > 1
          ? `源稿共识别 ${input.health.chapter_count} 个章节，可按章节弧线改编。`
          : "源稿缺少明确章节结构，需要按全文节拍拆分。",
        input.health.over_context_limit
          ? "源稿超过安全上下文阈值，必须通过分块摘要合成全局理解。"
          : "源稿可直接进入策略生成。",
      ],
      emotional_curve: chapterIndex.slice(0, 6).map((chapter, index) => ({
        chapter_no: chapter.chapter_no,
        title: chapter.title,
        position:
          index === 0
            ? "setup"
            : index === chapterIndex.length - 1
              ? "resolution"
              : "escalation",
        brief: chapter.brief,
      })),
      adaptation_risks: [
        input.health.status === "warning"
          ? "源稿健康检查存在 warning，策略生成前建议人工复核。"
          : "",
        input.health.over_context_limit
          ? "长篇源稿需要保留 source trace，避免只改编前段内容。"
          : "",
      ].filter(Boolean),
      evidence: [
        {
          claim: "核心理解来自源稿章节索引和内容摘要。",
          source_trace: createSourceTrace(input.sourceId, input.health, 0),
        },
      ],
      ai_run_id: input.aiRunId,
      generated_at: generatedAt,
      generation_mode: "local_rule_seed",
    };
  }

  private buildLocalAdaptationBriefs(input: {
    dramaTitle: string;
    analysis: SourceAnalysisPayload;
    health: SourceHealth;
    count: number;
    targetEpisodeCount?: number;
    episodeDuration?: string | null;
    styleDirection?: string | null;
    aiRunId: number;
    generatedAt: string;
  }): AdaptationBriefPayload[] {
    const episodeCount = Math.min(
      80,
      Math.max(
        3,
        input.targetEpisodeCount ||
          estimateTargetEpisodeCountFromSourceHealth(input.health),
      ),
    );
    const duration = input.episodeDuration?.trim() || "60-90 秒";
    const style = input.styleDirection?.trim() || "统一短剧风格";
    const variants = [
      {
        suffix: "强钩子主线版",
        claim: `以${input.analysis.protagonist}的目标为中心，快速放大“${compactText(input.analysis.core_conflict, 36)}”。`,
        rhythm: "前 3 集建立困境，每集结尾强悬念，中段连续反转。",
        density: "高",
        cost: "中",
        recommendedFor: "适合优先验证点击率与试播反馈。",
      },
      {
        suffix: "人物情绪版",
        claim: `保留《${input.dramaTitle}》的人物关系与情绪递进，减少支线，强化主角选择。`,
        rhythm: "情绪铺垫更完整，关键反转集中在每 3-4 集。",
        density: "中高",
        cost: "中低",
        recommendedFor: "适合强调角色共情和长期追更。",
      },
      {
        suffix: "低成本制作版",
        claim: "优先复用核心场景和少量角色，把制作复杂度压低到试播可控范围。",
        rhythm: "少场景、多对白、关键动作集中在集首集尾。",
        density: "中",
        cost: "低",
        recommendedFor: "适合先做 1-3 集试播，验证后再扩展资产。",
      },
    ];

    return variants.slice(0, input.count).map((variant, index) => ({
      id: `brief-${Date.now()}-${index + 1}`,
      name: variant.suffix,
      claim: variant.claim,
      rhythm_model: variant.rhythm,
      target_episode_count: episodeCount,
      episode_duration: duration,
      style_direction: style,
      hook_density: variant.density,
      retained_points: [
        input.analysis.protagonist,
        compactText(input.analysis.core_conflict, 80),
        ...(input.health.chapter_index || [])
          .slice(0, 2)
          .map((chapter) => chapter.title),
      ].filter(Boolean),
      removed_points: ["弱支线", "重复解释段落", "不服务主线的长铺垫"],
      risk_notes: [
        ...input.analysis.adaptation_risks,
        "本地规则执行器仅生成结构化种子，封版前应替换为真实 AI 生产输出。",
      ],
      production_cost: variant.cost,
      recommended_for: variant.recommendedFor,
      ai_run_id: input.aiRunId,
      generated_at: input.generatedAt,
      generation_mode: "local_rule_seed",
    }));
  }

  private buildLocalEpisodeBlueprints(input: {
    sourceId: number;
    health: SourceHealth;
    analysis: SourceAnalysisPayload;
    brief: AdaptationBriefPayload;
    aiRunId: number;
    generatedAt: string;
  }): EpisodeBlueprintPayload[] {
    const chapterIndex = input.health.chapter_index || [];
    const total = Math.max(
      1,
      input.brief.target_episode_count || chapterIndex.length || 1,
    );
    const characters = [
      input.analysis.protagonist,
      input.analysis.antagonist || "关键对手",
    ].filter(Boolean) as string[];
    const scenes = pickSceneNames(chapterIndex, input.analysis.core_conflict);

    return Array.from({ length: total }).map((_, index) => {
      const episodeNumber = index + 1;
      const chapter = chapterIndex[index % Math.max(chapterIndex.length, 1)];
      const titleSuffix =
        episodeNumber === 1
          ? "开局钩子"
          : episodeNumber === total
            ? "终局反转"
            : "冲突升级";
      return {
        episode_number: episodeNumber,
        title: `第${episodeNumber}集：${titleSuffix}`,
        positioning:
          episodeNumber <= 3
            ? "试播关键集"
            : episodeNumber === total
              ? "收束集"
              : "主线推进集",
        opening_hook:
          episodeNumber === 1
            ? compactText(input.analysis.core_conflict, 80)
            : "承接上一集悬念，开场 5 秒给出新阻力或新信息。",
        summary: chapter?.brief
          ? `围绕“${compactText(chapter.brief, 90)}”推进本集冲突。`
          : `围绕${input.analysis.protagonist}的目标推进本集冲突。`,
        source_trace: createSourceTrace(input.sourceId, input.health, index),
        characters,
        scenes: scenes.length ? [scenes[index % scenes.length]] : ["核心场景"],
        ending_hook:
          episodeNumber === total
            ? "主线阶段性闭合，保留续作余味。"
            : "在答案揭晓前切断，形成下一集点击动力。",
        risk_notes: input.brief.risk_notes.slice(0, 3),
        brief_id: input.brief.id,
        ai_run_id: input.aiRunId,
        generated_at: input.generatedAt,
        generation_mode: "local_rule_seed",
      };
    });
  }

  private parseBlueprint(
    value: string | null | undefined,
  ): EpisodeBlueprintPayload | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      const raw = toRecord(parsed);
      if (!raw.title && !raw.summary) return null;
      return raw as EpisodeBlueprintPayload;
    } catch {
      return null;
    }
  }

  private buildLocalPilotScript(
    blueprint: EpisodeBlueprintPayload | null,
    episodeNumber: number,
  ) {
    const title = blueprint?.title || `第${episodeNumber}集`;
    const openingHook = blueprint?.opening_hook || "一个新的冲突在开场爆发。";
    const summary = blueprint?.summary || "主角面对选择，冲突继续升级。";
    const endingHook = blueprint?.ending_hook || "关键答案即将揭晓。";
    const characters = blueprint?.characters?.length
      ? blueprint.characters.join("、")
      : "核心角色";
    const scene = blueprint?.scenes?.[0] || "核心场景";

    return [
      `# ${title}`,
      "",
      `场景：${scene}`,
      `出场：${characters}`,
      "",
      `【开场钩子】${openingHook}`,
      "",
      `【剧情推进】${summary}`,
      "",
      "主角在压力中做出选择，对手或外部阻力随即升级。镜头保持高信息密度，台词优先服务冲突和反转。",
      "",
      `【结尾悬念】${endingHook}`,
      "",
      "> 本正文由本地规则执行器生成，用于打通剧本正文与工作台输入；封版前应替换为真实 AI 生产结果。",
    ].join("\n");
  }

  private buildAiFirstTaskSummary(
    task: typeof tasks.$inferSelect,
  ): AiFirstTaskSummary {
    const resultSummary = toRecord(parseJsonValue(task.resultSummaryJson));
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      title: task.title,
      progress: task.progress,
      result_summary: Object.keys(resultSummary).length ? resultSummary : null,
      error_message: task.errorMessage,
      created_at: task.createdAt,
      updated_at: task.updatedAt,
      started_at: task.startedAt,
      completed_at: task.completedAt,
    };
  }

  private async buildAiFirstPayload(drama: typeof dramas.$inferSelect) {
    const metadata = parseDramaMetadata(drama.metadata);
    const aiFirst = toRecord(metadata.ai_first);
    const sourceId = Number(aiFirst.source_id);
    const [source] =
      Number.isInteger(sourceId) && sourceId > 0
        ? await this.databaseService.db
            .select()
            .from(dramaSources)
            .where(
              and(
                eq(dramaSources.id, sourceId),
                eq(dramaSources.dramaId, drama.id),
                isNull(dramaSources.deletedAt),
              ),
            )
            .limit(1)
        : await this.databaseService.db
            .select()
            .from(dramaSources)
            .where(
              and(
                eq(dramaSources.dramaId, drama.id),
                isNull(dramaSources.deletedAt),
              ),
            )
            .orderBy(desc(dramaSources.createdAt))
            .limit(1);
    const chunkRows = source
      ? await this.databaseService.db
          .select()
          .from(dramaSourceChunks)
          .where(eq(dramaSourceChunks.sourceId, source.id))
          .orderBy(dramaSourceChunks.chunkNo)
      : [];
    const [sourceAnalysisTask] = source
      ? await this.databaseService.db
          .select()
          .from(tasks)
          .where(
            and(
              eq(tasks.domainTable, AI_FIRST_SOURCE_DOMAIN),
              eq(tasks.domainId, source.id),
              isNull(tasks.deletedAt),
            ),
          )
          .limit(1)
      : [];
    const [pilotScriptTask] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, AI_FIRST_PILOT_DOMAIN),
          eq(tasks.domainId, drama.id),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    const [briefTask] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, AI_FIRST_BRIEF_DOMAIN),
          eq(tasks.domainId, drama.id),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    const [blueprintTask] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, AI_FIRST_BLUEPRINT_DOMAIN),
          eq(tasks.domainId, drama.id),
          isNull(tasks.deletedAt),
        ),
      )
      .limit(1);
    const [storyGraphTask] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.domainTable, STORY_GRAPH_DOMAIN),
          eq(tasks.domainId, drama.id),
          isNull(tasks.deletedAt),
        ),
      )
      .orderBy(desc(tasks.updatedAt))
      .limit(1);
    const episodeRows = await this.databaseService.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.dramaId, drama.id), isNull(episodes.deletedAt)))
      .orderBy(episodes.episodeNumber);

    return {
      drama_id: drama.id,
      ai_first_stage: toStringValue(aiFirst.ai_first_stage) || null,
      source_health: aiFirst.source_health ?? null,
      source_analysis: aiFirst.source_analysis ?? null,
      adaptation_briefs: Array.isArray(aiFirst.adaptation_briefs)
        ? aiFirst.adaptation_briefs
        : [],
      selected_brief_id: toStringValue(aiFirst.selected_brief_id),
      source: source
        ? {
            id: source.id,
            source_type: source.sourceType,
            title: source.title,
            content_hash: source.contentHash,
            content_preview: source.content.slice(0, SOURCE_PREVIEW_CHARS),
            content_truncated: source.content.length > SOURCE_PREVIEW_CHARS,
            word_count: source.wordCount,
            estimated_tokens: source.estimatedTokens,
            chapter_count: source.chapterCount,
            status: source.status,
            created_at: source.createdAt,
            updated_at: source.updatedAt,
          }
        : null,
      source_analysis_task: sourceAnalysisTask
        ? this.buildAiFirstTaskSummary(sourceAnalysisTask)
        : null,
      brief_task: briefTask ? this.buildAiFirstTaskSummary(briefTask) : null,
      blueprint_task: blueprintTask
        ? this.buildAiFirstTaskSummary(blueprintTask)
        : null,
      pilot_script_task: pilotScriptTask
        ? this.buildAiFirstTaskSummary(pilotScriptTask)
        : null,
      story_graph_task: storyGraphTask
        ? this.buildAiFirstTaskSummary(storyGraphTask)
        : null,
      source_chunks: chunkRows.map((chunk) => ({
        id: chunk.id,
        chunk_no: chunk.chunkNo,
        title: chunk.title,
        content_start: chunk.contentStart,
        content_end: chunk.contentEnd,
        content_hash: chunk.contentHash,
        estimated_tokens: chunk.estimatedTokens,
        status: chunk.status,
        ai_run_id: chunk.aiRunId,
        remote_run_id: chunk.remoteRunId,
        failure_reason: chunk.failureReason,
      })),
      episodes: episodeRows.map((episode) => ({
        id: episode.id,
        episode_number: episode.episodeNumber,
        title: episode.title,
        status: episode.status,
        has_blueprint: Boolean(episode.blueprintPayload),
        has_script: Boolean(episode.scriptContent?.trim()),
        script_ai_run_id: episode.scriptAiRunId,
        script_remote_run_id: episode.scriptRemoteRunId,
        generation_mode: episode.generationMode,
        failure_reason: episode.failureReason,
      })),
    };
  }
}
