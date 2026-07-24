import {
  EPISODE_WORKSPACE_STAGES,
  type EpisodeWorkspaceStage,
} from "@xiaochuang/contracts";

export const PROJECT_STAGES = [
  "source",
  "plan",
  "script",
  "graph",
  "storyboard",
] as const;

export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const LEGACY_STAGE_REDIRECT: Record<string, ProjectStage> = {
  brief: "plan",
  blueprint: "plan",
};

export const EPISODE_STEPS = [
  "script-raw",
  "script-rewrite",
  "script-extract",
  "script-voice",
  "script-storyboard",
  "prod-chars",
  "prod-scenes",
  "prod-dubbing",
  "prod-shots",
  "prod-continuity",
  "prod-videos",
  "prod-compose",
  "export-merge",
] as const;

export type EpisodeStep = (typeof EPISODE_STEPS)[number];

/**
 * The user-facing single-episode flow. Technical substeps remain available
 * inside each stage, but do not form the primary navigation anymore.
 */
export const EPISODE_STAGES = EPISODE_WORKSPACE_STAGES;

export type EpisodeStage = EpisodeWorkspaceStage;

export const EPISODE_STAGE_LABELS: Record<EpisodeStage, string> = {
  script: "剧本",
  storyboard: "分镜",
  assets: "素材",
  video: "视频",
  final: "成片",
};

export const EPISODE_STEP_STAGE: Record<EpisodeStep, EpisodeStage> = {
  "script-raw": "script",
  "script-rewrite": "script",
  "script-extract": "script",
  "script-voice": "script",
  "script-storyboard": "storyboard",
  "prod-chars": "assets",
  "prod-scenes": "assets",
  "prod-dubbing": "video",
  "prod-shots": "assets",
  "prod-continuity": "assets",
  "prod-videos": "video",
  "prod-compose": "final",
  "export-merge": "final",
};

export type EpisodeRouteContext = {
  shot?: number | string | null;
  asset?: number | string | null;
  task?: number | string | null;
  origin?: string | null;
};

export type RouteSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type EpisodeRouteResolution = {
  stage: EpisodeStage;
  step: EpisodeStep;
  context: EpisodeRouteContext;
  isLegacyStep: boolean;
};

export type LastEpisodeLocation = {
  episodeNumber: number;
  step: EpisodeStep;
  updatedAt: number;
};

const LAST_EPISODE_LOCATION_PREFIX =
  "xiaochuang:drama:last-episode-location:v1";

export function parseProjectStage(
  value: string | null | undefined,
): ProjectStage | null {
  if (!value) return null;
  if (PROJECT_STAGES.includes(value as ProjectStage))
    return value as ProjectStage;
  return LEGACY_STAGE_REDIRECT[value] ?? null;
}

export function parseEpisodeStep(
  value: string | null | undefined,
): EpisodeStep | null {
  return EPISODE_STEPS.includes(value as EpisodeStep)
    ? (value as EpisodeStep)
    : null;
}

export function parseEpisodeStage(
  value: string | null | undefined,
): EpisodeStage | null {
  return EPISODE_STAGES.includes(value as EpisodeStage)
    ? (value as EpisodeStage)
    : null;
}

export function getEpisodeStageForStep(step: EpisodeStep): EpisodeStage {
  return EPISODE_STEP_STAGE[step];
}

export function getDefaultEpisodeStep(
  stage: EpisodeStage,
  context: EpisodeRouteContext = {},
): EpisodeStep {
  if (stage === "script") return "script-rewrite";
  if (stage === "storyboard") return "script-storyboard";
  if (stage === "assets") return context.shot ? "prod-shots" : "prod-chars";
  if (stage === "video") return context.shot ? "prod-videos" : "prod-dubbing";
  return "export-merge";
}

/**
 * Converts both the five-stage URL and retained technical-step URLs into the
 * same workbench location. A valid `step`/`tool` can refine the active stage
 * when it belongs to that stage; otherwise the stage default is used.
 */
export function resolveEpisodeRoute(args: {
  stage?: string | null;
  step?: string | null;
  context?: EpisodeRouteContext;
}): EpisodeRouteResolution {
  const stage = parseEpisodeStage(args.stage);
  const legacyStep = parseEpisodeStep(args.step);
  const resolvedStage = stage ?? (legacyStep ? getEpisodeStageForStep(legacyStep) : "script");
  const stepBelongsToStage =
    Boolean(stage && legacyStep) && getEpisodeStageForStep(legacyStep as EpisodeStep) === stage;

  return {
    stage: resolvedStage,
    step: stepBelongsToStage
      ? (legacyStep as EpisodeStep)
      : stage
        ? getDefaultEpisodeStep(stage, args.context)
        : legacyStep ?? getDefaultEpisodeStep(resolvedStage, args.context),
    context: args.context ?? {},
    isLegacyStep: !stage && Boolean(legacyStep),
  };
}

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  source: "源稿理解",
  plan: "分集规划",
  script: "剧本正文",
  graph: "故事地图",
  storyboard: "分镜制作",
};

export type ProjectStageProgressState = "done" | "active" | "waiting";

export function getProjectStageIndex(stage: ProjectStage) {
  return PROJECT_STAGES.indexOf(stage);
}

export function isProjectStageUnlocked(
  stage: ProjectStage,
  recommendedStage: ProjectStage,
) {
  return getProjectStageIndex(stage) <= getProjectStageIndex(recommendedStage);
}

export function resolveProjectStageProgressState(
  stage: ProjectStage,
  recommendedStage: ProjectStage,
): ProjectStageProgressState {
  const stageIndex = getProjectStageIndex(stage);
  const recommendedIndex = getProjectStageIndex(recommendedStage);
  if (stageIndex < recommendedIndex) return "done";
  if (stageIndex === recommendedIndex) return "active";
  return "waiting";
}

export function resolveRecommendedProjectStage(args: {
  hasUsableSource: boolean;
  hasSourceAnalysis: boolean;
  plannedEpisodes: number;
  targetEpisodes: number;
  currentScriptedEpisodes: number;
  graphReady: boolean;
  storyboardEpisodes: number;
}): ProjectStage {
  if (!args.hasUsableSource) return "source";
  if (!args.hasSourceAnalysis) return "source";
  if (args.plannedEpisodes < Math.max(1, args.targetEpisodes)) return "plan";
  if (args.currentScriptedEpisodes < Math.max(1, args.targetEpisodes))
    return "script";
  if (!args.graphReady) return "graph";
  return "storyboard";
}

export function resolveEffectiveProjectStage(args: {
  requestedStage: ProjectStage | null;
  recommendedStage: ProjectStage;
}) {
  const normalized = args.requestedStage
    ? (LEGACY_STAGE_REDIRECT[args.requestedStage as string] ??
      args.requestedStage)
    : null;
  if (normalized && isProjectStageUnlocked(normalized, args.recommendedStage)) {
    return normalized;
  }
  return args.recommendedStage;
}

export function getProjectStageHref(dramaId: number, stage: ProjectStage) {
  return `/drama/${dramaId}/episodes?stage=${stage}`;
}

export function getEpisodeWorkbenchHref(
  dramaId: number,
  episodeNumber: number,
  stageOrStep?: EpisodeStage | EpisodeStep,
  context: EpisodeRouteContext = {},
) {
  const base = `/drama/${dramaId}/episodes/${episodeNumber}`;
  if (!stageOrStep) return base;
  const stage = parseEpisodeStage(stageOrStep) ?? getEpisodeStageForStep(stageOrStep as EpisodeStep);
  const params = new URLSearchParams({ stage });
  for (const [key, value] of Object.entries(context)) {
    if (value != null && String(value).trim()) params.set(key, String(value));
  }
  return `${base}?${params.toString()}`;
}

/**
 * Normalizes retained workbench links to the five-stage route while preserving
 * only the object context that the current workbench understands.
 */
export function getLegacyEpisodeWorkbenchHref(args: {
  dramaId: number | string;
  episodeNumber: number | string;
  searchParams: RouteSearchParams;
  fallbackStage?: EpisodeStage;
}) {
  const first = (key: string) => {
    const value = args.searchParams[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const context: EpisodeRouteContext = {
    shot: first("shot"),
    asset: first("asset"),
    task: first("task"),
    origin: first("origin"),
  };
  const route = resolveEpisodeRoute({
    stage: first("stage") ?? args.fallbackStage,
    step: first("step"),
    context,
  });

  const href = getEpisodeWorkbenchHref(
    Number(args.dramaId),
    Number(args.episodeNumber),
    route.stage,
    context,
  );
  // `tool` keeps a retained technical deep link exact without restoring the
  // old thirteen-step navigation as a competing primary route.
  return route.isLegacyStep ? `${href}&tool=${route.step}` : href;
}

export function getLegacyEpisodeNumber(searchParams: RouteSearchParams) {
  for (const key of ["episode", "episodeNumber", "n"]) {
    const value = searchParams[key];
    const candidate = Array.isArray(value) ? value[0] : value;
    const parsed = Number(candidate);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

/** @deprecated Prefer resolveRecommendedProjectStage with ai-first signals. */
export function resolveProjectStageFromCounts(args: {
  episodes: number;
  scriptedEpisodes: number;
  storyboardEpisodes: number;
  graphReady?: boolean;
}) {
  return resolveRecommendedProjectStage({
    hasUsableSource: true,
    hasSourceAnalysis: true,
    plannedEpisodes: args.episodes,
    targetEpisodes: args.episodes,
    currentScriptedEpisodes: args.scriptedEpisodes,
    graphReady: args.graphReady ?? false,
    storyboardEpisodes: args.storyboardEpisodes,
  });
}

function lastEpisodeLocationKey(dramaId: number) {
  return `${LAST_EPISODE_LOCATION_PREFIX}:${dramaId}`;
}

export function readLastEpisodeLocation(
  dramaId: number,
): LastEpisodeLocation | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(lastEpisodeLocationKey(dramaId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastEpisodeLocation>;
    if (!Number.isInteger(parsed.episodeNumber) || parsed.episodeNumber! <= 0)
      return null;
    const step = parseEpisodeStep(parsed.step);
    if (!step) return null;
    return {
      episodeNumber: parsed.episodeNumber!,
      step,
      updatedAt: Number(parsed.updatedAt) || 0,
    };
  } catch {
    return null;
  }
}

export function rememberEpisodeLocation(
  dramaId: number,
  episodeNumber: number,
  step: EpisodeStep,
) {
  if (typeof window === "undefined") return;
  try {
    const payload: LastEpisodeLocation = {
      episodeNumber,
      step,
      updatedAt: Date.now(),
    };
    window.localStorage.setItem(
      lastEpisodeLocationKey(dramaId),
      JSON.stringify(payload),
    );
  } catch {
    // Local storage can be unavailable in restricted browser contexts.
  }
}
