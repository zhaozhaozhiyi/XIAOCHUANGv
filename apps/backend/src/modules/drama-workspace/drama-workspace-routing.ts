export type DramaWorkspaceRouteStage =
  | "source"
  | "script"
  | "graph"
  | "storyboard"
  | "assets"
  | "video"
  | "final";

export type DramaWorkspaceTaskLike = {
  domainTable?: string | null;
  type?: string | null;
  sourceType?: string | null;
  title?: string | null;
  payloadJson?: string | null;
};

function parseJsonRecord(value: string | null | undefined) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function buildDramaWorkspaceHref(
  dramaId: number,
  stage: DramaWorkspaceRouteStage,
  options: {
    episodeNumber?: number | null;
    shotId?: number | null;
    taskId?: number | null;
    origin?: string;
  } = {},
) {
  const search = new URLSearchParams({
    stage,
    origin: options.origin ?? "assistant",
  });
  if (options.shotId) search.set("shot", String(options.shotId));
  if (options.taskId) search.set("task", String(options.taskId));

  return options.episodeNumber
    ? `/drama/${dramaId}/episodes/${options.episodeNumber}?${search.toString()}`
    : `/drama/${dramaId}/episodes?${search.toString()}`;
}

export function resolveDramaWorkspaceTaskStage(
  task: DramaWorkspaceTaskLike,
): DramaWorkspaceRouteStage {
  const payload = parseJsonRecord(task.payloadJson);
  const signature = [
    task.domainTable,
    task.type,
    task.sourceType,
    task.title,
    payload.skill_id,
    payload.mode,
    payload.scene,
    payload.target_type,
    payload.target_field,
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ");

  if (signature.includes("story_graph")) return "graph";
  if (signature.includes("compose") || signature.includes("merge") || signature.includes("export")) return "final";
  if (signature.includes("image") || signature.includes("frame")) return "assets";
  if (signature.includes("tts") || signature.includes("audio") || signature.includes("video")) return "video";
  if (signature.includes("storyboard")) return "storyboard";
  if (signature.includes("source") || signature.includes("brief") || signature.includes("blueprint")) return "source";
  return "script";
}
