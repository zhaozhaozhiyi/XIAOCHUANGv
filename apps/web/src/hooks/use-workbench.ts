import { create } from "zustand";
import { toast } from "sonner";
import {
  dramaAPI,
  episodeAPI,
  storyboardAPI,
  characterAPI,
  sceneAPI,
  imageAPI,
  videoAPI,
  composeAPI,
  mergeAPI,
  voicesAPI,
  aiConfigAPI,
  taskAPI,
  type StoryboardDraftPreview,
} from "@/lib/api";
import {
  getEffectiveEpisodeConfigId,
  getProjectDefaults,
} from "@/lib/drama-metadata";
import { getStoryboardTtsDialogue } from "@/lib/dialogue";
import { fetchSSE } from "@/lib/sse";
import { getAiErrorCopy, getAiErrorDescription } from "@/lib/ai-error-copy";
import type {
  Drama,
  Episode,
  Character,
  Scene,
  Storyboard,
  AIVoice,
  AIServiceConfig,
  EpisodeComposeStatusResponse,
  EpisodeMergeStatusResponse,
  TaskRecord,
} from "@/types/api";

// ============ Pipeline Steps ============
export const PIPELINE_STEPS = [
  { key: "script-raw", section: "script", label: "原始内容", done: false },
  { key: "script-rewrite", section: "script", label: "AI 改写", done: false },
  {
    key: "script-extract",
    section: "script",
    label: "提取角色场景",
    done: false,
  },
  { key: "script-voice", section: "script", label: "分配音色", done: false },
  {
    key: "script-storyboard",
    section: "script",
    label: "分镜列表",
    done: false,
  },
  { key: "prod-chars", section: "production", label: "角色形象", done: false },
  { key: "prod-scenes", section: "production", label: "场景图", done: false },
  { key: "prod-dubbing", section: "production", label: "配音", done: false },
  { key: "prod-shots", section: "production", label: "镜头图", done: false },
  {
    key: "prod-continuity",
    section: "production",
    label: "连续性",
    done: false,
  },
  { key: "prod-videos", section: "production", label: "视频", done: false },
  { key: "prod-compose", section: "production", label: "合成", done: false },
];

export const SIDEBAR_SECTIONS = [
  {
    id: "script",
    label: "剧本",
    items: [
      { key: "script-raw", label: "原始内容", section: "script" },
      { key: "script-rewrite", label: "AI 改写", section: "script" },
      { key: "script-extract", label: "提取角色场景", section: "script" },
      { key: "script-voice", label: "分配音色", section: "script" },
      { key: "script-storyboard", label: "分镜列表", section: "script" },
    ],
  },
  {
    id: "production",
    label: "制作",
    items: [
      { key: "prod-chars", label: "角色形象", section: "production" },
      { key: "prod-scenes", label: "场景图", section: "production" },
      { key: "prod-dubbing", label: "配音", section: "production" },
      { key: "prod-shots", label: "镜头图", section: "production" },
      { key: "prod-videos", label: "视频", section: "production" },
      { key: "prod-compose", label: "合成", section: "production" },
    ],
  },
  {
    id: "export",
    label: "导出",
    items: [{ key: "export-merge", label: "合并成片", section: "export" }],
  },
];

const SCRIPT_STEP_MAP: Record<string, number> = {
  "script-raw": 0,
  "script-rewrite": 1,
  "script-extract": 2,
  "script-voice": 3,
  "script-storyboard": 4,
};

function createAbortError() {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Aborted", "AbortError");
  }
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown) {
  return (
    !!error &&
    typeof error === "object" &&
    "name" in error &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError());
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
const SAVE_STORYBOARDS_TOOL_NAMES = new Set([
  "save_storyboards",
  "saveStoryboards",
  "backend_json_storyboard_save",
]);
const STORYBOARD_POLL_INTERVAL_MS = 3000;
const EPISODE_TASK_POLL_INTERVAL_MS = 4000;
const ACTIVE_TASK_STATUSES = new Set(["queued", "running"]);
const RESTORABLE_TASK_STATUSES = "queued,running,failed,canceled";
let recoveredEntityPollSerial = 0;

function formatWorkbenchError(error: unknown) {
  return getAiErrorCopy(error, "操作失败");
}

function toastWorkbenchError(
  title: string,
  error: unknown,
  details?: Array<string | null | undefined>,
) {
  const description = details
    ?.map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" · ");
  toast.error(`${title}失败`, {
    description: [
      formatWorkbenchError(error),
      description,
      getAiErrorDescription(error),
    ]
      .filter(Boolean)
      .join(" · "),
  });
}

function hasSaveStoryboardsTool(called: string[]) {
  return called.some((name) =>
    SAVE_STORYBOARDS_TOOL_NAMES.has(String(name || "").trim()),
  );
}

function isStoryboardBreakdownTask(task: TaskRecord | null | undefined) {
  return (
    !!task &&
    (task.type === "storyboard_breakdown" ||
      task.domain_table === "storyboard_breakdowns")
  );
}

function resolveWorkbenchAiTaskType(task: TaskRecord) {
  if (isStoryboardBreakdownTask(task)) return "storyboard_breaker";
  const skillId = task.payload?.skill_id;
  return typeof skillId === "string" && skillId.trim()
    ? skillId.trim()
    : "drama_ai_skill";
}

function formatRecoveredAiTaskNote(task: TaskRecord) {
  if (isStoryboardBreakdownTask(task)) {
    const summary = (task.result_summary || {}) as Record<string, unknown>;
    const phase = String(summary.phase || "");
    const count = Number(summary.storyboard_count || 0);
    if (phase === "agent_runtime_queued") return "本集分镜已排队";
    if (phase === "storyboard_batch_submitted" && count > 0)
      return `正在拆解本集分镜 · 已提交 ${count} 镜头`;
    if (phase === "storyboard_review_required")
      return "分镜草稿已生成，等待确认替换";
    if (phase === "storyboard_ready") return "分镜已生成";
    return "正在拆解本集分镜";
  }
  const statusText = task.status === "queued" ? "排队中" : "处理中";
  return `${task.title || "短剧 AI 任务"}${statusText ? ` · ${statusText}` : ""}`;
}

export function isActiveWorkbenchTask(task: TaskRecord | null | undefined) {
  return !!task && ACTIVE_TASK_STATUSES.has(String(task.status || ""));
}

function taskPayloadNumber(task: TaskRecord, key: string) {
  const value = task.payload?.[key];
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: unknown) {
  if (!value) return 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function shouldShowEntityTask(
  task: TaskRecord,
  entityUpdatedAt: unknown,
  hasCurrentResult: boolean,
) {
  if (isActiveWorkbenchTask(task)) return true;
  if (!["failed", "canceled"].includes(String(task.status || ""))) return false;
  if (!hasCurrentResult) return true;
  return dateValue(task.updated_at) >= dateValue(entityUpdatedAt);
}

function chooseEntityTask(current: TaskRecord | undefined, next: TaskRecord) {
  if (!current) return next;
  const currentActive = isActiveWorkbenchTask(current);
  const nextActive = isActiveWorkbenchTask(next);
  if (currentActive !== nextActive) return nextActive ? next : current;
  return dateValue(next.updated_at) >= dateValue(current.updated_at)
    ? next
    : current;
}

function addEntityTask(
  target: Record<string, TaskRecord>,
  key: string | null,
  task: TaskRecord,
) {
  if (!key) return;
  target[key] = chooseEntityTask(target[key], task);
}

function buildWorkbenchEntityTasks(args: {
  tasks: TaskRecord[];
  characters: Character[];
  scenes: Scene[];
  storyboards: Storyboard[];
  episode: Episode;
}) {
  const entityTasks: Record<string, TaskRecord> = {};
  const charactersById = new Map(
    args.characters.map((item) => [item.id, item]),
  );
  const scenesById = new Map(args.scenes.map((item) => [item.id, item]));
  const storyboardsById = new Map(
    args.storyboards.map((item) => [item.id, item]),
  );

  for (const task of args.tasks) {
    const status = String(task.status || "");
    if (!["queued", "running", "failed", "canceled"].includes(status)) continue;

    if (task.domain_table === "image_generations") {
      const characterId = taskPayloadNumber(task, "character_id");
      if (characterId != null) {
        const character = charactersById.get(characterId);
        if (
          character &&
          shouldShowEntityTask(
            task,
            character.updated_at,
            !!character.image_url,
          )
        ) {
          addEntityTask(entityTasks, `character-image:${characterId}`, task);
        }
        continue;
      }

      const sceneId = taskPayloadNumber(task, "scene_id");
      if (sceneId != null) {
        const scene = scenesById.get(sceneId);
        if (
          scene &&
          shouldShowEntityTask(task, scene.updated_at, !!scene.image_url)
        ) {
          addEntityTask(entityTasks, `scene-image:${sceneId}`, task);
        }
        continue;
      }

      const storyboardId =
        task.storyboard_id ?? taskPayloadNumber(task, "storyboard_id");
      const frameType = String(task.payload?.frame_type || "").trim();
      if (
        storyboardId != null &&
        (frameType === "first_frame" || frameType === "last_frame")
      ) {
        const storyboard = storyboardsById.get(storyboardId);
        const hasFrame =
          frameType === "last_frame"
            ? !!(storyboard?.last_frame_image || storyboard?.composed_image)
            : !!(storyboard?.first_frame_image || storyboard?.composed_image);
        if (
          storyboard &&
          shouldShowEntityTask(task, storyboard.updated_at, hasFrame)
        ) {
          addEntityTask(
            entityTasks,
            `shot-frame:${storyboardId}:${frameType}`,
            task,
          );
        }
      }
      continue;
    }

    if (task.domain_table === "video_generations") {
      const storyboardId =
        task.storyboard_id ?? taskPayloadNumber(task, "storyboard_id");
      if (storyboardId == null) continue;
      const storyboard = storyboardsById.get(storyboardId);
      const hasCurrentVideo =
        !!storyboard?.video_url &&
        storyboard.status !== "video_failed" &&
        storyboard.status !== "video_canceled";
      if (
        storyboard &&
        shouldShowEntityTask(task, storyboard.updated_at, hasCurrentVideo)
      ) {
        addEntityTask(entityTasks, `shot-video:${storyboardId}`, task);
      }
      continue;
    }

    if (task.domain_table === "storyboard_tts") {
      const storyboardId = task.storyboard_id ?? task.domain_id;
      const storyboard = storyboardsById.get(storyboardId);
      if (
        storyboard &&
        shouldShowEntityTask(
          task,
          storyboard.updated_at,
          !!storyboard.tts_audio_url,
        )
      ) {
        addEntityTask(entityTasks, `shot-tts:${storyboardId}`, task);
      }
      continue;
    }

    if (task.domain_table === "storyboard_compose") {
      const storyboardId = task.storyboard_id ?? task.domain_id;
      const storyboard = storyboardsById.get(storyboardId);
      const hasCurrentCompose =
        !!storyboard?.composed_video_url &&
        storyboard.status !== "compose_failed" &&
        storyboard.status !== "compose_canceled";
      if (
        storyboard &&
        shouldShowEntityTask(task, storyboard.updated_at, hasCurrentCompose)
      ) {
        addEntityTask(entityTasks, `shot-compose:${storyboardId}`, task);
      }
      continue;
    }

    if (
      task.domain_table === "video_merges" &&
      task.episode_id === args.episode.id
    ) {
      addEntityTask(entityTasks, `episode-merge:${args.episode.id}`, task);
    }
  }

  return entityTasks;
}

function activeEntityTaskIds(entityTasks: Record<string, TaskRecord>) {
  return Array.from(
    new Set(
      Object.values(entityTasks)
        .filter(isActiveWorkbenchTask)
        .map((task) => task.id),
    ),
  );
}

function pendingShotFramesFromTasks(entityTasks: Record<string, TaskRecord>) {
  const pending = new Map<number, string>();
  for (const [key, task] of Object.entries(entityTasks)) {
    if (!isActiveWorkbenchTask(task) || !key.startsWith("shot-frame:"))
      continue;
    const [, id, frameType] = key.split(":");
    const storyboardId = Number(id);
    if (Number.isFinite(storyboardId) && frameType)
      pending.set(storyboardId, frameType);
  }
  return pending;
}

function pendingIdsFromTasks(
  entityTasks: Record<string, TaskRecord>,
  prefix: string,
) {
  const pending = new Set<number>();
  for (const [key, task] of Object.entries(entityTasks)) {
    if (!isActiveWorkbenchTask(task) || !key.startsWith(prefix)) continue;
    const id = Number(key.slice(prefix.length));
    if (Number.isFinite(id)) pending.add(id);
  }
  return pending;
}

export function isNarratorCharacter(
  char: Pick<Character, "name" | "role"> | null | undefined,
) {
  const text = `${char?.name || ""} ${char?.role || ""}`.toLowerCase();
  return (
    text.includes("旁白") ||
    text.includes("narrator") ||
    text.includes("画外音")
  );
}

export function isVisualCharacter(
  char: Pick<Character, "name" | "role"> | null | undefined,
) {
  return !isNarratorCharacter(char);
}

export function hasCompleteShotFrames(
  storyboard: Pick<
    Storyboard,
    "first_frame_image" | "last_frame_image" | "composed_image"
  >,
) {
  return (
    !!storyboard.composed_image ||
    (!!storyboard.first_frame_image && !!storyboard.last_frame_image)
  );
}

function getStoryboardCharacterIds(sb: Storyboard): number[] {
  const explicitIds = (sb as Storyboard & { character_ids?: number[] })
    .character_ids;
  if (Array.isArray(explicitIds)) return explicitIds;
  return (sb.characters || []).map((character) => character.id).filter(Boolean);
}

function getStoryboardReferenceImages(sb: Storyboard): string[] {
  const raw = sb.reference_images;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function buildShotReferenceImages(
  sb: Storyboard,
  scenes: Scene[],
  characters: Character[],
): string[] {
  const refs: string[] = [];
  const pushRef = (value: string | null | undefined) => {
    const ref = String(value || "").trim();
    if (!ref || refs.includes(ref) || refs.length >= 6) return;
    refs.push(ref);
  };

  const scene = scenes.find((item) => item.id === sb.scene_id);
  pushRef(scene?.image_url);

  for (const charId of getStoryboardCharacterIds(sb)) {
    const character = characters.find((item) => item.id === charId);
    pushRef(character?.image_url);
  }

  for (const ref of getStoryboardReferenceImages(sb)) pushRef(ref);
  return refs;
}

function buildShotImagePrompt(
  sb: Storyboard,
  frameType: string,
  scenes: Scene[],
): string {
  const scene = scenes.find((item) => item.id === sb.scene_id);
  const title = sb.title || "";
  const description = sb.image_prompt || sb.description || "";
  const shotType = sb.shot_type || "";
  const angle = sb.angle || "";
  const movement = sb.movement || "";
  const location = sb.location || scene?.location || "";
  const time = sb.time || scene?.time || "";
  const charactersText = (sb.characters || [])
    .map((character) => character.name)
    .filter(Boolean)
    .join("、");
  const action = sb.action || "";
  const atmosphere = sb.atmosphere || "";
  const frameHint =
    frameType === "first_frame"
      ? "生成这个镜头的起始关键帧，突出建立关系和动作开始瞬间"
      : "生成这个镜头的结束关键帧，必须表现动作完成后的不同画面，人物姿态、位置或情绪落点要和起始关键帧明显不同";

  return [
    title ? `镜头标题：${title}` : "",
    description ? `画面描述：${description}` : "",
    shotType ? `景别：${shotType}` : "",
    angle ? `机位：${angle}` : "",
    movement ? `运镜：${movement}` : "",
    charactersText ? `角色：${charactersText}` : "",
    location ? `地点：${location}` : "",
    time ? `时间：${time}` : "",
    action ? `动作：${action}` : "",
    atmosphere ? `氛围：${atmosphere}` : "",
    frameHint,
    "画面中不要出现文字、字幕、对话气泡、水印",
  ]
    .filter(Boolean)
    .join("；");
}

function buildNoDialogueShotVideoPrompt(sb: Storyboard): string {
  return [
    sb.video_prompt || sb.description || sb.action || "",
    "不要生成任何音频、人声、对白、旁白、歌声、角色说话声或口型配音",
    "画面中不要出现字幕、文字、对话气泡、水印",
    "如果人物需要说话，只表现表情、姿态和镜头动作",
  ]
    .filter(Boolean)
    .join("；");
}

function getConfigModel(config: AIServiceConfig) {
  const rawValue = config.model as unknown;
  if (Array.isArray(rawValue)) return String(rawValue[0] || "").trim();

  const raw = String(rawValue || "").trim();
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) return String(parsed[0] || "").trim();
  } catch {
    return raw;
  }
  return raw;
}

function formatConfig(config: AIServiceConfig, serviceLabel: string) {
  const model = getConfigModel(config);
  const name = config.name || `${serviceLabel}配置`;
  const provider = config.provider ? ` · ${config.provider}` : "";
  return model ? `${name} · ${model}${provider}` : `${name}${provider}`;
}

function findRuntimeDefaultConfig(
  configs: AIServiceConfig[],
  serviceType: string,
) {
  return configs
    .filter(
      (item) =>
        item.service_type === serviceType && Number(item.is_active) === 1,
    )
    .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0];
}

function formatConfigLabel(
  configId: number | null | undefined,
  configs: AIServiceConfig[],
  serviceType: "image" | "video" | "audio",
  serviceLabel: string,
  sourceLabel?: string,
) {
  if (!configId) {
    const defaultConfig = findRuntimeDefaultConfig(configs, serviceType);
    return defaultConfig
      ? `默认：${formatConfig(defaultConfig, serviceLabel)}`
      : "默认配置";
  }

  const config = configs.find((item) => item.id === configId);
  if (!config) return `配置 #${configId}`;

  return sourceLabel
    ? `${sourceLabel}：${formatConfig(config, serviceLabel)}`
    : formatConfig(config, serviceLabel);
}

// Workbench-side dispatcher for skill calls. The backend mirror of this
// map is apps/backend/src/modules/ai/ai.service.ts SKILL_HANDLERS; every
// skill that appears below must have a registered handler there.
//
// All five workbench skills now go through /api/v1/ai/runs (the unified
// skill runtime). The legacy /api/v1/agent/:type/chat path is gone — it
// used to handle grid_prompt_generator, but the grid handler now lives
// in apps/backend/src/modules/ai/skill-handlers/grid-prompt.handler.ts
// and the SSE payload shape ({ status / done.payload }) is identical.
const WORKBENCH_SKILLS = {
  extractor: { skill_id: "extractor", mode: "extract" },
  voice_assigner: { skill_id: "voice_assigner", mode: "assign" },
  storyboard_breaker: { skill_id: "storyboard_breaker", mode: "breakdown" },
  script_rewriter: { skill_id: "script_rewriter", mode: "rewrite" },
  grid_prompt_generator: {
    skill_id: "grid_prompt_generator",
    mode: "grid_prompt",
  },
} as const;

type WorkbenchSkillType = keyof typeof WORKBENCH_SKILLS;

export type WorkbenchRunIssue = {
  kind: "failed" | "canceled";
  message: string;
  detail?: string;
  occurredAt: number;
};

async function runAgentStream(params: {
  type: WorkbenchSkillType;
  message: string;
  dramaId: number;
  episodeId: number;
  // Extra input fields (used by grid_prompt_generator for storyboard_ids/rows/cols/mode)
  input?: Record<string, unknown>;
  scene?: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onStatus?: (text: string) => void;
}) {
  const skill = WORKBENCH_SKILLS[params.type];
  if (!skill) throw new Error(`Unknown workbench skill: ${params.type}`);
  const toolsCalled: string[] = [];
  const statuses: string[] = [];
  const startedAt = Date.now();

  await fetchSSE({
    url: "/api/v1/ai/runs?stream=1",
    method: "POST",
    signal: params.signal,
    body: {
      skill_id: skill.skill_id,
      mode: skill.mode,
      scene: params.scene ?? "workbench",
      target: {
        type: "episode",
        drama_id: params.dramaId,
        episode_id: params.episodeId,
      },
      input: {
        message: params.message,
        selection: null,
        ...(params.input || {}),
      },
      options: { stream: true },
    },
    onEvent: (evt) => {
      if (!evt.data) return;
      const payload = JSON.parse(evt.data) as {
        type?: string;
        text?: string;
        message?: string;
        tool?: string;
        tools_called?: string[];
      };
      if (payload.type === "delta" && payload.text)
        params.onDelta?.(payload.text);
      if (payload.type === "status" && payload.text) {
        statuses.push(payload.text);
        params.onStatus?.(payload.text);
      }
      if (payload.type === "tool_call" && payload.tool)
        toolsCalled.push(payload.tool);
      if (payload.type === "done" && Array.isArray(payload.tools_called)) {
        toolsCalled.splice(0, toolsCalled.length, ...payload.tools_called);
      }
      if (payload.type === "error") {
        throw new Error(
          `${payload.message || "Skill 执行失败"}（${skill.skill_id}/${skill.mode}）`,
        );
      }
    },
  });
  const durationMs = Date.now() - startedAt;
  console.info("[WorkbenchAI]", {
    skill_id: skill.skill_id,
    mode: skill.mode,
    drama_id: params.dramaId,
    episode_id: params.episodeId,
    duration_ms: durationMs,
    tools_called: toolsCalled,
    last_status: statuses[statuses.length - 1] || null,
  });
  return { toolsCalled, statuses, durationMs };
}

async function waitForStoryboards(episodeId: number, signal?: AbortSignal) {
  while (true) {
    if (signal?.aborted) throw createAbortError();
    const storyboards = await episodeAPI.storyboards(episodeId);
    if ((storyboards || []).length > 0) return storyboards || [];
    await sleep(STORYBOARD_POLL_INTERVAL_MS, signal);
  }
}

interface WorkbenchState {
  // Core data
  drama: Drama | null;
  episode: Episode | null;
  characters: Character[];
  scenes: Scene[];
  storyboards: Storyboard[];
  voices: AIVoice[];
  // Panel state
  panel: "script" | "production" | "export";
  scriptStep: number;
  prodTab: string;
  // Pending states
  pendingCharImages: Set<number>;
  pendingVoiceSamples: Set<number>;
  pendingSceneImages: Set<number>;
  pendingShotFrames: Map<number, string>;
  pendingShotTts: Set<number>;
  pendingVideos: Set<number>;
  pendingComposes: Set<number>;
  entityTasks: Record<string, TaskRecord>;
  // Merge status
  mergeStatus: unknown;
  mergeUrl: string | null;
  // Selected
  selectedStoryboard: Storyboard | null;
  // Local script edits
  localRaw: string;
  localScript: string;
  // Image viewer
  viewerOpen: boolean;
  viewerSrc: string;
  viewerTitle: string;
  // Config labels
  lockedImageConfigLabel: string;
  lockedVideoConfigLabel: string;
  lockedAudioConfigLabel: string;
  // Agent running
  running: boolean;
  runningType: string | null;
  runningNote: string;
  runningAbortController: AbortController | null;
  runningTaskId: number | null;
  storyboardBreakdownIssue: WorkbenchRunIssue | null;
  storyboardDraftReview: StoryboardDraftPreview | null;
  publishingStoryboardDraft: boolean;
  // Actions
  reset: () => void;
  loadAll: (dramaId: number, episodeNumber: number) => Promise<void>;
  goSubStep: (key: string) => void;
  setLocalRaw: (v: string) => void;
  setLocalScript: (v: string) => void;
  saveRaw: (options?: { silent?: boolean }) => Promise<void>;
  doRewrite: () => Promise<void>;
  skipRewrite: () => Promise<void>;
  doExtract: () => Promise<void>;
  doVoice: () => Promise<void>;
  batchVoiceSamples: () => Promise<void>;
  genVoiceSample: (id: number) => Promise<void>;
  doBreakdown: () => Promise<void>;
  cancelRunningAgent: () => void;
  confirmStoryboardDraftPublication: () => Promise<boolean>;
  updateCharVoice: (id: number, voice: string) => Promise<void>;
  genCharImg: (id: number) => Promise<void>;
  batchCharImages: () => Promise<void>;
  genSceneImg: (id: number) => Promise<void>;
  batchSceneImages: () => Promise<void>;
  genShotTTS: (sb: Storyboard) => Promise<void>;
  batchShotTTS: () => Promise<void>;
  genShotFrame: (sb: Storyboard, frameType: string) => Promise<void>;
  genShotVideo: (sb: Storyboard) => Promise<void>;
  batchShotVideos: () => Promise<void>;
  composeShot: (sb: Storyboard) => Promise<void>;
  batchCompose: () => Promise<void>;
  mergeEpisode: () => Promise<void>;
  pollMergeStatus: () => Promise<void>;
  retryEntityTask: (taskId: number) => Promise<void>;
  updateField: (sb: Storyboard, field: string, value: unknown) => Promise<void>;
  toggleStoryboardCharacter: (sb: Storyboard, charId: number) => Promise<void>;
  pendingDeleteStoryboard: Storyboard | null;
  requestDeleteShot: (sb: Storyboard) => void;
  confirmDeleteShot: () => Promise<void>;
  cancelDeleteShot: () => void;
  openImageViewer: (src: string, title?: string) => void;
  closeImageViewer: () => void;
  // Computed
  pipelineProgress: () => number;
  charsVoiced: () => number;
  totalDuration: () => number;
}

type WorkbenchSet = (
  partial:
    | Partial<WorkbenchState>
    | WorkbenchState
    | ((state: WorkbenchState) => Partial<WorkbenchState> | WorkbenchState),
  replace?: false,
) => void;

type EpisodePollResource =
  | "characters"
  | "scenes"
  | "storyboards"
  | "composeStatus"
  | "mergeStatus";

type EpisodePollSnapshot = {
  characters?: Character[];
  scenes?: Scene[];
  storyboards?: Storyboard[];
  composeStatus?: EpisodeComposeStatusResponse | null;
  mergeStatus?: EpisodeMergeStatusResponse | null;
};

type EpisodePollResult<T> =
  | { status: "completed"; value: T }
  | { status: "failed"; message?: string | null }
  | { status: "timeout" }
  | { status: "stale" };

type EpisodePollWaiter = {
  id: number;
  episodeId: number;
  resources: EpisodePollResource[];
  expiresAt: number;
  onSnapshot?: (snapshot: EpisodePollSnapshot, state: WorkbenchState) => void;
  resolveWhen: (
    snapshot: EpisodePollSnapshot,
    state: WorkbenchState,
  ) => EpisodePollResult<unknown> | null | undefined;
  resolve: (result: EpisodePollResult<unknown>) => void;
};

let episodePollWaiterSeq = 0;
let episodePollWaiters: EpisodePollWaiter[] = [];
let episodePollTimer: ReturnType<typeof setTimeout> | null = null;
let episodePollInFlight = false;

function resolveEpisodePollWaiter(
  waiter: EpisodePollWaiter,
  result: EpisodePollResult<unknown>,
) {
  waiter.resolve(result);
}

function cancelEpisodePollWaiters() {
  if (episodePollTimer) {
    clearTimeout(episodePollTimer);
    episodePollTimer = null;
  }
  const waiters = episodePollWaiters;
  episodePollWaiters = [];
  waiters.forEach((waiter) =>
    resolveEpisodePollWaiter(waiter, { status: "stale" }),
  );
}

function applyEpisodePollSnapshot(
  setState: WorkbenchSet,
  getState: () => WorkbenchState,
  episodeId: number,
  snapshot: EpisodePollSnapshot,
) {
  if (getState().episode?.id !== episodeId) return;

  const patch: Partial<WorkbenchState> = {};
  if (snapshot.characters) patch.characters = snapshot.characters;
  if (snapshot.scenes) patch.scenes = snapshot.scenes;
  if (snapshot.storyboards) {
    patch.storyboards = snapshot.storyboards;
    const selectedStoryboard = getState().selectedStoryboard;
    if (selectedStoryboard) {
      const updatedSelected = snapshot.storyboards.find(
        (item) => item.id === selectedStoryboard.id,
      );
      if (updatedSelected) patch.selectedStoryboard = updatedSelected;
    }
  }
  if (snapshot.mergeStatus !== undefined) {
    patch.mergeStatus = snapshot.mergeStatus;
    patch.mergeUrl =
      snapshot.mergeStatus?.merged_url || getState().episode?.video_url || null;
  }

  if (Object.keys(patch).length > 0) setState(patch);
}

async function fetchEpisodePollSnapshot(
  episodeId: number,
  resources: Set<EpisodePollResource>,
): Promise<EpisodePollSnapshot> {
  const snapshot: EpisodePollSnapshot = {};
  await Promise.all([
    resources.has("characters")
      ? episodeAPI
          .characters(episodeId)
          .then((items) => {
            snapshot.characters = items || [];
          })
          .catch((error: unknown) =>
            console.warn(
              "[Workbench] episode poller failed to refresh characters",
              error,
            ),
          )
      : Promise.resolve(),
    resources.has("scenes")
      ? episodeAPI
          .scenes(episodeId)
          .then((items) => {
            snapshot.scenes = items || [];
          })
          .catch((error: unknown) =>
            console.warn(
              "[Workbench] episode poller failed to refresh scenes",
              error,
            ),
          )
      : Promise.resolve(),
    resources.has("storyboards")
      ? episodeAPI
          .storyboards(episodeId)
          .then((items) => {
            snapshot.storyboards = items || [];
          })
          .catch((error: unknown) =>
            console.warn(
              "[Workbench] episode poller failed to refresh storyboards",
              error,
            ),
          )
      : Promise.resolve(),
    resources.has("composeStatus")
      ? composeAPI
          .status(episodeId)
          .then((status) => {
            snapshot.composeStatus = status || null;
          })
          .catch((error: unknown) =>
            console.warn(
              "[Workbench] episode poller failed to refresh compose status",
              error,
            ),
          )
      : Promise.resolve(),
    resources.has("mergeStatus")
      ? mergeAPI
          .status(episodeId)
          .then((status) => {
            snapshot.mergeStatus = status || null;
          })
          .catch((error: unknown) =>
            console.warn(
              "[Workbench] episode poller failed to refresh merge status",
              error,
            ),
          )
      : Promise.resolve(),
  ]);
  return snapshot;
}

function scheduleEpisodePoll(
  setState: WorkbenchSet,
  getState: () => WorkbenchState,
) {
  if (
    episodePollTimer ||
    episodePollInFlight ||
    episodePollWaiters.length === 0
  )
    return;
  episodePollTimer = setTimeout(() => {
    episodePollTimer = null;
    void runEpisodePoll(setState, getState);
  }, EPISODE_TASK_POLL_INTERVAL_MS);
}

async function runEpisodePoll(
  setState: WorkbenchSet,
  getState: () => WorkbenchState,
) {
  if (episodePollInFlight) return;
  episodePollInFlight = true;
  try {
    const currentEpisodeId = getState().episode?.id;
    const now = Date.now();
    const activeWaiters: EpisodePollWaiter[] = [];

    for (const waiter of episodePollWaiters) {
      if (!currentEpisodeId || waiter.episodeId !== currentEpisodeId) {
        resolveEpisodePollWaiter(waiter, { status: "stale" });
        continue;
      }
      if (now >= waiter.expiresAt) {
        resolveEpisodePollWaiter(waiter, { status: "timeout" });
        continue;
      }
      activeWaiters.push(waiter);
    }
    episodePollWaiters = activeWaiters;

    if (!currentEpisodeId || activeWaiters.length === 0) return;

    const resources = new Set<EpisodePollResource>();
    activeWaiters.forEach((waiter) =>
      waiter.resources.forEach((resource) => resources.add(resource)),
    );
    const snapshot = await fetchEpisodePollSnapshot(
      currentEpisodeId,
      resources,
    );

    if (getState().episode?.id !== currentEpisodeId) {
      const activeIds = new Set(activeWaiters.map((waiter) => waiter.id));
      episodePollWaiters = episodePollWaiters.filter((waiter) => {
        if (!activeIds.has(waiter.id)) return true;
        resolveEpisodePollWaiter(waiter, { status: "stale" });
        return false;
      });
      return;
    }

    applyEpisodePollSnapshot(setState, getState, currentEpisodeId, snapshot);

    const activeIds = new Set(activeWaiters.map((waiter) => waiter.id));
    const remaining: EpisodePollWaiter[] = [];
    for (const waiter of episodePollWaiters) {
      if (!activeIds.has(waiter.id)) {
        remaining.push(waiter);
        continue;
      }

      try {
        waiter.onSnapshot?.(snapshot, getState());
        const result = waiter.resolveWhen(snapshot, getState());
        if (result) {
          resolveEpisodePollWaiter(waiter, result);
        } else {
          remaining.push(waiter);
        }
      } catch (error) {
        resolveEpisodePollWaiter(waiter, {
          status: "failed",
          message: formatWorkbenchError(error),
        });
      }
    }
    episodePollWaiters = remaining;
  } finally {
    episodePollInFlight = false;
    scheduleEpisodePoll(setState, getState);
  }
}

function waitForEpisodePoll<T>(args: {
  episodeId: number;
  resources: EpisodePollResource[];
  timeoutMs: number;
  setState: WorkbenchSet;
  getState: () => WorkbenchState;
  onSnapshot?: (snapshot: EpisodePollSnapshot, state: WorkbenchState) => void;
  resolveWhen: (
    snapshot: EpisodePollSnapshot,
    state: WorkbenchState,
  ) => EpisodePollResult<T> | null | undefined;
}) {
  return new Promise<EpisodePollResult<T>>((resolve) => {
    episodePollWaiters.push({
      id: ++episodePollWaiterSeq,
      episodeId: args.episodeId,
      resources: args.resources,
      expiresAt: Date.now() + args.timeoutMs,
      onSnapshot: args.onSnapshot,
      resolveWhen: (snapshot, state) =>
        args.resolveWhen(snapshot, state) as
          | EpisodePollResult<unknown>
          | null
          | undefined,
      resolve: (result) => resolve(result as EpisodePollResult<T>),
    });
    scheduleEpisodePoll(args.setState, args.getState);
  });
}

const initialState = {
  drama: null,
  episode: null,
  characters: [],
  scenes: [],
  storyboards: [],
  voices: [],
  panel: "script" as const,
  scriptStep: 0,
  prodTab: "chars",
  pendingCharImages: new Set<number>(),
  pendingVoiceSamples: new Set<number>(),
  pendingSceneImages: new Set<number>(),
  pendingShotFrames: new Map<number, string>(),
  pendingShotTts: new Set<number>(),
  pendingVideos: new Set<number>(),
  pendingComposes: new Set<number>(),
  entityTasks: {},
  mergeStatus: null,
  mergeUrl: null,
  selectedStoryboard: null,
  localRaw: "",
  localScript: "",
  viewerOpen: false,
  viewerSrc: "",
  viewerTitle: "",
  lockedImageConfigLabel: "",
  lockedVideoConfigLabel: "",
  lockedAudioConfigLabel: "",
  running: false,
  runningType: null,
  runningNote: "",
  runningAbortController: null,
  runningTaskId: null,
  storyboardBreakdownIssue: null,
  storyboardDraftReview: null,
  publishingStoryboardDraft: false,
  pendingDeleteStoryboard: null,
};

async function refreshCurrentEpisodeSilently(getState: () => WorkbenchState) {
  const { drama, episode, loadAll } = getState();
  if (!drama || !episode) return;
  try {
    await loadAll(drama.id, episode.episode_number);
  } catch (error) {
    console.warn("[Workbench] failed to refresh current episode state", error);
  }
}

export const useWorkbench = create<WorkbenchState>((set, get) => ({
  ...initialState,

  reset: () => {
    get().runningAbortController?.abort();
    cancelEpisodePollWaiters();
    set({ ...initialState });
  },

  loadAll: async (dramaId: number, episodeNumber: number) => {
    try {
      const [d, voices, aiConfigsResult] = await Promise.all([
        dramaAPI.get(dramaId),
        voicesAPI.list(),
        aiConfigAPI.list(),
      ]);
      const aiConfigs = Array.isArray(aiConfigsResult) ? aiConfigsResult : [];
      const ep = d.episodes?.find(
        (episode: Episode) => episode.episode_number === episodeNumber,
      );
      if (!ep) {
        toast.error("未找到该集");
        return;
      }

      let sbs: Storyboard[] = [];
      let epChars: Character[] = [];
      let epScenes: Scene[] = [];
      let mergeInfo: EpisodeMergeStatusResponse | null = null;
      let activeAiTask: TaskRecord | null = null;
      let entityTasks: Record<string, TaskRecord> = {};
      let storyboardDraftReview: StoryboardDraftPreview | null = null;
      if (ep.id) {
        const [
          storyboards,
          characters,
          scenes,
          aiTasks,
          recentTasks,
          draftResult,
        ] = await Promise.all([
          episodeAPI.storyboards(ep.id),
          episodeAPI.characters(ep.id),
          episodeAPI.scenes(ep.id),
          taskAPI
            .list({
              page_size: 10,
              type: "ai,storyboard_breakdown",
              drama_id: dramaId,
              episode_id: ep.id,
              status: "queued,running",
              sort: "updated_at",
            })
            .catch((error: unknown) => {
              console.warn(
                "[Workbench] AI task status unavailable during loadAll",
                error,
              );
              return null;
            }),
          taskAPI
            .list({
              page_size: 100,
              drama_id: dramaId,
              status: RESTORABLE_TASK_STATUSES,
              sort: "updated_at",
            })
            .catch((error: unknown) => {
              console.warn(
                "[Workbench] entity task status unavailable during loadAll",
                error,
              );
              return null;
            }),
          episodeAPI.storyboardDraft(ep.id).catch((error: unknown) => {
            console.warn(
              "[Workbench] storyboard draft preview unavailable during loadAll",
              error,
            );
            return null;
          }),
        ]);
        const mergeStatus = await mergeAPI
          .status(ep.id)
          .catch((error: unknown) => {
            console.warn(
              "[Workbench] merge status unavailable during loadAll",
              error,
            );
            return null;
          });
        sbs = storyboards || [];
        epChars = characters || [];
        epScenes = scenes || [];
        mergeInfo = mergeStatus || null;
        activeAiTask =
          aiTasks?.items?.find((task) =>
            ACTIVE_TASK_STATUSES.has(String(task.status || "")),
          ) || null;
        entityTasks = buildWorkbenchEntityTasks({
          tasks: recentTasks?.items || [],
          characters: epChars,
          scenes: epScenes,
          storyboards: sbs,
          episode: ep,
        });
        storyboardDraftReview = draftResult?.draft || null;
      }

      const mergeUrl = mergeInfo?.merged_url || ep.video_url || null;
      const projectDefaults = getProjectDefaults(d);
      const effectiveImageConfigId = getEffectiveEpisodeConfigId(
        d,
        ep,
        "image",
      );
      const effectiveVideoConfigId = getEffectiveEpisodeConfigId(
        d,
        ep,
        "video",
      );
      const effectiveAudioConfigId = getEffectiveEpisodeConfigId(
        d,
        ep,
        "audio",
      );
      const imageSourceLabel = ep.image_config_id
        ? "本集"
        : projectDefaults.image_config_id
          ? "项目"
          : undefined;
      const videoSourceLabel = ep.video_config_id
        ? "本集"
        : projectDefaults.video_config_id
          ? "项目"
          : undefined;
      const audioSourceLabel = ep.audio_config_id
        ? "本集"
        : projectDefaults.audio_config_id
          ? "项目"
          : undefined;
      const visualCharacters = epChars.filter(isVisualCharacter);
      const ttsEligible = sbs.filter((sb) => !!getStoryboardTtsDialogue(sb));
      const nextNav = (() => {
        if (mergeUrl)
          return {
            panel: "export" as const,
            scriptStep: 4,
            prodTab: "compose",
          };
        if (sbs.length > 0) {
          if (visualCharacters.some((character) => !character.image_url))
            return {
              panel: "production" as const,
              scriptStep: 4,
              prodTab: "chars",
            };
          if (epScenes.some((scene) => !scene.image_url))
            return {
              panel: "production" as const,
              scriptStep: 4,
              prodTab: "scenes",
            };
          if (ttsEligible.some((storyboard) => !storyboard.tts_audio_url))
            return {
              panel: "production" as const,
              scriptStep: 4,
              prodTab: "dubbing",
            };
          if (sbs.some((storyboard) => !hasCompleteShotFrames(storyboard)))
            return {
              panel: "production" as const,
              scriptStep: 4,
              prodTab: "shots",
            };
          if (sbs.some((storyboard) => !storyboard.video_url))
            return {
              panel: "production" as const,
              scriptStep: 4,
              prodTab: "continuity",
            };
          if (sbs.some((storyboard) => !storyboard.composed_video_url))
            return {
              panel: "production" as const,
              scriptStep: 4,
              prodTab: "compose",
            };
          return {
            panel: "export" as const,
            scriptStep: 4,
            prodTab: "compose",
          };
        }
        if (
          ep.script_content &&
          epChars.length &&
          epChars.every((character) => !!character.voice_style)
        ) {
          return { panel: "script" as const, scriptStep: 4, prodTab: "chars" };
        }
        if (ep.script_content && epChars.length)
          return { panel: "script" as const, scriptStep: 3, prodTab: "chars" };
        if (ep.script_content)
          return { panel: "script" as const, scriptStep: 2, prodTab: "chars" };
        if (ep.content)
          return { panel: "script" as const, scriptStep: 1, prodTab: "chars" };
        return { panel: "script" as const, scriptStep: 0, prodTab: "chars" };
      })();

      set({
        drama: d,
        episode: ep,
        characters: epChars,
        scenes: epScenes,
        storyboards: sbs,
        voices: voices || [],
        localRaw: ep.content || "",
        localScript: ep.script_content || "",
        mergeStatus: mergeInfo,
        mergeUrl,
        panel: nextNav.panel,
        scriptStep: nextNav.scriptStep,
        prodTab: nextNav.prodTab,
        lockedImageConfigLabel: formatConfigLabel(
          effectiveImageConfigId,
          aiConfigs,
          "image",
          "图片",
          imageSourceLabel,
        ),
        lockedVideoConfigLabel: formatConfigLabel(
          effectiveVideoConfigId,
          aiConfigs,
          "video",
          "视频",
          videoSourceLabel,
        ),
        lockedAudioConfigLabel: formatConfigLabel(
          effectiveAudioConfigId,
          aiConfigs,
          "audio",
          "配音",
          audioSourceLabel,
        ),
        pendingCharImages: pendingIdsFromTasks(entityTasks, "character-image:"),
        pendingSceneImages: pendingIdsFromTasks(entityTasks, "scene-image:"),
        pendingShotFrames: pendingShotFramesFromTasks(entityTasks),
        pendingShotTts: pendingIdsFromTasks(entityTasks, "shot-tts:"),
        pendingVideos: pendingIdsFromTasks(entityTasks, "shot-video:"),
        pendingComposes: pendingIdsFromTasks(entityTasks, "shot-compose:"),
        entityTasks,
        running: !!activeAiTask,
        runningType: activeAiTask
          ? resolveWorkbenchAiTaskType(activeAiTask)
          : null,
        runningNote: activeAiTask
          ? formatRecoveredAiTaskNote(activeAiTask)
          : "",
        runningAbortController: null,
        runningTaskId: activeAiTask?.id ?? null,
        storyboardBreakdownIssue: null,
        storyboardDraftReview,
        publishingStoryboardDraft: false,
      });

      const recoveredEntityTaskIds = activeEntityTaskIds(entityTasks);
      if (recoveredEntityTaskIds.length) {
        const pollSerial = ++recoveredEntityPollSerial;
        const recoveredEpisodeId = ep.id;
        void (async () => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            await sleep(4000);
            if (pollSerial !== recoveredEntityPollSerial) break;
            if (get().episode?.id !== recoveredEpisodeId) break;

            const latestTasks = await Promise.all(
              recoveredEntityTaskIds.map((taskId) =>
                taskAPI.get(taskId).catch(() => null),
              ),
            );
            const knownTasks = latestTasks.filter(
              (task): task is TaskRecord => !!task,
            );
            if (!knownTasks.length) continue;
            if (
              knownTasks.every(
                (task) => !ACTIVE_TASK_STATUSES.has(String(task.status || "")),
              )
            ) {
              await get().loadAll(dramaId, episodeNumber);
              break;
            }
          }
        })();
      }

      if (activeAiTask) {
        const taskId = activeAiTask.id;
        const recoveredEpisodeId = ep.id;
        void (async () => {
          for (let attempt = 0; attempt < 40; attempt += 1) {
            await sleep(3000);
            if (get().episode?.id !== recoveredEpisodeId) break;
            const latest = await taskAPI.get(taskId).catch((error: unknown) => {
              console.warn(
                "[Workbench] recovered AI task polling failed",
                error,
              );
              return null;
            });
            if (!latest) continue;
            if (get().episode?.id !== recoveredEpisodeId) break;
            if (ACTIVE_TASK_STATUSES.has(String(latest.status || ""))) {
              set({
                running: true,
                runningType: resolveWorkbenchAiTaskType(latest),
                runningNote: formatRecoveredAiTaskNote(latest),
                runningTaskId: latest.id,
              });
              continue;
            }

            set({
              running: false,
              runningType: null,
              runningNote: "",
              runningTaskId: null,
            });
            if (latest.status === "completed") {
              await get().loadAll(dramaId, episodeNumber);
            } else if (latest.status === "failed" && latest.error_message) {
              toast.error("短剧 AI 任务失败", {
                description: getAiErrorCopy(new Error(latest.error_message)),
              });
            }
            break;
          }
        })();
      }
    } catch (e: unknown) {
      toast.error("加载短剧工作台失败", { description: getAiErrorCopy(e) });
    }
  },

  goSubStep: (key: string) => {
    if (key.startsWith("script-")) {
      set({ panel: "script", scriptStep: SCRIPT_STEP_MAP[key] ?? 0 });
    } else if (key.startsWith("prod-")) {
      const tabMap: Record<string, string> = {
        "prod-chars": "chars",
        "prod-scenes": "scenes",
        "prod-dubbing": "dubbing",
        "prod-shots": "shots",
        "prod-continuity": "continuity",
        "prod-videos": "videos",
        "prod-compose": "compose",
      };
      set({ panel: "production", prodTab: tabMap[key] || "chars" });
    } else if (key === "export-merge") {
      set({ panel: "export" });
    }
  },

  retryEntityTask: async (taskId: number) => {
    try {
      await taskAPI.retry(taskId);
      toast.info("已重新提交生成");
      const { drama, episode } = get();
      if (drama && episode) {
        await get().loadAll(drama.id, episode.episode_number);
      }
    } catch (e: unknown) {
      toast.error("重新提交失败", { description: getAiErrorCopy(e) });
    }
  },

  setLocalRaw: (v) => set({ localRaw: v }),
  setLocalScript: (v) => set({ localScript: v }),

  saveRaw: async (options = {}) => {
    const { episode, localRaw } = get();
    if (!episode) return;
    try {
      await episodeAPI.update(episode.id, { content: localRaw });
      set({ episode: { ...episode, content: localRaw } });
      if (!options.silent) toast.success("已保存");
    } catch (e: unknown) {
      if (!options.silent)
        toast.error("保存原始内容失败", { description: getAiErrorCopy(e) });
      throw e;
    }
  },

  doRewrite: async () => {
    const { episode, localRaw } = get();
    if (!episode) return;
    if (!localRaw.trim()) {
      toast.warning("请先填写原始内容");
      set({ panel: "script", scriptStep: 0 });
      return;
    }
    set({
      running: true,
      runningType: "script_rewriter",
      runningNote: "正在改写...",
    });
    try {
      let workingEpisode = episode;
      if (localRaw !== (episode.content || "")) {
        workingEpisode = (await episodeAPI.update(episode.id, {
          content: localRaw,
        })) as Episode;
        set({ episode: workingEpisode });
      }
      // Reset first so UI can render streaming output immediately
      set({ localScript: "" });

      let pending = "";
      let raf = 0;
      const flush = () => {
        raf = 0;
        set({ localScript: pending });
      };

      await fetchSSE({
        url: `/api/v1/ai/runs?stream=1`,
        method: "POST",
        body: {
          skill_id: "script_rewriter",
          mode: "rewrite",
          scene: "episode_script_workspace",
          input: { message: "改写以下内容" },
          target: {
            type: "episode",
            drama_id: workingEpisode.drama_id,
            episode_id: workingEpisode.id,
          },
        },
        onEvent: (evt) => {
          if (!evt.data) return;
          const payload = JSON.parse(evt.data) as {
            type?: string;
            text?: string;
            message?: string;
          };
          if (payload.type === "delta" && payload.text) {
            pending += payload.text;
            if (!raf) raf = requestAnimationFrame(flush);
          }
          if (payload.type === "status" && payload.text) {
            set({ runningNote: payload.text });
          }
          if (payload.type === "error") {
            throw new Error(payload.message || "改写失败");
          }
        },
      });

      if (raf) {
        cancelAnimationFrame(raf);
        flush();
      }

      const ep = await episodeAPI.get(workingEpisode.id);
      const streamedScript = pending.trim();
      const savedScript = ep.script_content?.trim() || "";
      if (!savedScript && streamedScript) {
        await episodeAPI.update(episode.id, { script_content: streamedScript });
        set({
          episode: { ...ep, script_content: streamedScript },
          localScript: streamedScript,
        });
      } else {
        set({ episode: ep, localScript: ep.script_content || pending });
      }
      toast.success("改写完成");
    } catch (e: unknown) {
      toastWorkbenchError("AI 改写", e, [get().runningNote]);
    } finally {
      set({ running: false, runningType: null, runningNote: "" });
    }
  },

  skipRewrite: async () => {
    const { episode, localRaw } = get();
    if (!episode) return;
    if (!localRaw.trim()) {
      toast.warning("请先填写原始内容");
      set({ panel: "script", scriptStep: 0 });
      return;
    }
    try {
      const ep = (await episodeAPI.update(episode.id, {
        content: localRaw,
        script_content: localRaw,
      })) as Episode;
      set({ localScript: localRaw, scriptStep: 2, episode: ep });
      toast.success("已跳过改写");
    } catch (e: unknown) {
      toast.error("跳过改写失败", { description: getAiErrorCopy(e) });
    }
  },

  doExtract: async () => {
    const { episode } = get();
    if (!episode) return;
    if (!episode.script_content?.trim()) {
      toast.warning("请先完成 AI 改写，或跳过改写使用原始内容");
      set({ panel: "script", scriptStep: 1 });
      return;
    }
    set({
      running: true,
      runningType: "extractor",
      runningNote: "正在提取角色和场景...",
    });
    try {
      await runAgentStream({
        type: "extractor",
        message: "提取角色和场景",
        dramaId: episode.drama_id,
        episodeId: episode.id,
        onStatus: (text) => set({ runningNote: text }),
      });
      const [epChars, epScenes] = await Promise.all([
        episodeAPI.characters(episode.id),
        episodeAPI.scenes(episode.id),
      ]);

      // Fallback only if BOTH episode lists are empty after extraction. Under the
      // skill-driven runtime the extractor handler always writes characters/scenes
      // and links episode_characters/scenes; an empty pair here means either the
      // AI returned zero items and the heuristic also found nothing, or there is
      // older drama-level data carrying through. We show drama-level totals with
      // an explicit "drama 兜底" hint so the user knows this isn't a fresh extraction.
      if (epChars.length === 0 && epScenes.length === 0) {
        const d = await dramaAPI.get(episode.drama_id);
        set({ characters: d.characters || [], scenes: d.scenes || [] });
        toast.warning(
          `本集未提取到任何角色/场景，显示 drama 全量兜底（角色 ${(d.characters || []).length} · 场景 ${(d.scenes || []).length}）`,
        );
      } else {
        set({ characters: epChars, scenes: epScenes });
        toast.success(
          `提取完成（角色 ${epChars.length} · 场景 ${epScenes.length}）`,
        );
      }
    } catch (e: unknown) {
      toastWorkbenchError("提取角色场景", e, [get().runningNote]);
    } finally {
      set({ running: false, runningType: null, runningNote: "" });
    }
  },

  doVoice: async () => {
    const { episode, characters } = get();
    if (!episode) return;
    if (characters.length === 0) {
      toast.warning("请先提取角色与场景");
      set({ panel: "script", scriptStep: 2 });
      return;
    }
    set({
      running: true,
      runningType: "voice_assigner",
      runningNote: "正在分配音色...",
    });
    try {
      await runAgentStream({
        type: "voice_assigner",
        message: "分配音色",
        dramaId: episode.drama_id,
        episodeId: episode.id,
        onStatus: (text) => set({ runningNote: text }),
      });

      const epChars = await episodeAPI.characters(episode.id);
      set({ characters: epChars || [] });
      toast.success("音色分配完成");
    } catch (e: unknown) {
      toastWorkbenchError("分配音色", e, [get().runningNote]);
    } finally {
      set({ running: false, runningType: null, runningNote: "" });
    }
  },

  batchVoiceSamples: async () => {
    const { episode, characters } = get();
    if (!episode) return;
    if (!get().voices.length) {
      toast.warning("暂无可用音色，请先在设置中启用音频配置并同步音色");
      return;
    }
    const availableVoices = new Set(
      get().voices.map((voice) => voice.voice_id),
    );
    const pending = characters.filter(
      (c) =>
        !!c.voice_style &&
        availableVoices.has(c.voice_style) &&
        !c.voice_sample_url,
    );
    if (!pending.length) {
      const voicedCount = characters.filter((c) => !!c.voice_style).length;
      toast.info(voicedCount > 0 ? "所有角色的试听文件已生成" : "请先分配音色");
      return;
    }

    set({
      running: true,
      runningType: "batch_voice_samples",
      runningNote: `正在生成试听文件...（${pending.length}个）`,
    });
    try {
      const results = await Promise.allSettled(
        pending.map((c) => characterAPI.voiceSample(c.id, episode.id)),
      );
      const okCount = results.filter(
        (item) => item.status === "fulfilled",
      ).length;
      const failCount = results.length - okCount;
      const epChars = await episodeAPI.characters(episode.id);
      set({ characters: epChars || characters });
      if (okCount > 0) toast.success(`已生成 ${okCount} 份试听文件`);
      if (failCount > 0)
        toast.error(`${failCount} 份试听文件生成失败`, {
          description: "请检查配音配置和角色音色是否仍可用。",
        });
    } catch (e: unknown) {
      toast.error("批量试听失败", { description: getAiErrorCopy(e) });
    } finally {
      set({ running: false, runningType: null, runningNote: "" });
    }
  },

  genVoiceSample: async (id: number) => {
    const { episode } = get();
    if (!episode) return;
    if (!get().voices.length) {
      toast.warning("暂无可用音色，请先在设置中启用音频配置并同步音色");
      return;
    }
    set((s) => {
      const n = new Set(s.pendingVoiceSamples);
      n.add(id);
      return { pendingVoiceSamples: n };
    });
    try {
      const result = await characterAPI.voiceSample(id, episode.id);
      set((s) => ({
        characters: s.characters.map((c) =>
          c.id === id ? { ...c, voice_sample_url: result.voice_sample_url } : c,
        ),
      }));
      toast.success("试听文件已生成");
    } catch (e: unknown) {
      toast.error("试听文件生成失败", { description: getAiErrorCopy(e) });
    } finally {
      set((s) => {
        const n = new Set(s.pendingVoiceSamples);
        n.delete(id);
        return { pendingVoiceSamples: n };
      });
    }
  },

  doBreakdown: async () => {
    const { episode } = get();
    if (!episode) return;
    if (get().running) {
      toast.info("已有 AI 任务正在运行，请等待当前任务结束");
      return;
    }
    if (!episode.script_content?.trim()) {
      toast.warning("请先完成 AI 改写，或跳过改写使用原始内容");
      set({ panel: "script", scriptStep: 1 });
      return;
    }
    const controller = new AbortController();
    set({
      running: true,
      runningType: "storyboard_breaker",
      runningNote: "正在拆解分镜...",
      runningAbortController: controller,
      runningTaskId: null,
      storyboardBreakdownIssue: null,
      storyboardDraftReview: null,
    });
    try {
      const requested = await episodeAPI.requestStoryboardBreakdown(episode.id);
      if (requested.runtime_enabled && requested.task_id) {
        set({
          runningTaskId: requested.task_id,
          runningNote:
            requested.status === "queued"
              ? "本集分镜已排队"
              : "正在拆解本集分镜",
        });
        while (true) {
          if (controller.signal.aborted) throw createAbortError();
          await sleep(3000, controller.signal);
          const latest = await taskAPI.get(requested.task_id);
          if (controller.signal.aborted) throw createAbortError();
          if (ACTIVE_TASK_STATUSES.has(String(latest.status || ""))) {
            set({ runningNote: formatRecoveredAiTaskNote(latest) });
            continue;
          }

          if (latest.status === "completed") {
            const summary = (latest.result_summary || {}) as Record<
              string,
              unknown
            >;
            const draftSetId = Number(summary.storyboard_set_id);
            const [sbs, draft] = await Promise.all([
              episodeAPI.storyboards(episode.id),
              summary.phase === "storyboard_review_required"
                ? Number.isInteger(draftSetId) && draftSetId > 0
                  ? storyboardAPI.getSet(draftSetId)
                  : episodeAPI
                      .storyboardDraft(episode.id)
                      .then((result) => result.draft)
                : Promise.resolve(null),
            ]);
            set({
              storyboards: sbs,
              selectedStoryboard: sbs[0] || null,
              panel: sbs.length > 0 ? "script" : get().panel,
              scriptStep: sbs.length > 0 ? 4 : get().scriptStep,
              storyboardDraftReview: draft,
            });
            if (summary.phase === "storyboard_review_required") {
              toast.warning(
                "分镜草稿已生成。当前分镜受到保护，请查看并确认是否替换。",
              );
            } else {
              toast.success(`分镜拆解完成（${sbs.length} 条）`);
            }
            break;
          }

          const message = latest.error_message || "分镜拆解任务未完成";
          set({
            storyboardBreakdownIssue: {
              kind: latest.status === "canceled" ? "canceled" : "failed",
              message,
              occurredAt: Date.now(),
            },
          });
          if (latest.status === "canceled") toast.info("分镜拆解已取消");
          else
            toast.error("分镜拆解失败", {
              description: getAiErrorCopy(new Error(message)),
            });
          break;
        }
      } else {
        const runInfo = await runAgentStream({
          type: "storyboard_breaker",
          message: "拆解分镜",
          dramaId: episode.drama_id,
          episodeId: episode.id,
          signal: controller.signal,
          onStatus: (text) => set({ runningNote: text }),
        });
        set({ runningNote: "AI 已返回，正在同步分镜到工作台..." });
        let sbs = await episodeAPI.storyboards(episode.id);
        if (sbs.length === 0) {
          set({ runningNote: "正在等待分镜落库..." });
          sbs = await waitForStoryboards(episode.id, controller.signal);
        }
        set({
          storyboards: sbs,
          selectedStoryboard: sbs[0] || null,
          panel: sbs.length > 0 ? "script" : get().panel,
          scriptStep: sbs.length > 0 ? 4 : get().scriptStep,
          storyboardDraftReview: null,
        });
        if (sbs.length === 0) {
          const called = runInfo.toolsCalled;
          const hasSaveTool = hasSaveStoryboardsTool(called);
          const message = !hasSaveTool
            ? "AI 已完成响应，但没有写入分镜。请重试拆解。"
            : "AI 已调用保存工具，但当前还没有查询到分镜记录。请重试或稍后刷新。";
          set({
            storyboardBreakdownIssue: {
              kind: "failed",
              message,
              detail: hasSaveTool
                ? "如果连续出现，请查看服务端日志确认 save_storyboards 写入结果。"
                : undefined,
              occurredAt: Date.now(),
            },
          });
          if (!hasSaveTool) {
            toast.error("分镜未保存：AI 未调用 save_storyboards 工具");
          } else {
            toast.error(
              "分镜未落库：save_storyboards 已调用但未写入，请查看服务端日志",
            );
          }
        } else {
          set({ runningNote: `分镜已保存，共 ${sbs.length} 条` });
          toast.success(`分镜拆解完成（${sbs.length} 条）`);
        }
      }
    } catch (e: unknown) {
      const note = get().runningNote;
      if (isAbortError(e)) {
        set({
          storyboardBreakdownIssue: {
            kind: "canceled",
            message:
              "分镜拆解已取消。已保留当前剧本与已有分镜，你可以随时重新拆解。",
            detail: note,
            occurredAt: Date.now(),
          },
        });
        toast.info("分镜拆解已取消");
      } else {
        set({
          storyboardBreakdownIssue: {
            kind: "failed",
            message: [formatWorkbenchError(e), getAiErrorDescription(e)]
              .filter(Boolean)
              .join(" · "),
            detail: note,
            occurredAt: Date.now(),
          },
        });
        toastWorkbenchError("分镜拆解", e, [note]);
      }
    } finally {
      const patch: Partial<WorkbenchState> = {
        running: false,
        runningType: null,
        runningNote: "",
        runningTaskId: null,
      };
      if (get().runningAbortController === controller)
        patch.runningAbortController = null;
      set(patch);
    }
  },

  cancelRunningAgent: () => {
    const { running, runningAbortController, runningTaskId } = get();
    if (!running) return;
    set({ runningNote: "正在取消当前 AI 任务..." });
    if (runningTaskId) {
      void taskAPI.cancel(runningTaskId).catch((error: unknown) => {
        console.warn("[Workbench] failed to cancel running task", error);
      });
    }
    runningAbortController?.abort();
  },

  confirmStoryboardDraftPublication: async () => {
    const { episode, storyboardDraftReview } = get();
    if (!episode || !storyboardDraftReview) return false;

    set({ publishingStoryboardDraft: true });
    try {
      const result = await storyboardAPI.publishSet(
        storyboardDraftReview.set_id,
        {
          confirm_replace: true,
        },
      );
      if (result.status !== "ready") {
        throw new Error("分镜草稿仍需复核，当前版本尚未发布");
      }

      const [updatedEpisode, storyboards] = await Promise.all([
        episodeAPI.get(episode.id),
        episodeAPI.storyboards(episode.id),
      ]);
      set({
        episode: updatedEpisode,
        storyboards,
        selectedStoryboard: storyboards[0] || null,
        panel: "script",
        scriptStep: 4,
        storyboardDraftReview: null,
        storyboardBreakdownIssue: null,
      });
      toast.success(`已替换为 AI 分镜草稿（${result.storyboard_count} 镜）`);
      return true;
    } catch (error: unknown) {
      toastWorkbenchError("确认替换分镜", error);
      return false;
    } finally {
      set({ publishingStoryboardDraft: false });
    }
  },

  updateCharVoice: async (id: number, voice: string) => {
    try {
      await characterAPI.update(id, { voice_style: voice });
      const chars = get().characters.map((c) =>
        c.id === id ? { ...c, voice_style: voice } : c,
      );
      set({ characters: chars });
    } catch (e: unknown) {
      toast.error("更新音色失败", { description: getAiErrorCopy(e) });
    }
  },

  genCharImg: async (id: number) => {
    const { episode } = get();
    if (!episode) return;
    set((s) => {
      const n = new Set(s.pendingCharImages);
      n.add(id);
      return { pendingCharImages: n };
    });
    try {
      await characterAPI.generateImage(id, episode.id);
      toast.info("角色图片生成已提交");
      const result = await waitForEpisodePoll<Character>({
        episodeId: episode.id,
        resources: ["characters"],
        timeoutMs: 180000,
        setState: set,
        getState: get,
        resolveWhen: (snapshot) => {
          const char = snapshot.characters?.find((item) => item.id === id);
          return char?.image_url ? { status: "completed", value: char } : null;
        },
      });
      if (result.status === "completed") {
        toast.success("角色图片生成完成");
        return;
      }
      if (result.status === "timeout") {
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("角色图片生成失败", { description: getAiErrorCopy(e) });
    } finally {
      set((s) => {
        const n = new Set(s.pendingCharImages);
        n.delete(id);
        return { pendingCharImages: n };
      });
    }
  },

  batchCharImages: async () => {
    const { episode, characters } = get();
    if (!episode) return;
    const ids = characters
      .filter((c) => isVisualCharacter(c) && !c.image_url)
      .map((c) => c.id);
    if (!ids.length) {
      toast.info("所有角色图片已生成");
      return;
    }

    set({
      running: true,
      runningType: "batch_char_images",
      runningNote: `批量生成角色图片中...（${ids.length}个）`,
      pendingCharImages: new Set([...get().pendingCharImages, ...ids]),
    });
    try {
      await characterAPI.batchImages(ids, episode.id);
      const result = await waitForEpisodePoll<void>({
        episodeId: episode.id,
        resources: ["characters"],
        timeoutMs: 240000,
        setState: set,
        getState: get,
        onSnapshot: (snapshot) => {
          const epChars = snapshot.characters;
          if (!epChars) return;
          const doneIds = epChars
            .filter((char) => !!char.image_url)
            .map((char) => char.id);
          const remain = ids.filter((id) => !doneIds.includes(id));
          const mergedPending = new Set(get().pendingCharImages);
          ids.forEach((pendingId) => {
            if (!remain.includes(pendingId)) mergedPending.delete(pendingId);
          });
          set({
            pendingCharImages: mergedPending,
            runningNote: remain.length
              ? `批量生成角色图片中...（剩余 ${remain.length} 个）`
              : "批量生成角色图片完成",
          });
        },
        resolveWhen: (snapshot) => {
          const epChars = snapshot.characters;
          if (!epChars) return null;
          const doneIds = epChars
            .filter((char) => !!char.image_url)
            .map((char) => char.id);
          const remain = ids.filter((id) => !doneIds.includes(id));
          return remain.length === 0
            ? { status: "completed", value: undefined }
            : null;
        },
      });
      if (result.status === "completed") {
        toast.success("角色图片批量生成完成");
        return;
      }
      if (result.status === "timeout") {
        toast.error("角色图片批量生成仍未完成", {
          description:
            "任务可能还在后台排队或处理。当前卡片会保留状态，可稍后查看失败原因并重试。",
        });
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("角色图片批量生成失败", { description: getAiErrorCopy(e) });
    } finally {
      const nextPending = new Set(get().pendingCharImages);
      ids.forEach((id) => nextPending.delete(id));
      set({
        running: false,
        runningType: null,
        runningNote: "",
        pendingCharImages: nextPending,
      });
    }
  },

  genSceneImg: async (id: number) => {
    const { episode } = get();
    if (!episode) return;
    set((s) => {
      const n = new Set(s.pendingSceneImages);
      n.add(id);
      return { pendingSceneImages: n };
    });
    try {
      await sceneAPI.generateImage(id, episode.id);
      toast.info("场景图片生成已提交");
      const result = await waitForEpisodePoll<Scene>({
        episodeId: episode.id,
        resources: ["scenes"],
        timeoutMs: 180000,
        setState: set,
        getState: get,
        resolveWhen: (snapshot) => {
          const scene = snapshot.scenes?.find((item) => item.id === id);
          return scene?.image_url
            ? { status: "completed", value: scene }
            : null;
        },
      });
      if (result.status === "completed") {
        toast.success("场景图片生成完成");
        return;
      }
      if (result.status === "timeout") {
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("场景图片生成失败", { description: getAiErrorCopy(e) });
    } finally {
      set((s) => {
        const n = new Set(s.pendingSceneImages);
        n.delete(id);
        return { pendingSceneImages: n };
      });
    }
  },

  batchSceneImages: async () => {
    const { episode, scenes } = get();
    if (!episode) return;
    const ids = scenes.filter((s) => !s.image_url).map((s) => s.id);
    if (!ids.length) {
      toast.info("所有场景图片已生成");
      return;
    }

    set({
      running: true,
      runningType: "batch_scene_images",
      runningNote: `批量生成场景图片中...（${ids.length}个）`,
      pendingSceneImages: new Set([...get().pendingSceneImages, ...ids]),
    });
    try {
      await Promise.allSettled(
        ids.map((id) => sceneAPI.generateImage(id, episode.id)),
      );
      const result = await waitForEpisodePoll<void>({
        episodeId: episode.id,
        resources: ["scenes"],
        timeoutMs: 240000,
        setState: set,
        getState: get,
        onSnapshot: (snapshot) => {
          const epScenes = snapshot.scenes;
          if (!epScenes) return;
          const doneIds = epScenes
            .filter((scene) => !!scene.image_url)
            .map((scene) => scene.id);
          const remain = ids.filter((id) => !doneIds.includes(id));
          const mergedPending = new Set(get().pendingSceneImages);
          ids.forEach((pendingId) => {
            if (!remain.includes(pendingId)) mergedPending.delete(pendingId);
          });
          set({
            pendingSceneImages: mergedPending,
            runningNote: remain.length
              ? `批量生成场景图片中...（剩余 ${remain.length} 个）`
              : "批量生成场景图片完成",
          });
        },
        resolveWhen: (snapshot) => {
          const epScenes = snapshot.scenes;
          if (!epScenes) return null;
          const doneIds = epScenes
            .filter((scene) => !!scene.image_url)
            .map((scene) => scene.id);
          const remain = ids.filter((id) => !doneIds.includes(id));
          return remain.length === 0
            ? { status: "completed", value: undefined }
            : null;
        },
      });
      if (result.status === "completed") {
        toast.success("场景图片批量生成完成");
        return;
      }
      if (result.status === "timeout") {
        toast.error("场景图片批量生成仍未完成", {
          description:
            "任务可能还在后台排队或处理。当前卡片会保留状态，可稍后查看失败原因并重试。",
        });
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("场景图片批量生成失败", { description: getAiErrorCopy(e) });
    } finally {
      const nextPending = new Set(get().pendingSceneImages);
      ids.forEach((id) => nextPending.delete(id));
      set({
        running: false,
        runningType: null,
        runningNote: "",
        pendingSceneImages: nextPending,
      });
    }
  },

  genShotTTS: async (sb: Storyboard) => {
    set((s) => {
      const n = new Set(s.pendingShotTts);
      n.add(sb.id);
      return { pendingShotTts: n };
    });
    try {
      await storyboardAPI.generateTTS(sb.id);
      toast.info("配音生成已提交");
      const result = await waitForEpisodePoll<Storyboard>({
        episodeId: sb.episode_id,
        resources: ["storyboards"],
        timeoutMs: 120000,
        setState: set,
        getState: get,
        resolveWhen: (snapshot) => {
          const updated = snapshot.storyboards?.find(
            (item) => item.id === sb.id,
          );
          return updated?.tts_audio_url
            ? { status: "completed", value: updated }
            : null;
        },
      });
      if (result.status === "completed") {
        toast.success("配音生成完成");
        return;
      }
      if (result.status === "timeout") {
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("配音生成失败", { description: getAiErrorCopy(e) });
    } finally {
      set((s) => {
        const n = new Set(s.pendingShotTts);
        n.delete(sb.id);
        return { pendingShotTts: n };
      });
    }
  },

  batchShotTTS: async () => {
    const { episode, storyboards } = get();
    if (!episode) return;
    const pending = storyboards.filter(
      (sb) => !!getStoryboardTtsDialogue(sb) && !sb.tts_audio_url,
    );
    if (!pending.length) {
      toast.info("所有可配音镜头已生成");
      return;
    }

    const pendingIds = pending.map((sb) => sb.id);
    set({
      running: true,
      runningType: "batch_tts",
      runningNote: `批量生成配音中...（${pending.length}条）`,
      pendingShotTts: new Set([...get().pendingShotTts, ...pendingIds]),
    });
    try {
      const results = await Promise.allSettled(
        pending.map((sb) => storyboardAPI.generateTTS(sb.id)),
      );
      const failed = results.filter(
        (item) => item.status === "rejected",
      ).length;
      if (failed > 0) {
        toast.warning(`已提交批量配音，${failed} 条提交失败`);
      }

      const result = await waitForEpisodePoll<void>({
        episodeId: episode.id,
        resources: ["storyboards"],
        timeoutMs: 180000,
        setState: set,
        getState: get,
        onSnapshot: (snapshot) => {
          const sbs = snapshot.storyboards;
          if (!sbs) return;
          const remainIds = pendingIds.filter((id) => {
            const storyboard = sbs.find((item) => item.id === id);
            return (
              !!storyboard &&
              !!getStoryboardTtsDialogue(storyboard) &&
              !storyboard.tts_audio_url
            );
          });
          const nextPending = new Set(get().pendingShotTts);
          pendingIds.forEach((id) => {
            if (!remainIds.includes(id)) nextPending.delete(id);
          });
          set({
            pendingShotTts: nextPending,
            runningNote: remainIds.length
              ? `批量生成配音中...（剩余 ${remainIds.length} 条）`
              : "批量配音完成",
          });
        },
        resolveWhen: (snapshot) => {
          const sbs = snapshot.storyboards;
          if (!sbs) return null;
          const remain = pendingIds.filter((id) => {
            const storyboard = sbs.find((item) => item.id === id);
            return (
              !!storyboard &&
              !!getStoryboardTtsDialogue(storyboard) &&
              !storyboard.tts_audio_url
            );
          }).length;
          return remain === 0
            ? { status: "completed", value: undefined }
            : null;
        },
      });
      if (result.status === "completed") {
        toast.success("批量配音完成");
        return;
      }
      if (result.status === "timeout") {
        toast.error("批量配音仍未完成", {
          description:
            "任务可能还在后台排队或处理。当前卡片会保留状态，可稍后查看失败原因并重试。",
        });
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("批量配音失败", { description: getAiErrorCopy(e) });
    } finally {
      const nextPending = new Set(get().pendingShotTts);
      pendingIds.forEach((id) => nextPending.delete(id));
      set({
        running: false,
        runningType: null,
        runningNote: "",
        pendingShotTts: nextPending,
      });
    }
  },

  genShotFrame: async (sb: Storyboard, frameType: string) => {
    const { episode, scenes, characters, drama } = get();
    if (!episode) return;
    const prompt = buildShotImagePrompt(sb, frameType, scenes);
    const referenceImages = buildShotReferenceImages(sb, scenes, characters);
    const configId = getEffectiveEpisodeConfigId(drama, episode, "image");
    set((s) => {
      const n = new Map(s.pendingShotFrames);
      n.set(sb.id, frameType);
      return { pendingShotFrames: n };
    });
    try {
      await imageAPI.generate({
        storyboard_id: sb.id,
        drama_id: episode.drama_id,
        prompt,
        frame_type: frameType,
        reference_images: referenceImages.length ? referenceImages : undefined,
        config_id: configId ?? undefined,
      });
      toast.info("镜头图片生成已提交");
      const field =
        frameType === "first_frame" ? "first_frame_image" : "last_frame_image";
      const result = await waitForEpisodePoll<Storyboard>({
        episodeId: sb.episode_id,
        resources: ["storyboards"],
        timeoutMs: 180000,
        setState: set,
        getState: get,
        resolveWhen: (snapshot) => {
          const updated = snapshot.storyboards?.find(
            (item) => item.id === sb.id,
          );
          return updated?.[field]
            ? { status: "completed", value: updated }
            : null;
        },
      });
      if (result.status === "completed") {
        toast.success("镜头图片生成完成");
        return;
      }
      if (result.status === "timeout") {
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("镜头图片生成失败", { description: getAiErrorCopy(e) });
    } finally {
      set((s) => {
        const n = new Map(s.pendingShotFrames);
        n.delete(sb.id);
        return { pendingShotFrames: n };
      });
    }
  },

  genShotVideo: async (sb: Storyboard) => {
    const { episode, drama } = get();
    if (!episode) return;
    const configId = getEffectiveEpisodeConfigId(drama, episode, "video");
    set((s) => {
      const n = new Set(s.pendingVideos);
      n.add(sb.id);
      return { pendingVideos: n };
    });
    try {
      await videoAPI.generate({
        storyboard_id: sb.id,
        drama_id: episode.drama_id,
        config_id: configId ?? undefined,
        prompt: buildNoDialogueShotVideoPrompt(sb),
        duration: sb.duration || 10,
      });
      toast.info("镜头视频生成已提交");
      const result = await waitForEpisodePoll<Storyboard>({
        episodeId: sb.episode_id,
        resources: ["storyboards"],
        timeoutMs: 600000,
        setState: set,
        getState: get,
        resolveWhen: (snapshot) => {
          const updated = snapshot.storyboards?.find(
            (item) => item.id === sb.id,
          );
          if (updated?.video_url)
            return { status: "completed", value: updated };
          if (
            updated?.status === "video_failed" ||
            updated?.status === "video_canceled"
          ) {
            return {
              status: "failed",
              message:
                updated.status === "video_canceled"
                  ? "镜头视频已取消"
                  : "镜头视频生成失败",
            };
          }
          return null;
        },
      });
      if (result.status === "completed") {
        toast.success("镜头视频生成完成");
        return;
      }
      if (result.status === "failed") {
        await refreshCurrentEpisodeSilently(get);
        toast.error(result.message || "镜头视频生成失败");
        return;
      }
      if (result.status === "timeout") {
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("镜头视频生成失败", { description: getAiErrorCopy(e) });
    } finally {
      set((s) => {
        const n = new Set(s.pendingVideos);
        n.delete(sb.id);
        return { pendingVideos: n };
      });
    }
  },

  batchShotVideos: async () => {
    const { episode, storyboards, drama } = get();
    if (!episode) return;
    const pending = storyboards.filter((storyboard) => !storyboard.video_url);
    if (!pending.length) {
      toast.info("所有镜头视频已生成");
      return;
    }
    const configId = getEffectiveEpisodeConfigId(drama, episode, "video");

    const ids = pending.map((storyboard) => storyboard.id);
    set({
      running: true,
      runningType: "batch_videos",
      runningNote: `批量生成视频中...（${pending.length}个）`,
      pendingVideos: new Set([...get().pendingVideos, ...ids]),
    });

    try {
      const results = await Promise.allSettled(
        pending.map(async (storyboard) => {
          await videoAPI.generate({
            storyboard_id: storyboard.id,
            drama_id: episode.drama_id,
            config_id: configId ?? undefined,
            prompt: buildNoDialogueShotVideoPrompt(storyboard),
            duration: storyboard.duration || 10,
          });
          return storyboard.id;
        }),
      );
      const submittedIds = results
        .filter(
          (item): item is PromiseFulfilledResult<number> =>
            item.status === "fulfilled",
        )
        .map((item) => item.value);
      const failed = results.length - submittedIds.length;
      if (failed > 0) toast.warning(`已提交批量视频生成，${failed} 个提交失败`);
      if (!submittedIds.length) return;

      set((s) => {
        const nextPending = new Set(s.pendingVideos);
        ids
          .filter((id) => !submittedIds.includes(id))
          .forEach((id) => nextPending.delete(id));
        return { pendingVideos: nextPending };
      });

      const result = await waitForEpisodePoll<{ failedIds: number[] }>({
        episodeId: episode.id,
        resources: ["storyboards"],
        timeoutMs: 600000,
        setState: set,
        getState: get,
        onSnapshot: (snapshot) => {
          const sbs = snapshot.storyboards;
          if (!sbs) return;
          const failedIds = submittedIds.filter((id) => {
            const storyboard = sbs.find((item) => item.id === id);
            return (
              storyboard?.status === "video_failed" ||
              storyboard?.status === "video_canceled"
            );
          });
          const remain = submittedIds.filter((id) => {
            const storyboard = sbs.find((item) => item.id === id);
            return !storyboard?.video_url && !failedIds.includes(id);
          });
          const nextPending = new Set(get().pendingVideos);
          submittedIds.forEach((id) => {
            if (!remain.includes(id)) nextPending.delete(id);
          });
          set({
            pendingVideos: nextPending,
            runningNote: remain.length
              ? `批量生成视频中...（剩余 ${remain.length} 个）`
              : "批量视频生成完成",
          });
        },
        resolveWhen: (snapshot) => {
          const sbs = snapshot.storyboards;
          if (!sbs) return null;
          const failedIds = submittedIds.filter((id) => {
            const storyboard = sbs.find((item) => item.id === id);
            return (
              storyboard?.status === "video_failed" ||
              storyboard?.status === "video_canceled"
            );
          });
          const remain = submittedIds.filter((id) => {
            const storyboard = sbs.find((item) => item.id === id);
            return !storyboard?.video_url && !failedIds.includes(id);
          });
          return remain.length === 0
            ? { status: "completed", value: { failedIds } }
            : null;
        },
      });
      if (result.status === "completed") {
        if (result.value.failedIds.length > 0) {
          toast.error(
            `批量视频生成完成，但有 ${result.value.failedIds.length} 个镜头失败`,
          );
          await refreshCurrentEpisodeSilently(get);
        } else {
          toast.success("批量视频生成完成");
        }
        return;
      }
      if (result.status === "timeout") {
        toast.error("批量视频生成仍未完成", {
          description:
            "视频生成耗时较长，任务可能还在后台运行。当前卡片会保留状态，可稍后查看失败原因并重试。",
        });
        await refreshCurrentEpisodeSilently(get);
      }
    } catch (e: unknown) {
      toast.error("批量视频生成失败", { description: getAiErrorCopy(e) });
    } finally {
      const nextPending = new Set(get().pendingVideos);
      ids.forEach((id) => nextPending.delete(id));
      set({
        running: false,
        runningType: null,
        runningNote: "",
        pendingVideos: nextPending,
      });
    }
  },

  composeShot: async (sb: Storyboard) => {
    const { episode } = get();
    if (!episode) return;
    const clearPendingCompose = () => {
      set((s) => {
        const n = new Set(s.pendingComposes);
        n.delete(sb.id);
        return { pendingComposes: n };
      });
    };
    set((s) => {
      const n = new Set(s.pendingComposes);
      n.add(sb.id);
      return { pendingComposes: n };
    });
    try {
      await composeAPI.shot(sb.id);
      toast.info("合成任务已提交");
      const result = await waitForEpisodePoll<void>({
        episodeId: episode.id,
        resources: ["storyboards", "composeStatus"],
        timeoutMs: 360000,
        setState: set,
        getState: get,
        resolveWhen: (snapshot) => {
          const updated = snapshot.storyboards?.find(
            (item) => item.id === sb.id,
          );
          const statusItem = Array.isArray(snapshot.composeStatus?.items)
            ? snapshot.composeStatus.items.find((item) => item.id === sb.id)
            : null;
          if (updated?.composed_video_url)
            return { status: "completed", value: undefined };
          if (
            statusItem?.status === "compose_failed" ||
            statusItem?.status === "compose_canceled"
          ) {
            return {
              status: "failed",
              message:
                statusItem.error_message ||
                (statusItem.status === "compose_canceled"
                  ? "合成已取消"
                  : "合成失败"),
            };
          }
          return null;
        },
      });
      if (result.status === "completed") {
        toast.success("合成完成");
        return;
      }
      if (result.status === "failed") {
        toast.error(
          result.message === "合成已取消" ? "合成已取消" : "合成失败",
          {
            description:
              result.message &&
              result.message !== "合成已取消" &&
              result.message !== "合成失败"
                ? getAiErrorCopy(new Error(result.message))
                : undefined,
          },
        );
        return;
      }
      if (result.status === "timeout") {
        const sbs = await episodeAPI.storyboards(episode.id);
        set({ storyboards: sbs || [] });
        const updated = sbs.find((s) => s.id === sb.id);
        if (updated?.composed_video_url) {
          toast.success("合成完成");
        } else {
          const stillRunning =
            updated?.status === "compose_processing" ||
            updated?.status === "compose_queued";
          if (stillRunning) {
            toast.info("合成任务仍在后台运行，可稍后刷新查看");
            return;
          }
          toast.error("合成状态轮询超时", {
            description:
              "任务可能仍在后台运行。当前镜头卡片会保留状态，可稍后查看。",
          });
        }
      }
    } catch (e: unknown) {
      toast.error("镜头合成失败", { description: getAiErrorCopy(e) });
    } finally {
      clearPendingCompose();
    }
  },

  batchCompose: async () => {
    const { episode, storyboards } = get();
    if (!episode) return;
    const hasVideo = storyboards.some((sb) => !!sb.video_url);
    if (!hasVideo) {
      toast.warning("请先生成镜头视频");
      return;
    }

    set({
      running: true,
      runningType: "compose_all",
      runningNote: "批量合成中...",
    });
    try {
      await composeAPI.all(episode.id);
      toast.info("批量合成已提交");

      const result = await waitForEpisodePoll<{ failed: number }>({
        episodeId: episode.id,
        resources: ["storyboards", "composeStatus"],
        timeoutMs: 360000,
        setState: set,
        getState: get,
        onSnapshot: (snapshot) => {
          const items = Array.isArray(snapshot.composeStatus?.items)
            ? snapshot.composeStatus.items
            : [];
          const processing = items.filter(
            (item) =>
              item.status === "compose_processing" ||
              item.status === "compose_queued",
          );
          if (items.length > 0 && processing.length > 0) {
            set({
              runningNote: `批量合成中...（剩余 ${processing.length} 条）`,
            });
          }
        },
        resolveWhen: (snapshot) => {
          const items = Array.isArray(snapshot.composeStatus?.items)
            ? snapshot.composeStatus.items
            : [];
          if (!items.length) return null;
          const processing = items.filter(
            (item) =>
              item.status === "compose_processing" ||
              item.status === "compose_queued",
          );
          if (processing.length > 0) return null;
          const failed = items.filter(
            (item) => item.status === "compose_failed",
          );
          return { status: "completed", value: { failed: failed.length } };
        },
      });
      if (result.status === "completed") {
        if (result.value.failed > 0) {
          toast.error(`批量合成完成，但有 ${result.value.failed} 个镜头失败`, {
            description: "请在对应镜头卡片查看失败原因并重试。",
          });
        } else {
          toast.success("批量合成完成");
        }
        return;
      }
      if (result.status === "timeout") {
        toast.error("批量合成状态轮询超时", {
          description:
            "任务可能仍在后台运行。当前镜头卡片会保留状态，可稍后查看。",
        });
      }
    } catch (e: unknown) {
      toast.error("批量合成失败", { description: getAiErrorCopy(e) });
    } finally {
      set({
        running: false,
        runningType: null,
        runningNote: "",
        pendingComposes: new Set<number>(),
      });
    }
  },

  mergeEpisode: async () => {
    const { episode } = get();
    if (!episode) return;
    try {
      await mergeAPI.merge(episode.id);
      toast.info("成片合并已提交");
      set({ mergeStatus: { status: "pending" } });
      get().pollMergeStatus();
    } catch (e: unknown) {
      toast.error("合并成片失败", { description: getAiErrorCopy(e) });
    }
  },

  pollMergeStatus: async () => {
    const { episode } = get();
    if (!episode) return;
    for (let i = 0; i < 120; i++) {
      await sleep(3000);
      try {
        const merge: EpisodeMergeStatusResponse | null = await mergeAPI.status(
          episode.id,
        );
        const mergedUrl = merge?.merged_url || null;
        if (merge?.status === "completed" && mergedUrl) {
          set({ mergeStatus: merge, mergeUrl: mergedUrl });
          toast.success("\u5408\u5e76\u5b8c\u6210\uff01");
          return;
        }
        if (merge?.status === "failed" || merge?.status === "canceled") {
          set({ mergeStatus: merge });
          toast.error(
            merge.status === "canceled"
              ? "\u5408\u5e76\u5df2\u53d6\u6d88"
              : "\u5408\u5e76\u5931\u8d25",
            {
              description: merge.error_message
                ? getAiErrorCopy(new Error(merge.error_message))
                : undefined,
            },
          );
          return;
        }
      } catch {
        /* ignore poll errors */
      }
    }
  },

  updateField: async (sb: Storyboard, field: string, value: unknown) => {
    try {
      await storyboardAPI.update(sb.id, { [field]: value });
      const updated = get().storyboards.map((s) =>
        s.id === sb.id ? { ...s, [field]: value } : s,
      ) as Storyboard[];
      set({
        storyboards: updated,
        selectedStoryboard: { ...sb, [field]: value } as Storyboard,
      });
    } catch (e: unknown) {
      toast.error("更新分镜失败", { description: getAiErrorCopy(e) });
    }
  },

  toggleStoryboardCharacter: async (sb: Storyboard, charId: number) => {
    const current = (sb.characters || []) as Character[];
    const has = current.some((c) => c.id === charId);
    const updated: Character[] = has
      ? current.filter((c) => c.id !== charId)
      : [...current, { id: charId } as Character];
    const updatedIds = updated.map((character) => character.id);

    try {
      await storyboardAPI.update(sb.id, { character_ids: updatedIds });
      const sbs = get().storyboards.map((s) =>
        s.id === sb.id
          ? { ...s, characters: updated, character_ids: updatedIds }
          : s,
      ) as Storyboard[];
      set({
        storyboards: sbs,
        selectedStoryboard: {
          ...sb,
          characters: updated,
          character_ids: updatedIds,
        } as Storyboard,
      });
    } catch (e: unknown) {
      toast.error("更新镜头角色失败", { description: getAiErrorCopy(e) });
    }
  },

  requestDeleteShot: (sb: Storyboard) => set({ pendingDeleteStoryboard: sb }),
  cancelDeleteShot: () => set({ pendingDeleteStoryboard: null }),
  confirmDeleteShot: async () => {
    const sb = get().pendingDeleteStoryboard;
    if (!sb) return;
    try {
      await storyboardAPI.del(sb.id);
      const sbs = get().storyboards.filter((s) => s.id !== sb.id);
      set({
        storyboards: sbs,
        selectedStoryboard: sbs[0] || null,
        pendingDeleteStoryboard: null,
      });
      toast.success("已删除");
    } catch (e: unknown) {
      toast.error("删除分镜失败", { description: getAiErrorCopy(e) });
    }
  },

  openImageViewer: (src, title = "") =>
    set({ viewerOpen: true, viewerSrc: src, viewerTitle: title }),
  closeImageViewer: () => set({ viewerOpen: false }),

  pipelineProgress: () => {
    const { characters, scenes, storyboards } = get();
    const visualCharacters = characters.filter(isVisualCharacter);
    const ttsEligible = storyboards.filter(
      (storyboard) => !!getStoryboardTtsDialogue(storyboard),
    );
    let prog = 0;
    if (get().episode?.content?.trim()) prog++;
    if (characters.length) prog++;
    if (characters.length && characters.every((c) => c.voice_style)) prog++;
    if (storyboards.length) prog++;
    if (
      characters.length > 0 &&
      (visualCharacters.length === 0 ||
        visualCharacters.every((c) => c.image_url))
    )
      prog++;
    if (
      storyboards.length > 0 &&
      (scenes.length === 0 || scenes.every((s) => s.image_url))
    )
      prog++;
    if (
      storyboards.length > 0 &&
      (ttsEligible.length === 0 || ttsEligible.every((s) => s.tts_audio_url))
    )
      prog++;
    if (storyboards.length > 0 && storyboards.every(hasCompleteShotFrames))
      prog++;
    if (storyboards.length > 0 && storyboards.every((s) => s.video_url)) prog++;
    if (
      storyboards.length > 0 &&
      storyboards.every((s) => s.composed_video_url)
    )
      prog++;
    if (get().mergeUrl) prog++;
    return prog;
  },

  charsVoiced: () => get().characters.filter((c) => c.voice_style).length,
  totalDuration: () =>
    get().storyboards.reduce((sum: number, s) => sum + (s.duration || 10), 0),
}));
