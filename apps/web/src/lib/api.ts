import type {
  AIServiceConfig,
  AIVoice,
  AdaptationBrief,
  AssetRecord,
  Character,
  Drama,
  DramaAiFirstStage,
  Episode,
  EpisodeComposeStatusResponse,
  EpisodeMergeStatusResponse,
  ImageGeneration,
  Scene,
  SourceAnalysis,
  SourceHealth,
  Storyboard,
  TaskListPayload,
  TaskRecord,
  VideoGeneration,
  WritingDetail,
  WritingDocumentPayload,
  WritingListPayload,
} from "@/types/api";
import type { BatchExecutionItem } from "@/components/writing/types";
import type {
  DramaReviewCheckpoint,
  DramaReviewSummary,
} from "@xiaochuang/contracts";
import { buildLoginPath } from "@/lib/login-redirect";

export type { DramaReviewCheckpoint, DramaReviewSummary } from "@xiaochuang/contracts";

const BASE = "/api/v1";
const GET_RESPONSE_CACHE_TTL_MS = 30_000;
const DEBUG_API_LOGS = process.env.NODE_ENV !== "production";
const inflightGetRequests = new Map<string, Promise<unknown>>();
const getResponseCache = new Map<
  string,
  { expiresAt: number; data: unknown }
>();

type ApiRequestOptions = {
  redirectOnUnauthorized?: boolean;
  bypassCache?: boolean;
};

type DramaListParams = {
  page?: number;
  page_size?: number;
  status?: string;
  keyword?: string;
  include_details?: boolean;
};

type DramaAiFirstTaskSummary = {
  id: number;
  type: string;
  status: string;
  title: string | null;
  progress: number | null;
  result_summary: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type StoryGraphEntity = {
  id: number;
  entity_type: string;
  canonical_name: string;
  display_name: string | null;
  role: string | null;
  description: string | null;
  importance: number | null;
  seed_status: string;
  linked_character_id: number | null;
  linked_scene_id: number | null;
  linked_prop_id: number | null;
  seed_conflict: Record<string, unknown>;
};

export type StoryGraphRelation = {
  id: number;
  subject_entity_id: number;
  object_entity_id: number;
  subject_name: string | null;
  object_name: string | null;
  relation_type: string;
  predicate: string;
  description: string | null;
  strength: number | null;
};

export type StoryGraphEvent = {
  id: number;
  event_type: string;
  title: string;
  summary: string | null;
  episode_id: number | null;
  episode_number: number | null;
  script_span_start: number | null;
  script_span_end: number | null;
  emotional_tone: string | null;
  importance: number | null;
};

export type StoryGraphSummaryPayload = {
  graph: {
    id: number;
    drama_id: number;
    status: string;
    version: number;
    script_hash: string;
    current_script_hash: string | null;
    is_stale: boolean;
    build_mode: string;
    stats: Record<string, unknown>;
    summary: Record<string, unknown>;
    failure_reason: string | null;
    created_at: string;
    updated_at: string;
  } | null;
  script_hash: string | null;
  is_stale: boolean;
  scripted_episode_count: number;
  planned_episode_count: number;
  blueprint_episode_count: number;
  missing_blueprint_episode_count: number;
  current_scripted_episode_count: number;
  stale_scripted_episode_count: number;
  scripts_complete: boolean;
  story_graph_task: DramaAiFirstTaskSummary | null;
  ai_first_stage: string | null;
};

export type StoryGraphEntityDetailPayload = {
  entity: StoryGraphEntity & {
    source_trace: Array<Record<string, unknown>>;
  };
  aliases: Array<{
    id: number;
    alias: string;
    alias_type: string;
  }>;
  relations: StoryGraphRelation[];
};

export type StoryGraphSearchHit = {
  chunk_id: number;
  chunk_kind: string;
  ref_id: number | null;
  ref_type: string | null;
  episode_number: number | null;
  title: string | null;
  snippet: string;
  score: number;
  entity_id: number | null;
  relation_id: number | null;
  event_id: number | null;
};

export type StoryGraphSearchPayload = {
  query: string;
  mode: "empty" | "semantic" | "keyword";
  embedding_model: string | null;
  items: StoryGraphSearchHit[];
};

export type StoryGraphIndexStatusPayload = {
  available: boolean;
  total_chunks: number;
  by_kind: Record<string, number>;
  embedding_model: string | null;
  updated_at: string | null;
  pgvector_enabled: boolean;
};

export type DramaAiFirstPayload = {
  drama_id: number;
  ai_first_stage: DramaAiFirstStage | null;
  source_health: SourceHealth | null;
  source_analysis: SourceAnalysis | null;
  adaptation_briefs: AdaptationBrief[];
  selected_brief_id: string;
  source: {
    id: number;
    source_type: "paste" | "upload" | "writing_project" | string;
    title: string | null;
    content_hash: string;
    content_preview: string;
    content_truncated: boolean;
    word_count: number;
    estimated_tokens: number;
    chapter_count: number;
    status: string;
    created_at: string;
    updated_at: string;
  } | null;
  source_analysis_task: DramaAiFirstTaskSummary | null;
  brief_task: DramaAiFirstTaskSummary | null;
  blueprint_task: DramaAiFirstTaskSummary | null;
  pilot_script_task: DramaAiFirstTaskSummary | null;
  story_graph_task: DramaAiFirstTaskSummary | null;
  source_chunks: Array<{
    id: number;
    chunk_no: number;
    title: string | null;
    content_start: number;
    content_end: number;
    content_hash: string;
    estimated_tokens: number;
    status: string;
    ai_run_id: string | null;
    remote_run_id: string | null;
    failure_reason: string | null;
  }>;
  episodes: Array<{
    id: number;
    episode_number: number;
    title: string | null;
    status: string | null;
    has_blueprint: boolean;
    has_script: boolean;
    script_ai_run_id: string | null;
    script_remote_run_id: string | null;
    generation_mode: string | null;
    failure_reason: string | null;
  }>;
};

export type DramaWorkspacePayload = {
  project: Drama & {
    read_only?: boolean;
    episode_count?: number;
    character_count?: number;
    scene_count?: number;
  };
  counts: {
    episodes: number;
    scripted_episodes: number;
    storyboard_episodes: number;
    storyboards: number;
    characters: number;
    scenes: number;
    assets: number;
    canvases: number;
    active_tasks: number;
    failed_tasks: number;
  };
  production: {
    first_frame_done: number;
    first_frame_total: number;
    tts_done: number;
    tts_total: number;
    video_done: number;
    video_total: number;
    gaps: Array<{
      key: string;
      label: string;
      count: number;
      href: string;
    }>;
  };
  health: {
    score: number;
    status: "healthy" | "attention" | "blocked" | string;
  };
  next_steps: Array<{
    key: string;
    title: string;
    description: string;
    href: string;
    severity: "high" | "medium" | "low" | string;
  }>;
  recent_tasks: Array<{
    id: number;
    type: string;
    status: string;
    title: string | null;
    progress: number | null;
    source_type: string;
    drama_id: number | null;
    episode_id: number | null;
    storyboard_id: number | null;
    error_message: string | null;
    created_at: string;
    updated_at: string;
  }>;
  canvases: Array<{
    id: string;
    title: string;
    source: string;
    source_episode_id: string | null;
    updated_at: string;
    href: string;
  }>;
  episodes: Array<{
    id: number;
    episode_number: number;
    title: string;
    status: string | null;
    has_script: boolean;
    review_status: string | null;
    storyboard_count: number;
    missing_first_frame_count: number;
    href: string;
  }>;
};

export type DramaCanvasSummary = {
  id: string;
  title: string;
  source: string;
  profile: string;
  thumbnail: string | null;
  source_drama_id: string | null;
  source_episode_id: string | null;
  source_storyboard_id: string | null;
  source_drama_title: string | null;
  updated_at: string;
  created_at: string;
  href: string;
};

export type DramaProjectAsset = {
  id: number | string;
  asset_id: number;
  kind: "image" | "video" | "audio";
  title: string;
  url: string | null;
  thumbnail_url: string | null;
  scope: string;
  status: string;
  review_status: "pending_confirmation" | "confirmed" | "rework_required" | "stale" | "archived";
  quality_status: "not_evaluated" | "passed" | "warning" | "failed";
  quality_reasons: Array<{ code: string; message: string; source?: string }>;
  version_key: string;
  review: { reviewed_by: number | null; reviewed_at: string | null };
  role: string;
  target_type: string | null;
  target_id: string | null;
  target_field: string | null;
  source_module: string | null;
  source_canvas_id: string | null;
  source_node_id: string | null;
  source_result_id: string | null;
  source_task_id: number | null;
  source_path: string | null;
  episode_id: number | null;
  storyboard_id: number | null;
  previous_asset_id: number | null;
  created_at: string;
  updated_at: string;
};

export type DramaDefaultSettingsPayload = {
  settings: Record<string, unknown>;
  resolved: Record<string, unknown>;
  version: string;
  updated_at: string;
};

export type DramaShotTarget = "first_frame" | "voiceover" | "video";

export type DramaShotSlot = {
  target: DramaShotTarget;
  status: "completed" | "running" | "failed" | "missing" | string;
  asset_url: string | null;
  task_id: number | null;
  error_kind: string | null;
  error_message: string | null;
};

export type DramaShotRow = {
  id: number;
  drama_id: number;
  episode_id: number;
  episode_number: number;
  episode_title: string;
  storyboard_number: number;
  title: string | null;
  description: string | null;
  dialogue: string | null;
  image_prompt: string | null;
  video_prompt: string | null;
  first_frame: DramaShotSlot;
  voiceover: DramaShotSlot;
  video: DramaShotSlot;
};

export type DramaShotListPayload = {
  items: DramaShotRow[];
  total: number;
  page: number;
  page_size: number;
  summary: {
    total: number;
    first_frame_missing: number;
    voiceover_missing: number;
    video_missing: number;
    running: number;
    failed: number;
  };
};

export type DramaShotBatchPreviewItem = {
  storyboard_id: number;
  episode_id: number;
  episode_number: number;
  storyboard_number: number;
  target: DramaShotTarget;
  current_status: string;
  action: "create" | "skip" | "blocked";
  reason: string;
};

export type DramaShotBatchPreviewPayload = {
  items: DramaShotBatchPreviewItem[];
  summary: {
    create: number;
    skip: number;
    blocked: number;
  };
};

export type DramaShotBatchGeneratePayload = {
  task_group_id: string;
  requested: number;
  created: number;
  skipped: number;
  blocked: number;
  items: Array<DramaShotBatchPreviewItem & { status: string; error?: string }>;
};

export type StoryboardDraftPreview = {
  set_id: number;
  drama_id: number;
  episode_id: number;
  revision: number;
  status: string;
  origin: string;
  source_task_id: number | null;
  source_execution_id: number | null;
  base_revision: number | null;
  base_content_hash: string | null;
  created_at: string;
  updated_at: string;
  current_baseline: {
    active_set_id: number | null;
    revision: number | null;
    content_hash: string | null;
    storyboard_count: number;
    has_legacy_rows: boolean;
    has_mixed_sets: boolean;
    human_edited_at: string | null;
    has_produced_media: boolean;
  };
  items: Array<{
    shot_number: number;
    title: string | null;
    shot_type: string | null;
    angle: string | null;
    movement: string | null;
    location: string | null;
    time: string | null;
    action: string | null;
    dialogue: string | null;
    description: string | null;
    result: string | null;
    atmosphere: string | null;
    image_prompt: string | null;
    video_prompt: string | null;
    bgm_prompt: string | null;
    sound_effect: string | null;
    duration: number;
    scene_id: number | null;
    character_ids: number[];
  }>;
};

export type StoryboardDraftPublishResult = {
  set_id: number;
  revision: number;
  status: "ready" | "review_required" | string;
  storyboard_count: number;
  requires_review: boolean;
};

function isApiRequestOptions(
  value: DramaListParams | ApiRequestOptions | undefined,
): value is ApiRequestOptions {
  return (
    typeof value === "object" &&
    value !== null &&
    ("redirectOnUnauthorized" in value || "bypassCache" in value)
  );
}

function buildQueryString(
  params: Record<string, string | number | boolean | null | undefined>,
) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    query.set(key, String(value));
  }
  return query.toString();
}

function parseApiJsonBody(text: string, path: string, status: number): unknown {
  const trimmed = text.trimStart();
  if (!trimmed) {
    throw new Error(
      `接口 ${path} 返回了空响应（HTTP ${status}），请检查服务端日志或确认后端服务已启动`,
    );
  }
  const looksHtml =
    trimmed.startsWith("<") ||
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.toLowerCase().includes("<html");
  if (looksHtml) {
    const staleHint =
      status === 500
        ? " 若刚改过 API 路由或开发缓存损坏，可在 apps/web 目录执行 `npm run dev:clean` 后重启；项目已将开发/生产产物隔离到 `.next-dev` / `.next-prod`，避免静态资源互相污染。"
        : "";
    throw new Error(
      `接口 ${path} 返回了网页（HTTP ${status}）而不是 JSON，通常是 Next API 未就绪、页面崩溃，或服务启动异常。请确认 apps/web 已单独正常启动，并检查终端里的服务端报错。${staleHint}`,
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    const preview = text.length > 160 ? `${text.slice(0, 160)}…` : text;
    throw new Error(
      `接口 ${path} 返回了无效的 JSON（HTTP ${status}）：${preview}`,
    );
  }
}

function formatRequestError(error: unknown, path: string): Error {
  if (
    error instanceof Error &&
    /Headers Timeout Error|fetch failed/i.test(error.message)
  ) {
    return new Error(`请求 ${path} 失败，请确认 Docker/Redis 与后端服务已启动`);
  }
  return error instanceof Error ? error : new Error(String(error));
}

function looksLikeStructuredApiEnvelope(text: string) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;
  return (
    /"code"\s*:/.test(trimmed) &&
    /"message"\s*:/.test(trimmed) &&
    /"data"\s*:/.test(trimmed)
  );
}

function looksLikeHtmlDocument(text: string) {
  const trimmed = text.trimStart().toLowerCase();
  return (
    trimmed.startsWith("<!doctype") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<body")
  );
}

async function req<T = unknown>(
  method: string,
  path: string,
  body?: unknown,
  options?: ApiRequestOptions,
): Promise<T> {
  const dedupeKey =
    method === "GET" && options?.bypassCache !== true
      ? `${method}:${path}:redirect=${options?.redirectOnUnauthorized !== false}`
      : null;
  if (dedupeKey) {
    const cached = getResponseCache.get(dedupeKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as T;
    }
    if (cached) {
      getResponseCache.delete(dedupeKey);
    }

    const inflight = inflightGetRequests.get(dedupeKey);
    if (inflight) {
      return inflight as Promise<T>;
    }
  }

  const execute = async () => {
    const opts: RequestInit = {
      method,
    };
    if (body !== undefined) {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(body);
    }

    const start = performance.now();
    if (DEBUG_API_LOGS) {
      console.log(
        `%c[API] %c${method} %c${path}`,
        "color:#888",
        "color:#4fc3f7;font-weight:bold",
        "color:#ccc",
        body || "",
      );
    }

    try {
      const resp = await fetch(`${BASE}${path}`, opts);
      const text = await resp.text();
      const json = parseApiJsonBody(text, path, resp.status) as {
        code?: number;
        message?: string;
        data?: unknown;
      };
      const ms = Math.round(performance.now() - start);

      if (
        resp.status === 401 &&
        options?.redirectOnUnauthorized !== false &&
        typeof window !== "undefined"
      ) {
        const next = `${window.location.pathname}${window.location.search}`;
        if (!window.location.pathname.startsWith("/login")) {
          window.location.assign(buildLoginPath(next));
        }
      }

      if (!resp.ok || (json.code && json.code >= 400)) {
        if (DEBUG_API_LOGS) {
          console.log(
            `%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`,
            "color:#888",
            "color:#ef5350",
            "color:#ef5350;font-weight:bold",
            "color:#888",
            json.message || "",
          );
        }
        throw new Error(json.message || `${resp.status}`);
      }

      if (DEBUG_API_LOGS) {
        console.log(
          `%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`,
          "color:#888",
          "color:#66bb6a",
          "color:#66bb6a;font-weight:bold",
          "color:#888",
        );
      }
      const data = (json.data ?? json) as T;
      if (dedupeKey) {
        getResponseCache.set(dedupeKey, {
          data,
          expiresAt: Date.now() + GET_RESPONSE_CACHE_TTL_MS,
        });
      } else if (method !== "GET") {
        getResponseCache.clear();
      }
      return data;
    } catch (err: unknown) {
      const error = formatRequestError(err, path);
      if (DEBUG_API_LOGS && !error.message?.match(/^\d{3}$/)) {
        const ms = Math.round(performance.now() - start);
        console.log(
          `%c[API] %c${method} ${path} %cERROR %c${ms}ms`,
          "color:#888",
          "color:#ef5350",
          "color:#ef5350;font-weight:bold",
          "color:#888",
          error.message,
        );
      }
      throw error;
    }
  };

  const requestPromise = execute();
  if (dedupeKey) {
    inflightGetRequests.set(dedupeKey, requestPromise);
    requestPromise.finally(() => {
      if (inflightGetRequests.get(dedupeKey) === requestPromise) {
        inflightGetRequests.delete(dedupeKey);
      }
    });
  }
  return requestPromise;
}

export const api = {
  get: <T = unknown>(p: string, options?: ApiRequestOptions) =>
    req<T>("GET", p, undefined, options),
  post: <T = unknown>(p: string, b?: unknown, options?: ApiRequestOptions) =>
    req<T>("POST", p, b, options),
  put: <T = unknown>(p: string, b?: unknown, options?: ApiRequestOptions) =>
    req<T>("PUT", p, b, options),
  patch: <T = unknown>(p: string, b?: unknown, options?: ApiRequestOptions) =>
    req<T>("PATCH", p, b, options),
  del: <T = unknown>(p: string, options?: ApiRequestOptions) =>
    req<T>("DELETE", p, undefined, options),
};

export const dramaAPI = {
  list: (
    paramsOrOptions?: DramaListParams | ApiRequestOptions,
    options?: ApiRequestOptions,
  ) => {
    const params = isApiRequestOptions(paramsOrOptions)
      ? undefined
      : paramsOrOptions;
    const requestOptions = isApiRequestOptions(paramsOrOptions)
      ? paramsOrOptions
      : options;
    const query = buildQueryString({
      page: params?.page,
      page_size: params?.page_size,
      status: params?.status,
      keyword: params?.keyword,
      include_details:
        params?.include_details === undefined
          ? undefined
          : params.include_details
            ? 1
            : 0,
    });
    return api.get<{ items: Drama[] }>(
      `/dramas${query ? `?${query}` : ""}`,
      requestOptions,
    );
  },
  stats: (options?: ApiRequestOptions) =>
    api.get<{
      total: number;
      by_status: Array<{ status: string; count: number }>;
    }>("/dramas/stats", options),
  get: (id: number, options?: ApiRequestOptions) =>
    api.get<Drama>(`/dramas/${id}`, options),
  workspace: (id: number, options?: ApiRequestOptions) =>
    api.get<DramaWorkspacePayload>(`/dramas/${id}/workspace`, options),
  getAiFirst: (id: number, options?: ApiRequestOptions) =>
    api.get<DramaAiFirstPayload>(`/dramas/${id}/ai-first`, options),
  saveSource: (
    id: number,
    data: {
      content: string;
      title?: string | null;
      source_type?: "paste" | "upload" | "writing_project";
    },
  ) => api.post<DramaAiFirstPayload>(`/dramas/${id}/source`, data),
  checkSourceHealth: (id: number, data?: { content?: string | null }) =>
    api.post<{ source_health: SourceHealth }>(
      `/dramas/${id}/source/health-check`,
      data || {},
    ),
  analyzeSource: (id: number) =>
    api.post<DramaAiFirstPayload>(`/dramas/${id}/source/analyze`),
  generateAdaptationBriefs: (
    id: number,
    data?: {
      count?: number;
      target_episode_count?: number | null;
      episode_duration?: string | null;
      style_direction?: string | null;
    },
  ) =>
    api.post<DramaAiFirstPayload>(
      `/dramas/${id}/adaptation-briefs`,
      data || {},
    ),
  selectAdaptationBrief: (id: number, briefId: string) =>
    api.post<DramaAiFirstPayload>(
      `/dramas/${id}/adaptation-briefs/${encodeURIComponent(briefId)}/select`,
    ),
  generateEpisodeBlueprints: (
    id: number,
    data?: {
      replace_without_script?: boolean;
      adaptation_config?: {
        target_episode_count?: number;
        episode_duration?: string;
        style_direction?: string;
        visual_style?: string;
        aspect_rhythm?: string;
      };
    },
  ) =>
    api.post<DramaAiFirstPayload>(
      `/dramas/${id}/episode-blueprints`,
      data || {},
    ),
  generatePilotScripts: (
    id: number,
    data?: { limit?: number; episode_ids?: number[] },
  ) => api.post<DramaAiFirstPayload>(`/dramas/${id}/pilot-scripts`, data || {}),
  getStoryGraph: (id: number, options?: ApiRequestOptions) =>
    api.get<StoryGraphSummaryPayload>(`/dramas/${id}/story-graph`, options),
  buildStoryGraph: (id: number, data?: { force?: boolean }) =>
    api.post<StoryGraphSummaryPayload>(
      `/dramas/${id}/story-graph/build`,
      data || {},
    ),
  listStoryGraphEntities: (
    id: number,
    params?: { type?: string },
    options?: ApiRequestOptions,
  ) => {
    const query = params ? buildQueryString(params) : "";
    return api.get<{ items: StoryGraphEntity[] }>(
      `/dramas/${id}/story-graph/entities${query}`,
      options,
    );
  },
  getStoryGraphEntity: (
    dramaId: number,
    entityId: number,
    options?: ApiRequestOptions,
  ) =>
    api.get<StoryGraphEntityDetailPayload>(
      `/dramas/${dramaId}/story-graph/entities/${entityId}`,
      options,
    ),
  listStoryGraphRelations: (id: number, options?: ApiRequestOptions) =>
    api.get<{ items: StoryGraphRelation[] }>(
      `/dramas/${id}/story-graph/relations`,
      options,
    ),
  listStoryGraphEvents: (id: number, options?: ApiRequestOptions) =>
    api.get<{ items: StoryGraphEvent[] }>(
      `/dramas/${id}/story-graph/events`,
      options,
    ),
  seedStoryGraphAssets: (id: number) =>
    api.post<{ seeded: boolean }>(`/dramas/${id}/story-graph/seed-assets`),
  searchStoryGraph: (
    id: number,
    data: { query: string; kinds?: string[]; limit?: number },
  ) =>
    api.post<StoryGraphSearchPayload>(`/dramas/${id}/story-graph/search`, data),
  getStoryGraphIndexStatus: (id: number, options?: ApiRequestOptions) =>
    api.get<StoryGraphIndexStatusPayload>(
      `/dramas/${id}/story-graph/index-status`,
      options,
    ),
  preSeedStoryGraphFromWriting: (
    id: number,
    data?: { writing_id?: number; rebuild_index?: boolean },
  ) =>
    api.post<{
      writing_id: number;
      merged_entities: number;
      diff?: Record<string, unknown>;
      search_index?: Record<string, unknown> | null;
    }>(`/dramas/${id}/story-graph/pre-seed-writing`, data || {}),
  create: (data: Record<string, unknown>) => api.post("/dramas", data),
  splitEpisodes: (id: number, data: Record<string, unknown>) =>
    api.post<{ count: number; episodes: unknown[] }>(
      `/dramas/${id}/split-episodes`,
      data,
    ),
  update: (id: number, data: Record<string, unknown>) =>
    api.put(`/dramas/${id}`, data),
  del: (id: number) => api.del(`/dramas/${id}`),
};

export const dramaWorkspaceAPI = {
  listCanvases: (
    dramaId: number,
    params?: { episode_id?: number; page?: number; page_size?: number },
    options?: ApiRequestOptions,
  ) => {
    const query = buildQueryString({
      episode_id: params?.episode_id,
      page: params?.page,
      page_size: params?.page_size,
    });
    return api.get<{
      items: DramaCanvasSummary[];
      total: number;
      page: number;
      page_size: number;
    }>(`/dramas/${dramaId}/canvases${query ? `?${query}` : ""}`, options);
  },
  createCanvas: (
    dramaId: number,
    body: {
      title?: string;
      scope?: "project" | "episode" | "storyboard";
      episode_id?: number;
      storyboard_id?: number;
      mode?: "blank" | "from_episode";
    },
  ) => api.post<DramaCanvasSummary>(`/dramas/${dramaId}/canvases`, body),
  createCanvasFromEpisode: (
    dramaId: number,
    body: {
      episode_id: number;
      title?: string;
      sync_mode?: "append_missing" | "rebuild_projection";
      include?: Array<
        "characters" | "scenes" | "storyboards" | "execution_nodes"
      >;
      layout?: "timeline" | "columns";
    },
  ) =>
    api.post<{
      canvas: DramaCanvasSummary;
      projection: Record<string, unknown>;
    }>(`/dramas/${dramaId}/canvases/from-episode`, body),
  syncCanvas: (
    dramaId: number,
    canvasId: string,
    body: {
      episode_id?: number;
      sync_mode?: "append_missing" | "rebuild_projection";
      preserve_user_nodes?: boolean;
    },
  ) =>
    api.post<Record<string, unknown>>(
      `/dramas/${dramaId}/canvases/${encodeURIComponent(canvasId)}/sync`,
      body,
    ),
  listProjectAssets: (
    dramaId: number,
    params?: {
      kind?: "image" | "video" | "audio";
      scope?: string;
      status?: string;
      review_status?: DramaProjectAsset['review_status'];
      quality_status?: DramaProjectAsset['quality_status'];
      needs_attention?: boolean;
      role?: string;
      episode_id?: number;
      storyboard_id?: number;
      q?: string;
      page?: number;
      page_size?: number;
    },
    options?: ApiRequestOptions,
  ) => {
    const query = buildQueryString({
      kind: params?.kind,
      scope: params?.scope,
      status: params?.status,
      review_status: params?.review_status,
      quality_status: params?.quality_status,
      needs_attention: params?.needs_attention,
      role: params?.role,
      episode_id: params?.episode_id,
      storyboard_id: params?.storyboard_id,
      q: params?.q,
      page: params?.page,
      page_size: params?.page_size,
    });
    return api.get<{
      items: DramaProjectAsset[];
      total: number;
      page: number;
      page_size: number;
    }>(`/dramas/${dramaId}/project-assets${query ? `?${query}` : ""}`, options);
  },
  saveCanvasResultToProjectAssets: (
    dramaId: number,
    body: {
      canvas_id: string;
      node_id: string;
      result_id?: string;
      asset_scope?: "project" | "episode" | "storyboard" | "canvas";
      asset_role?: string;
      episode_id?: number;
      storyboard_id?: number;
      target_type?: "character" | "scene" | "storyboard" | "episode" | "drama";
      target_id?: string;
      target_field?: string;
      title?: string;
    },
  ) =>
    api.post<DramaProjectAsset>(
      `/dramas/${dramaId}/project-assets/from-canvas-result`,
      body,
    ),
  commitProjectAsset: (
    dramaId: number,
    assetId: number,
    body: {
      target_type: "character" | "scene" | "storyboard" | "episode" | "drama";
      target_id: string;
      target_field: string;
      commit_scope?: "project" | "episode" | "storyboard";
      replace_existing?: boolean;
    },
  ) =>
    api.post<{
      success: boolean;
      previous_asset_id: number | null;
      item: DramaProjectAsset;
    }>(`/dramas/${dramaId}/project-assets/${assetId}/commit`, body),
  rejectProjectAsset: (dramaId: number, assetId: number) =>
    api.post<{ success: boolean }>(
      `/dramas/${dramaId}/project-assets/${assetId}/reject`,
    ),
  archiveProjectAsset: (dramaId: number, assetId: number) =>
    api.post<{ success: boolean }>(
      `/dramas/${dramaId}/project-assets/${assetId}/archive`,
    ),
  confirmProjectAssetLink: (
    dramaId: number,
    body: { asset_link_id: number; version_key: string; note?: string },
  ) =>
    api.post<DramaProjectAsset>(`/dramas/${dramaId}/reviews/confirm`, {
      subject_type: 'asset_link',
      ...body,
    }),
  batchConfirmProjectAssetLinks: (
    dramaId: number,
    body: { asset_link_ids: number[]; version_keys: Record<string, string> },
  ) => api.post<{ confirmed_link_ids: number[] }>(`/dramas/${dramaId}/reviews/batch-confirm`, body),
  requireProjectAssetRework: (
    dramaId: number,
    body: { asset_link_id: number; reason_code: string; note?: string },
  ) =>
    api.post<{ success: boolean }>(`/dramas/${dramaId}/reviews/rework`, {
      subject_type: 'asset_link',
      ...body,
    }),
  getReviewSummary: (dramaId: number, options?: ApiRequestOptions) =>
    api.get<DramaReviewSummary>(`/dramas/${dramaId}/reviews/summary`, options),
  confirmReviewCheckpoint: (
    dramaId: number,
    body: {
      subject_type: DramaReviewCheckpoint['subject_type'];
      subject_id: string;
      version_key: string;
      note?: string;
    },
  ) => api.post<DramaReviewCheckpoint>(`/dramas/${dramaId}/reviews/confirm`, body),
  requireReviewCheckpointRework: (
    dramaId: number,
    body: {
      subject_type: DramaReviewCheckpoint['subject_type'];
      subject_id: string;
      reason_code: string;
      note?: string;
    },
  ) => api.post<DramaReviewCheckpoint>(`/dramas/${dramaId}/reviews/rework`, body),
  getDefaultSettings: (dramaId: number, options?: ApiRequestOptions) =>
    api.get<DramaDefaultSettingsPayload>(
      `/dramas/${dramaId}/default-settings`,
      options,
    ),
  updateDefaultSettings: (dramaId: number, body: Record<string, unknown>) =>
    api.patch<DramaDefaultSettingsPayload>(
      `/dramas/${dramaId}/default-settings`,
      body,
    ),
  listShots: (
    dramaId: number,
    params?: {
      episode_id?: number;
      storyboard_id?: number;
      missing?: DramaShotTarget;
      q?: string;
      page?: number;
      page_size?: number;
    },
    options?: ApiRequestOptions,
  ) => {
    const query = buildQueryString({
      episode_id: params?.episode_id,
      storyboard_id: params?.storyboard_id,
      missing: params?.missing,
      q: params?.q,
      page: params?.page,
      page_size: params?.page_size,
    });
    return api.get<DramaShotListPayload>(
      `/dramas/${dramaId}/shots${query ? `?${query}` : ""}`,
      options,
    );
  },
  previewShotBatch: (
    dramaId: number,
    body: {
      episode_id?: number;
      storyboard_ids?: number[];
      targets?: DramaShotTarget[];
      replace_existing?: boolean;
    },
  ) =>
    api.post<DramaShotBatchPreviewPayload>(
      `/dramas/${dramaId}/shots/batch-preview`,
      body,
    ),
  generateShotBatch: (
    dramaId: number,
    body: {
      episode_id?: number;
      storyboard_ids?: number[];
      targets?: DramaShotTarget[];
      replace_existing?: boolean;
    },
  ) =>
    api.post<DramaShotBatchGeneratePayload>(
      `/dramas/${dramaId}/shots/batch-generate`,
      body,
    ),
  listProjectTasks: (
    dramaId: number,
    params?: {
      episode_id?: number;
      storyboard_id?: number;
      type?: string;
      status?: string;
      q?: string;
      page?: number;
      page_size?: number;
      sort?: "created_at" | "updated_at";
      order?: "asc" | "desc";
    },
    options?: ApiRequestOptions,
  ) => {
    const query = buildQueryString({
      episode_id: params?.episode_id,
      storyboard_id: params?.storyboard_id,
      type: params?.type,
      status: params?.status,
      q: params?.q,
      page: params?.page,
      page_size: params?.page_size,
      sort: params?.sort,
      order: params?.order,
    });
    return api.get<TaskListPayload>(
      `/dramas/${dramaId}/tasks${query ? `?${query}` : ""}`,
      options,
    );
  },
};

export type EpisodeContinuityBoundary = {
  id: number;
  episode_id: number;
  from_storyboard_id: number;
  to_storyboard_id: number;
  from_storyboard_number: number | null;
  to_storyboard_number: number | null;
  from_title: string | null;
  to_title: string | null;
  relation_type: "continuous" | "intentional_cut" | string;
  transition_type: string;
  status: string;
  handoff: Record<string, unknown>;
  asset_lock: Record<string, unknown>;
  review: Record<string, unknown>;
};

export type EpisodeContinuityPreflight = {
  ready: boolean;
  episode_id: number;
  storyboard_set_id: number | null;
  boundaries: {
    total: number;
    continuous: number;
    intentional_cuts: number;
    blocked: number;
  };
  blocks: Array<{
    boundary_id: number | null;
    code: string;
    message: string;
  }>;
};

export type EpisodeContinuityPayload = {
  episode_id: number;
  storyboard_set_id: number | null;
  storyboard_count: number;
  expected_boundary_count: number;
  boundaries: EpisodeContinuityBoundary[];
};

export type EpisodeContinuityRunItem = {
  id: number;
  storyboard_id: number;
  boundary_id: number | null;
  sequence_index: number;
  predecessor_item_id: number | null;
  status: string;
  start_anchor_url: string | null;
  planned_end_anchor_url: string | null;
  actual_first_frame_url: string | null;
  actual_tail_frame_url: string | null;
  video_generation_id: number | null;
  failure_code: string | null;
  failure_detail: string | null;
};

export type EpisodeContinuityRun = {
  id: number;
  episode_id: number;
  storyboard_set_id: number;
  status: string;
  current_storyboard_id: number | null;
  started_at: string | null;
  completed_at: string | null;
  items: EpisodeContinuityRunItem[];
};

export type EpisodeDialogueCue = {
  id: number;
  storyboard_id: number;
  boundary_id: number | null;
  take_in_ms: number | null;
  take_out_ms: number | null;
  timeline_in_ms: number | null;
  cue_mode:
    | "within_shot"
    | "continue_from_previous"
    | "lead_into_next"
    | "overlap";
  sync_policy: "required" | "preferred" | "not_required";
  subtitle_segments: Array<{
    start_ms?: number;
    end_ms?: number;
    text?: string;
  }>;
  status: string;
};

export type EpisodeDialogueTake = {
  id: number;
  episode_id: number;
  source_storyboard_set_id: number | null;
  speaker_character_id: number | null;
  speaker_name: string;
  voice_snapshot: Record<string, unknown>;
  text: string;
  performance: Record<string, unknown>;
  audio_url: string | null;
  duration_ms: number | null;
  timings: Array<{ start_ms?: number; end_ms?: number; text?: string }>;
  timing_source: string | null;
  status: string;
  task_id: number | null;
  failure_code: string | null;
  failure_detail: string | null;
  cues: EpisodeDialogueCue[];
  updated_at: string | null;
};

export type EpisodeDialogueTakePreview = {
  ready: boolean;
  episode_id: number;
  storyboard_set_id: number | null;
  blocks: Array<{
    code: string;
    message: string;
    storyboard_id?: number;
  }>;
  takes: Array<{
    plan_index: number;
    speaker_name: string;
    speaker_character_id: number | null;
    voice_snapshot: Record<string, unknown> | null;
    text: string;
    performance: Record<string, unknown>;
    source_storyboard_ids: number[];
    cues: Array<{
      storyboard_id: number;
      boundary_id: number | null;
      cue_mode: EpisodeDialogueCue["cue_mode"];
      sync_policy: EpisodeDialogueCue["sync_policy"];
      source_text: string;
    }>;
  }>;
};

export type EpisodeEditRevisionPreview = {
  ready: boolean;
  episode_id: number;
  drama_id: number;
  production_run_id: number | null;
  blocks: Array<{
    code: string;
    message: string;
    boundary_id?: number;
    take_id?: number;
  }>;
  timeline: {
    version: number;
    clips: Array<{
      storyboard_id: number;
      storyboard_number: number;
      video_generation_id: number;
      video_url: string;
      transition: { type: string; boundary_id: number | null } | null;
      audio_policy: string;
    }>;
    dialogue_cues: Array<{
      cue_id: number;
      dialogue_take_id: number;
      audio_url: string;
      speaker_name: string;
      take_in_ms: number;
      take_out_ms: number;
      timeline_in_ms: number;
      cue_mode: string;
      sync_policy: string;
      subtitle_segments: Array<{
        start_ms?: number;
        end_ms?: number;
        text?: string;
      }>;
    }>;
    audio_tracks: {
      dialogue_source: string;
      original_video_audio_default: string;
    };
  };
  source_snapshot: Record<string, unknown>;
};

export type EpisodeEditRevision = {
  id: number;
  episode_id: number;
  production_run_id: number | null;
  timeline: EpisodeEditRevisionPreview["timeline"];
  source_snapshot: Record<string, unknown>;
  status: string;
  merged_video_url: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  created_at: string | null;
  updated_at: string | null;
  completed_at: string | null;
};

export const episodeAPI = {
  get: (id: number) => api.get<Episode>(`/episodes/${id}`),
  create: (data: Record<string, unknown>) => api.post("/episodes", data),
  update: (id: number, data: Record<string, unknown>) =>
    api.put(`/episodes/${id}`, data),
  patchBlueprint: (
    id: number,
    data: {
      blueprint_payload: unknown;
      source_trace?: unknown;
      generation_mode?: string | null;
    },
  ) => api.patch<Episode>(`/episodes/${id}/blueprint`, data),
  regenerateBlueprint: (id: number) =>
    api.post<Episode>(`/episodes/${id}/regenerate-blueprint`),
  generateScript: (id: number) =>
    api.post<Episode>(`/episodes/${id}/generate-script`),
  rewriteScript: (id: number) =>
    api.post<Episode>(`/episodes/${id}/rewrite-script`),
  requestStoryboardBreakdown: (id: number) =>
    api.post<{
      runtime_enabled: boolean;
      task_id?: number;
      status?: string;
      episode_id?: number;
    }>(`/episodes/${id}/storyboard-breakdown`),
  storyboardDraft: (id: number, options?: ApiRequestOptions) =>
    api.get<{ draft: StoryboardDraftPreview | null }>(
      `/episodes/${id}/storyboard-draft`,
      options,
    ),
  characters: (id: number) =>
    api.get<Character[]>(`/episodes/${id}/characters`),
  scenes: (id: number) => api.get<Scene[]>(`/episodes/${id}/scenes`),
  storyboards: (id: number) =>
    api.get<Storyboard[]>(`/episodes/${id}/storyboards`),
  pipelineStatus: (id: number) => api.get(`/episodes/${id}/pipeline-status`),
};

export const episodeContinuityAPI = {
  get: (episodeId: number) =>
    api.get<EpisodeContinuityPayload>(`/episodes/${episodeId}/continuity`),
  preflight: (episodeId: number) =>
    api.post<EpisodeContinuityPreflight>(
      `/episodes/${episodeId}/continuity/preflight`,
    ),
  previewRun: (episodeId: number) =>
    api.post<
      EpisodeContinuityPreflight & {
        will_generate: Array<{ storyboard_id: number; mode: string }>;
        will_wait: Array<{
          storyboard_id: number;
          depends_on_storyboard_id: number;
          reason: string;
        }>;
      }
    >(`/episodes/${episodeId}/continuity/runs/preview`),
  createRun: (episodeId: number) =>
    api.post<{
      run: EpisodeContinuityRun;
      video_generation_ids: number[];
      enqueue_failures: Array<{ storyboard_id: number; code: string }>;
    }>(`/episodes/${episodeId}/continuity/runs`),
  getLatestRun: (episodeId: number) =>
    api.get<EpisodeContinuityRun | null>(
      `/episodes/${episodeId}/continuity/runs/latest`,
    ),
  getRun: (episodeId: number, runId: number) =>
    api.get<EpisodeContinuityRun>(
      `/episodes/${episodeId}/continuity/runs/${runId}`,
    ),
  cancelRun: (episodeId: number, runId: number) =>
    api.post<EpisodeContinuityRun>(
      `/episodes/${episodeId}/continuity/runs/${runId}/cancel`,
    ),
  retryRun: (episodeId: number, runId: number) =>
    api.post<EpisodeContinuityRun>(
      `/episodes/${episodeId}/continuity/runs/${runId}/retry`,
    ),
  updateBoundary: (
    episodeId: number,
    boundaryId: number,
    body: Partial<{
      relation_type: "continuous" | "intentional_cut";
      transition_type: "hard_cut" | "match_cut" | "dissolve" | "fade";
      opening_state: Record<string, unknown>;
      closing_state: Record<string, unknown>;
      handoff: Record<string, unknown>;
      asset_lock: Record<string, unknown>;
    }>,
  ) =>
    api.patch<EpisodeContinuityPayload>(
      `/episodes/${episodeId}/continuity/boundaries/${boundaryId}`,
      body,
    ),
  reviewBoundary: (
    episodeId: number,
    boundaryId: number,
    body: { decision: "approve" | "rework"; note?: string },
  ) =>
    api.post<EpisodeContinuityPayload>(
      `/episodes/${episodeId}/continuity/boundaries/${boundaryId}/review`,
      body,
    ),
  getDialogueTakes: (episodeId: number) =>
    api.get<{ episode_id: number; takes: EpisodeDialogueTake[] }>(
      `/episodes/${episodeId}/continuity/dialogue-takes`,
    ),
  previewDialogueTakes: (episodeId: number) =>
    api.post<EpisodeDialogueTakePreview>(
      `/episodes/${episodeId}/continuity/dialogue-takes/preview`,
    ),
  createDialogueTakes: (episodeId: number) =>
    api.post<{ take_ids: number[]; task_ids: number[]; status: string }>(
      `/episodes/${episodeId}/continuity/dialogue-takes`,
    ),
  regenerateDialogueTake: (episodeId: number, takeId: number) =>
    api.post<{ take_id: number; task_id: number; status: string }>(
      `/episodes/${episodeId}/continuity/dialogue-takes/${takeId}/regenerate`,
    ),
  updateDialogueCue: (
    episodeId: number,
    cueId: number,
    body: Partial<{
      take_in_ms: number;
      take_out_ms: number;
      timeline_in_ms: number;
      cue_mode: EpisodeDialogueCue["cue_mode"];
      sync_policy: EpisodeDialogueCue["sync_policy"];
      subtitle_segments: EpisodeDialogueCue["subtitle_segments"];
      status: "planned" | "alignment_review_required" | "approved";
    }>,
  ) =>
    api.patch<{ episode_id: number; takes: EpisodeDialogueTake[] }>(
      `/episodes/${episodeId}/continuity/dialogue-cues/${cueId}`,
      body,
    ),
  getEditRevisions: (episodeId: number) =>
    api.get<{ episode_id: number; revisions: EpisodeEditRevision[] }>(
      `/episodes/${episodeId}/continuity/edit-revisions`,
    ),
  previewEditRevision: (
    episodeId: number,
    body: { audio_policies?: Record<string, string> } = {},
  ) =>
    api.post<EpisodeEditRevisionPreview>(
      `/episodes/${episodeId}/continuity/edit-revisions/preview`,
      body,
    ),
  createEditRevision: (
    episodeId: number,
    body: { audio_policies?: Record<string, string> } = {},
  ) =>
    api.post<EpisodeEditRevision>(
      `/episodes/${episodeId}/continuity/edit-revisions`,
      body,
    ),
  approveEditRevision: (episodeId: number, revisionId: number) =>
    api.post<EpisodeEditRevision>(
      `/episodes/${episodeId}/continuity/edit-revisions/${revisionId}/approve`,
    ),
  renderEditRevision: (episodeId: number, revisionId: number) =>
    api.post<{ revision_id: number; merge_id: number; status: string }>(
      `/episodes/${episodeId}/continuity/edit-revisions/${revisionId}/render`,
    ),
};

export const storyboardAPI = {
  create: (data: Record<string, unknown>) => api.post("/storyboards", data),
  update: (id: number, data: Record<string, unknown>) =>
    api.put(`/storyboards/${id}`, data),
  generateTTS: (id: number) => api.post(`/storyboards/${id}/generate-tts`),
  del: (id: number) => api.del(`/storyboards/${id}`),
  getSet: (id: number, options?: ApiRequestOptions) =>
    api.get<StoryboardDraftPreview>(`/storyboard-sets/${id}`, options),
  publishSet: (id: number, data: { confirm_replace: boolean }) =>
    api.post<StoryboardDraftPublishResult>(
      `/storyboard-sets/${id}/publish`,
      data,
    ),
};

export const characterAPI = {
  list: (options?: ApiRequestOptions) =>
    api.get<{ items: Character[]; total?: number }>("/characters", options),
  update: (id: number, data: Record<string, unknown>) =>
    api.put(`/characters/${id}`, data),
  del: (id: number) => api.del(`/characters/${id}`),
  voiceSample: (id: number, episodeId: number) =>
    api.post<{ voice_sample_url: string }>(
      `/characters/${id}/generate-voice-sample`,
      { episode_id: episodeId },
    ),
  generateImage: (id: number, episodeId: number) =>
    api.post("/images", { character_id: id, episode_id: episodeId }),
  batchImages: (ids: number[], episodeId: number) =>
    api.post("/characters/batch-generate-images", {
      character_ids: ids,
      episode_id: episodeId,
    }),
};

export const sceneAPI = {
  list: (options?: ApiRequestOptions) =>
    api.get<{ items: Scene[]; total?: number }>("/scenes", options),
  create: (data: Record<string, unknown>) => api.post("/scenes", data),
  update: (id: number, data: Record<string, unknown>) =>
    api.put(`/scenes/${id}`, data),
  del: (id: number) => api.del(`/scenes/${id}`),
  generateImage: (id: number, episodeId: number) =>
    api.post("/images", { scene_id: id, episode_id: episodeId }),
};

export const imageAPI = {
  generate: (d: Record<string, unknown>) =>
    api.post<ImageGeneration>("/images", d),
  get: (id: number) => api.get<ImageGeneration>(`/images/${id}`),
  list: (
    params?: { drama_id?: number; storyboard_id?: number },
    options?: ApiRequestOptions,
  ) => {
    const query = new URLSearchParams();
    if (params?.drama_id) query.set("drama_id", String(params.drama_id));
    if (params?.storyboard_id)
      query.set("storyboard_id", String(params.storyboard_id));
    return api.get<ImageGeneration[]>(
      `/images${query.size ? `?${query.toString()}` : ""}`,
      options,
    );
  },
};

export const uploadAPI = {
  image: async (file: File) => {
    const form = new FormData();
    form.set("file", file);
    const response = await fetch(`${BASE}/upload/image`, {
      method: "POST",
      body: form,
    });
    const text = await response.text();
    const json = parseApiJsonBody(text, "/upload/image", response.status) as {
      code?: number;
      message?: string;
      data?: { url: string; storage_key?: string };
    };
    if (!response.ok || (json.code && json.code >= 400)) {
      throw new Error(json.message || `上传失败（HTTP ${response.status}）`);
    }
    if (!json.data) throw new Error("上传失败");
    return json.data;
  },
};

export const gridAPI = {
  prompt: (d: Record<string, unknown>) => api.post("/grid/prompt", d),
  generate: (d: Record<string, unknown>) => api.post("/grid/generate", d),
  status: (id: number) => api.get(`/grid/status/${id}`),
  split: (d: Record<string, unknown>) => api.post("/grid/split", d),
};

export const videoAPI = {
  generate: (d: Record<string, unknown>) => api.post("/videos", d),
  list: (params?: { drama_id?: number; storyboard_id?: number }) => {
    const query = new URLSearchParams();
    if (params?.drama_id) query.set("drama_id", String(params.drama_id));
    if (params?.storyboard_id)
      query.set("storyboard_id", String(params.storyboard_id));
    return api.get<VideoGeneration[]>(
      `/videos${query.size ? `?${query.toString()}` : ""}`,
    );
  },
  get: (id: number) => api.get<VideoGeneration>(`/videos/${id}`),
};

export const quickVideoAPI = {
  generate: (d: Record<string, unknown>) =>
    api.post<{
      video_generation_id: number;
      task_id: number | null;
      record: VideoGeneration;
    }>("/quick-videos", d),
};

export const audioAPI = {
  generate: (d: {
    text: string;
    config_id?: number;
    voice_id?: string;
    speed?: number;
    emotion?: string;
    preview?: boolean;
  }) =>
    api.post<{ audio_url: string | null; asset_id: number | null }>(
      "/audio/generate",
      d,
    ),
};

export const taskAPI = {
  list: (
    params?: {
      page?: number;
      page_size?: number;
      q?: string;
      status?: string;
      type?: string;
      source_type?: string;
      sort?: "created_at" | "updated_at";
      order?: "asc" | "desc";
      drama_id?: number;
      episode_id?: number;
    },
    options?: ApiRequestOptions,
  ) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.page_size) query.set("page_size", String(params.page_size));
    if (params?.q) query.set("q", params.q);
    if (params?.status) query.set("status", params.status);
    if (params?.type) query.set("type", params.type);
    if (params?.source_type) query.set("source_type", params.source_type);
    if (params?.sort) query.set("sort", params.sort);
    if (params?.order) query.set("order", params.order);
    if (params?.drama_id) query.set("drama_id", String(params.drama_id));
    if (params?.episode_id) query.set("episode_id", String(params.episode_id));
    return api.get<TaskListPayload>(
      `/tasks${query.size ? `?${query.toString()}` : ""}`,
      options,
    );
  },
  get: (id: number) => api.get<TaskRecord>(`/tasks/${id}`),
  retry: (id: number) =>
    api.post<{
      task_id: number | null;
      video_generation_id?: number;
      image_generation_id?: number;
      storyboard_id?: number;
      merge_id?: number;
      tts_audio_url?: string;
      composed_video_url?: string;
    }>(`/tasks/${id}/retry`),
  cancel: (id: number) =>
    api.post<{ canceled: boolean }>(`/tasks/${id}/cancel`),
  del: (id: number) => api.del(`/tasks/${id}`),
  logs: (id: number) =>
    api.get<
      Array<{
        id: number;
        task_id: number;
        level: string;
        message: string;
        metadata: Record<string, unknown> | null;
        created_at: string;
      }>
    >(`/tasks/${id}/logs`),
};

export const assetAPI = {
  list: (
    params?: {
      kind?: string;
      q?: string;
      source_type?: string;
      drama_id?: number;
    },
    options?: ApiRequestOptions,
  ) => {
    const query = new URLSearchParams();
    if (params?.kind) query.set("kind", params.kind);
    if (params?.q) query.set("q", params.q);
    if (params?.source_type) query.set("source_type", params.source_type);
    if (params?.drama_id) query.set("drama_id", String(params.drama_id));
    return api.get<{ items: AssetRecord[]; total: number }>(
      `/assets${query.size ? `?${query.toString()}` : ""}`,
      options,
    );
  },
  get: (id: number) => api.get<AssetRecord>(`/assets/${id}`),
  fromTask: (taskId: number) =>
    api.post<AssetRecord>("/assets/from-task", { task_id: taskId }),
};

export const composeAPI = {
  shot: (id: number) => api.post(`/compose/storyboards/${id}/compose`),
  all: (epId: number) => api.post(`/compose/episodes/${epId}/compose-all`),
  status: (epId: number) =>
    api.get<EpisodeComposeStatusResponse>(
      `/compose/episodes/${epId}/compose-status`,
    ),
};

export const mergeAPI = {
  merge: (epId: number) => api.post(`/merge/episodes/${epId}/merge`),
  status: (epId: number) =>
    api.get<EpisodeMergeStatusResponse | null>(`/merge/episodes/${epId}/merge`),
};

export const aiConfigAPI = {
  list: (t?: string) =>
    api.get<AIServiceConfig[]>(`/ai-configs${t ? `?service_type=${t}` : ""}`),
  create: (d: Record<string, unknown>) => api.post("/ai-configs", d),
  update: (id: number, d: Record<string, unknown>) =>
    api.put(`/ai-configs/${id}`, d),
  del: (id: number) => api.del(`/ai-configs/${id}`),
  test: (d: Record<string, unknown>) => api.post("/ai-configs/test", d),
  xiaochuangPreset: (apiKey: string) =>
    api.post("/ai-configs/xiaochuang-preset", { api_key: apiKey }),
};

export const agentConfigAPI = {
  list: () => api.get("/agent-configs"),
  get: (id: number) => api.get(`/agent-configs/${id}`),
  create: (d: Record<string, unknown>) => api.post("/agent-configs", d),
  update: (id: number, d: Record<string, unknown>) =>
    api.put(`/agent-configs/${id}`, d),
  del: (id: number) => api.del(`/agent-configs/${id}`),
};

export const skillsAPI = {
  list: () => api.get("/skills"),
  get: async (id: string) => {
    const data = await api.get<string | { content?: string }>(`/skills/${id}`);
    return typeof data === "string" ? data : String(data?.content || "");
  },
  create: (data: { id: string; name: string; description?: string }) =>
    api.post("/skills", data),
  update: (id: string, content: string) =>
    api.put(`/skills/${id}`, { content }),
  del: (id: string) => api.del(`/skills/${id}`),
};

export const voicesAPI = {
  list: (provider?: string, configId?: number | null) => {
    const query = new URLSearchParams();
    if (provider) query.set("provider", provider);
    if (configId != null) query.set("config_id", String(configId));
    const suffix = query.size ? `?${query.toString()}` : "";
    return api.get<AIVoice[]>(`/ai-voices${suffix}`);
  },
  sync: () => api.post("/ai-voices/sync", {}),
};

export const writingAPI = {
  list: (params?: {
    page?: number;
    page_size?: number;
    kind?: string;
    status?: string;
    q?: string;
    sort?: string;
  }) => {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.page_size) query.set("page_size", String(params.page_size));
    if (params?.kind) query.set("kind", params.kind);
    if (params?.status) query.set("status", params.status);
    if (params?.q) query.set("q", params.q);
    if (params?.sort) query.set("sort", params.sort);
    return api.get<WritingListPayload>(
      `/writings${query.size ? `?${query.toString()}` : ""}`,
    );
  },
  get: (id: number) => api.get<WritingDetail>(`/writings/${id}`),
  getDocument: (writingId: number, documentId: number) =>
    api.get<WritingDocumentPayload>(
      `/writings/${writingId}/documents/${documentId}`,
    ),
  create: (body: {
    title: string;
    kind: string;
    synopsis?: string | null;
    cover_url?: string | null;
    brief_json?: string | null;
  }) =>
    api.post<{ writing_id: number; document_id: number }>("/writings", body),
  patch: (id: number, body: Record<string, unknown>) =>
    api.patch<{ updated: boolean }>(`/writings/${id}`, body),
  addDocument: (
    writingId: number,
    body: { title: string; parent_id?: number | null; document_type: string },
  ) =>
    api.post<{ document_id: number }>(`/writings/${writingId}/documents`, body),
  patchDocument: (
    writingId: number,
    documentId: number,
    body: Record<string, unknown>,
  ) =>
    api.patch<{ updated: boolean }>(
      `/writings/${writingId}/documents/${documentId}`,
      body,
    ),
  aiAction: (
    writingId: number,
    body: { document_id: number; action: string; instructions?: string },
  ) =>
    api.post<{ action: string; result_text: string; document_id: number }>(
      `/writings/${writingId}/ai-actions`,
      body,
    ),
  exportMarkdown: async (writingId: number) => {
    const response = await fetch(
      `/api/v1/writings/${writingId}/export?format=md`,
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || "导出失败");
    }
    const blob = await response.blob();
    const content = await blob.text();
    if (looksLikeStructuredApiEnvelope(content)) {
      try {
        const payload = JSON.parse(content) as { message?: string };
        throw new Error(
          payload.message || "导出返回了结构化结果，而不是 Markdown 正文",
        );
      } catch (error) {
        throw error instanceof Error
          ? error
          : new Error("导出返回了结构化结果，而不是 Markdown 正文");
      }
    }
    if (looksLikeHtmlDocument(content)) {
      throw new Error(
        "导出返回了网页内容，而不是 Markdown 正文，请确认小说服务状态后重试",
      );
    }
    const disposition = response.headers.get("Content-Disposition") || "";
    const matched = disposition.match(/filename\*=UTF-8''([^;]+)/);
    return {
      blob: new Blob([content], { type: "text/markdown;charset=utf-8" }),
      filename: matched
        ? decodeURIComponent(matched[1])
        : `writing-${writingId}.md`,
    };
  },
  importToDrama: (
    writingId: number,
    body?: { document_id?: number | null; title?: string },
  ) =>
    api.post<{
      drama_id: number;
      episode_id: number;
      source_writing_id: number;
      source_document_id: number | null;
    }>("/dramas/from-writing", {
      writing_id: writingId,
      document_id: body?.document_id ?? null,
      title: body?.title,
    }),
  listProposals: (writingId: number) =>
    api.get(`/writings/${writingId}/proposals`),
  getProposalImpact: (writingId: number, proposalId: number) =>
    api.get(`/writings/${writingId}/proposal-impact?proposal_id=${proposalId}`),
  applyProposal: (writingId: number, proposalId: number) =>
    api.post(`/writings/${writingId}/proposals/${proposalId}/apply`),
  rejectProposal: (writingId: number, proposalId: number) =>
    api.post(`/writings/${writingId}/proposals/${proposalId}/reject`),
  batchPlanProposals: (writingId: number, body: { proposal_ids: number[] }) =>
    api.post(`/writings/${writingId}/proposals/batch-plan`, body),
  batchApplyProposals: (
    writingId: number,
    body: {
      proposal_ids: number[];
      allow_conflicts?: boolean;
      stop_on_error?: boolean;
    },
  ) => api.post(`/writings/${writingId}/proposals/batch-apply`, body),
  listBatchExecutions: async (writingId: number) => {
    const data = await api.get<
      BatchExecutionItem[] | { items?: BatchExecutionItem[] }
    >(`/writings/${writingId}/batch-executions`);
    return Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : [];
  },
  getBatchExecutionDetail: (writingId: number, executionId: number) =>
    api.get(
      `/writings/${writingId}/batch-executions/detail?execution_id=${executionId}`,
    ),
  getBatchRollbackPreview: (writingId: number, executionId: number) =>
    api.get(
      `/writings/${writingId}/batch-executions/rollback-preview?execution_id=${executionId}`,
    ),
  rollbackBatchExecution: (writingId: number, executionId: number) =>
    api.post(`/writings/${writingId}/batch-executions/rollback`, {
      execution_id: executionId,
    }),
  listKnowledgeCards: (writingId: number) =>
    api.get(`/writings/${writingId}/knowledge-cards`),
  listReferenceNetwork: (
    writingId: number,
    params?: { proposal_id?: number; document_id?: number },
  ) => {
    const query = new URLSearchParams();
    if (params?.proposal_id)
      query.set("proposal_id", String(params.proposal_id));
    if (params?.document_id)
      query.set("document_id", String(params.document_id));
    return api.get(
      `/writings/${writingId}/reference-network${query.size ? `?${query.toString()}` : ""}`,
    );
  },
  listObjectHistories: (
    writingId: number,
    params: { object_kind: string; document_id?: number | null },
  ) => {
    const query = new URLSearchParams();
    query.set("object_kind", params.object_kind);
    if (params.document_id)
      query.set("document_id", String(params.document_id));
    return api.get(
      `/writings/${writingId}/object-histories?${query.toString()}`,
    );
  },
  previewObjectHistory: (writingId: number, historyId: number) =>
    api.get(
      `/writings/${writingId}/object-histories/preview?history_id=${historyId}`,
    ),
  restoreObjectHistory: (writingId: number, historyId: number) =>
    api.post(`/writings/${writingId}/object-histories/restore`, {
      history_id: historyId,
    }),
  listKnowledgeCardHistories: (writingId: number, cardId: number) =>
    api.get(`/writings/${writingId}/knowledge-cards/history?card_id=${cardId}`),
  restoreKnowledgeCardHistory: (writingId: number, historyId: number) =>
    api.post(`/writings/${writingId}/knowledge-cards/history/restore`, {
      history_id: historyId,
    }),
};

export const aiRuntimeAPI = {
  listRuns: (targetType: string, targetId: number) =>
    api.get<
      Array<{
        id: number;
        user_message?: string | null;
        assistant_message?: string | null;
        actions?: unknown;
        created_at: string;
      }>
    >(
      `/ai/runs?target_type=${encodeURIComponent(targetType)}&target_id=${targetId}`,
    ),
  run: async (payload: {
    skill_id: string;
    mode?: string;
    scene?: string;
    target: { type: string; writing_id?: number; document_id?: number };
    input: { message: string; selection?: string | null };
    options?: { stream?: boolean };
  }) => {
    const response = await fetch("/api/v1/ai/runs?stream=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok || !response.body) throw new Error("AI 请求失败");
    return response;
  },
  applyAction: (runId: number, actionIndex: number) =>
    api.post<{
      type: string;
      structured?: Record<string, unknown> | null;
      writing_id?: number;
      document_id?: number;
    }>(`/ai/result-actions/${runId}/apply`, { action_index: actionIndex }),
};
