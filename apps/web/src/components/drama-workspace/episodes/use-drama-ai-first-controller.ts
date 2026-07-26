"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  dramaAPI,
  episodeAPI,
  taskAPI,
  writingAPI,
  type DramaAiFirstPayload,
  type StoryGraphSummaryPayload,
} from "@/lib/api";
import { getAiErrorCopy } from "@/lib/ai-error-copy";
import {
  getAdaptationPlan,
  getDramaAiFirstMetadata,
  getNovelSource,
  normalizeEpisodeBlueprintPayload,
} from "@/lib/drama-metadata";
import {
  getDramaAiFirstState,
  getNovelSourceHealth,
} from "@/lib/drama-product-state";
import { useAppSession } from "@/components/shared/app-session-provider";
import type {
  Drama,
  Episode,
  SourceHealth,
  WritingListItem,
} from "@/types/api";
import {
  buildChapterIndex,
  countNovelWords,
  createTargetSettingsKey,
  formatBlueprintDetail,
  formatBlueprintPhase,
  formatPilotScriptDetail,
  formatPilotScriptPhase,
  formatRuntimeTaskDetail,
  formatSourceAnalysisPhase,
  formatTaskProgress,
  getEpisodeStaleLabel,
  hasScript,
  isActiveTaskStatus,
  isFailedTaskStatus,
  type AdaptationTargetSettings,
} from "../legacy/ai-first-workbench-parts";
import { getProjectStageHref } from "./episode-route";

type UseDramaAiFirstControllerOptions = {
  onWorkspaceRefresh?: () => Promise<unknown> | unknown;
};

type TaskLabel =
  | "源稿理解任务"
  | "分集蓝图任务"
  | "剧本正文任务"
  | "故事地图任务";

type NovelSourcePersistenceRequest = {
  content: string;
  sourceType: "paste" | "writing_project";
  title: string;
  successLabel: string;
};

type NovelSourcePersistenceResult =
  | "saved"
  | "confirmation_required"
  | "rejected";

function parseTargetSettingsKey(value: string): AdaptationTargetSettings | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<AdaptationTargetSettings>;
    return {
      aspectRhythm: String(parsed.aspectRhythm || ""),
      episodeDuration: String(parsed.episodeDuration || ""),
      targetEpisodeCount: Math.max(1, Number(parsed.targetEpisodeCount) || 1),
      visualStyle: String(parsed.visualStyle || ""),
    };
  } catch {
    return null;
  }
}

export function useDramaAiFirstController(
  dramaId: number,
  options: UseDramaAiFirstControllerOptions = {},
) {
  const router = useRouter();
  const { authenticated } = useAppSession();
  const onWorkspaceRefreshRef = useRef(options.onWorkspaceRefresh);
  const hasExplicitTargetSettingsRef = useRef(false);

  const [drama, setDrama] = useState<Drama | null>(null);
  const [aiFirstPayload, setAiFirstPayload] =
    useState<DramaAiFirstPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceTitleDraft, setSourceTitleDraft] = useState("");
  const [sourceContentDraft, setSourceContentDraft] = useState("");
  const [sourceSaving, setSourceSaving] = useState(false);
  const [pendingSourceReplacement, setPendingSourceReplacement] =
    useState<NovelSourcePersistenceRequest | null>(null);
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [writingSources, setWritingSources] = useState<WritingListItem[]>([]);
  const [writingSourceLoading, setWritingSourceLoading] = useState(false);
  const [writingSourceQuery, setWritingSourceQuery] = useState("");
  const [selectedWritingSourceId, setSelectedWritingSourceId] = useState<
    number | null
  >(null);
  const [writingSourceImportingId, setWritingSourceImportingId] = useState<
    number | null
  >(null);
  const [planGenerating, setPlanGenerating] = useState(false);
  const [episodesGenerating, setEpisodesGenerating] = useState(false);
  const [pilotGenerating, setPilotGenerating] = useState(false);
  const [taskActionBusyId, setTaskActionBusyId] = useState<number | null>(null);
  const [blueprintRegeneratingEpisodeId, setBlueprintRegeneratingEpisodeId] =
    useState<number | null>(null);
  const [scriptGeneratingEpisodeId, setScriptGeneratingEpisodeId] = useState<
    number | null
  >(null);
  const [storyGraphSummary, setStoryGraphSummary] =
    useState<StoryGraphSummaryPayload | null>(null);
  const [storyGraphSummaryLoading, setStoryGraphSummaryLoading] =
    useState(true);
  const [planTargetEpisodes, setPlanTargetEpisodes] = useState(24);
  const [planEpisodeDuration, setPlanEpisodeDuration] = useState("60-90 秒");
  const [planVisualStyle, setPlanVisualStyle] = useState("");
  const [planAspectRhythm, setPlanAspectRhythm] = useState("16:9 · 高密度钩子");
  const [lastSavedTargetKey, setLastSavedTargetKey] = useState("");

  useEffect(() => {
    onWorkspaceRefreshRef.current = options.onWorkspaceRefresh;
  }, [options.onWorkspaceRefresh]);

  const readOnly = useMemo(
    () => Boolean(drama?.read_only) || !authenticated,
    [authenticated, drama?.read_only],
  );
  const episodes = useMemo(() => drama?.episodes || [], [drama?.episodes]);
  const novelSource = useMemo(() => getNovelSource(drama), [drama]);
  const adaptationPlan = useMemo(() => getAdaptationPlan(drama), [drama]);
  const aiFirstMetadata = useMemo(
    () => getDramaAiFirstMetadata(drama),
    [drama],
  );
  const adaptationConfig = aiFirstMetadata.adaptation_config;
  const aiFirstState = useMemo(() => getDramaAiFirstState(drama), [drama]);
  const novelSourceHealth = aiFirstState.sourceHealth;
  const sourceAnalysisTask = aiFirstPayload?.source_analysis_task ?? null;
  const sourceAnalysis =
    aiFirstPayload?.source_analysis || drama?.source_analysis || null;
  const sourceAnalysisReady = Boolean(sourceAnalysis);
  const sourceAnalysisTaskActive = isActiveTaskStatus(
    sourceAnalysisTask?.status,
  );
  const sourceAnalysisTaskFailed = isFailedTaskStatus(
    sourceAnalysisTask?.status,
  );
  const blueprintTask = aiFirstPayload?.blueprint_task ?? null;
  const blueprintTaskActive = isActiveTaskStatus(blueprintTask?.status);
  const blueprintTaskFailed = isFailedTaskStatus(blueprintTask?.status);
  const pilotScriptTask = aiFirstPayload?.pilot_script_task ?? null;
  const pilotScriptTaskActive = isActiveTaskStatus(pilotScriptTask?.status);
  const pilotScriptTaskFailed = isFailedTaskStatus(pilotScriptTask?.status);
  const storyGraphTask = aiFirstPayload?.story_graph_task ?? null;
  const storyGraphTaskActive = isActiveTaskStatus(storyGraphTask?.status);
  const storyGraphTaskFailed = isFailedTaskStatus(storyGraphTask?.status);
  const planBusy = planGenerating || sourceAnalysisTaskActive;
  const blueprintBusy = episodesGenerating || blueprintTaskActive;
  const pilotScriptBusy = pilotGenerating || pilotScriptTaskActive;

  const sourceChunkStats = useMemo(() => {
    const chunks = aiFirstPayload?.source_chunks || [];
    return {
      total: chunks.length,
      ready: chunks.filter((chunk) => chunk.status === "ready").length,
      running: chunks.filter((chunk) => chunk.status === "running").length,
      failed: chunks.filter((chunk) => chunk.status === "failed").length,
    };
  }, [aiFirstPayload?.source_chunks]);

  const hasPersistedSource = Boolean(novelSource || drama?.source_health);
  const hasSourceIssue = hasPersistedSource && !novelSourceHealth.ok;
  const hasUsableNovelSource = hasPersistedSource && novelSourceHealth.ok;
  const deferredSourceContentDraft = useDeferredValue(sourceContentDraft);
  const sourceDraftWordCount = useMemo(
    () => countNovelWords(deferredSourceContentDraft),
    [deferredSourceContentDraft],
  );
  const sourceDraftChapterCount = useMemo(
    () => buildChapterIndex(deferredSourceContentDraft).length || 0,
    [deferredSourceContentDraft],
  );
  const sourceDialogHealth = useMemo(() => {
    if (!deferredSourceContentDraft.trim()) return getNovelSourceHealth(null);
    return getNovelSourceHealth({
      type: "paste",
      title: sourceTitleDraft.trim() || drama?.title || "",
      content: deferredSourceContentDraft,
      word_count: 0,
      chapter_count: 0,
      imported_at: "",
    });
  }, [deferredSourceContentDraft, drama?.title, sourceTitleDraft]);
  const selectedWritingSource = useMemo(
    () =>
      writingSources.find((item) => item.id === selectedWritingSourceId) ??
      null,
    [selectedWritingSourceId, writingSources],
  );

  const targetSettings = useMemo<AdaptationTargetSettings>(
    () => ({
      aspectRhythm: planAspectRhythm.trim() || "16:9 · 高密度钩子",
      episodeDuration: planEpisodeDuration.trim() || "60-90 秒",
      targetEpisodeCount: Math.max(1, Number(planTargetEpisodes) || 1),
      visualStyle: planVisualStyle.trim(),
    }),
    [
      planAspectRhythm,
      planEpisodeDuration,
      planTargetEpisodes,
      planVisualStyle,
    ],
  );
  const plannedEpisodes = useMemo(
    () =>
      episodes
        .filter(
          (episode) =>
            episode.episode_number <= targetSettings.targetEpisodeCount,
        )
        .sort((left, right) => left.episode_number - right.episode_number),
    [episodes, targetSettings.targetEpisodeCount],
  );
  const blueprintEpisodes = useMemo(
    () =>
      plannedEpisodes.filter((episode) =>
        normalizeEpisodeBlueprintPayload(episode.blueprint_payload),
      ),
    [plannedEpisodes],
  );
  const scriptReadyEpisodes = useMemo(
    () => plannedEpisodes.filter((episode) => hasScript(episode)),
    [plannedEpisodes],
  );
  const currentScriptReadyEpisodes = useMemo(
    () =>
      blueprintEpisodes.filter(
        (episode) => hasScript(episode) && !getEpisodeStaleLabel(episode),
      ),
    [blueprintEpisodes],
  );
  const blueprintScriptReadyEpisodes = useMemo(
    () => blueprintEpisodes.filter((episode) => hasScript(episode)),
    [blueprintEpisodes],
  );
  const pilotPendingEpisodes = useMemo(
    () =>
      blueprintEpisodes.filter(
        (episode) =>
          (!hasScript(episode) || getEpisodeStaleLabel(episode)) &&
          !episode.failure_reason,
      ),
    [blueprintEpisodes],
  );
  const pilotFailedEpisodes = useMemo(
    () =>
      blueprintEpisodes.filter(
        (episode) =>
          (!hasScript(episode) || getEpisodeStaleLabel(episode)) &&
          episode.failure_reason,
      ),
    [blueprintEpisodes],
  );
  const firstScriptReadyEpisode =
    blueprintScriptReadyEpisodes[0] ?? scriptReadyEpisodes[0] ?? null;
  const firstPilotPendingEpisode = pilotPendingEpisodes[0] ?? null;
  const pilotGenerateLimit = Math.min(
    3,
    Math.max(1, pilotPendingEpisodes.length),
  );
  const storyGraphUsable = Boolean(
    storyGraphSummary?.graph?.status === "ready" && !storyGraphSummary.is_stale,
  );
  const storyGraphStale = Boolean(storyGraphSummary?.is_stale);
  const targetSettingsKey = useMemo(
    () => createTargetSettingsKey(targetSettings),
    [targetSettings],
  );
  const targetSettingsDirty = Boolean(
    novelSource &&
    lastSavedTargetKey &&
    lastSavedTargetKey !== targetSettingsKey,
  );
  const applyTargetSettings = useCallback((nextDrama: Drama) => {
    const plan = getAdaptationPlan(nextDrama);
    const config = getDramaAiFirstMetadata(nextDrama).adaptation_config;
    hasExplicitTargetSettingsRef.current = Boolean(
      config &&
        (config.target_episode_count ||
          config.episode_duration ||
          config.style_direction ||
          config.visual_style ||
          config.aspect_rhythm),
    );
    const sourceSuggestedEpisodeCount =
      nextDrama.source_analysis?.target_episode_count;
    const targetEpisodeCount =
      config?.target_episode_count ||
      plan?.target_episode_count ||
      sourceSuggestedEpisodeCount ||
      nextDrama.total_episodes ||
      24;
    const episodeDuration =
      config?.episode_duration ||
      plan?.episode_duration ||
      nextDrama.source_analysis?.episode_duration ||
      "60-90 秒";
    const visualStyle =
      config?.visual_style ||
      config?.style_direction ||
      plan?.visual_style ||
      nextDrama.style ||
      "";
    const aspectRhythm =
      config?.aspect_rhythm || plan?.aspect_rhythm || "16:9 · 高密度钩子";
    setPlanTargetEpisodes(targetEpisodeCount);
    setPlanEpisodeDuration(episodeDuration);
    setPlanVisualStyle(visualStyle);
    setPlanAspectRhythm(aspectRhythm);
    setLastSavedTargetKey(
      createTargetSettingsKey({
        aspectRhythm,
        episodeDuration,
        targetEpisodeCount,
        visualStyle,
      }),
    );
  }, []);

  const applySourceDraft = useCallback((nextDrama: Drama) => {
    const source = getNovelSource(nextDrama);
    setSourceTitleDraft(source?.title || nextDrama.title || "");
    setSourceContentDraft(source?.content || "");
  }, []);

  const applyAiFirstPayload = useCallback((payload: DramaAiFirstPayload) => {
    setAiFirstPayload(payload);
    if (!hasExplicitTargetSettingsRef.current && payload.source_analysis) {
      const targetEpisodeCount =
        payload.source_analysis.target_episode_count ||
        targetSettings.targetEpisodeCount;
      if (targetEpisodeCount) {
        setPlanTargetEpisodes(targetEpisodeCount);
      }
      const episodeDuration =
        payload.source_analysis.episode_duration ||
        targetSettings.episodeDuration;
      if (episodeDuration) {
        setPlanEpisodeDuration(episodeDuration);
      }
      setLastSavedTargetKey(
        createTargetSettingsKey({
          ...targetSettings,
          episodeDuration,
          targetEpisodeCount,
        }),
      );
    }
    setDrama((current) =>
      current
        ? {
            ...current,
            source_health: payload.source_health,
            source_analysis: payload.source_analysis,
            adaptation_briefs: payload.adaptation_briefs,
            selected_brief_id: payload.selected_brief_id,
            ai_first_stage: payload.ai_first_stage,
          }
        : current,
    );
  }, [targetSettings]);

  const refreshWorkspace = useCallback(async () => {
    await onWorkspaceRefreshRef.current?.();
  }, []);

  const refreshStoryGraphSummary = useCallback(async () => {
    setStoryGraphSummaryLoading(true);
    if (!Number.isFinite(dramaId) || dramaId <= 0) {
      setStoryGraphSummary(null);
      setStoryGraphSummaryLoading(false);
      return null;
    }

    try {
      const summary = await dramaAPI.getStoryGraph(dramaId, {
        bypassCache: true,
      });
      setStoryGraphSummary(summary);
      return summary;
    } catch {
      setStoryGraphSummary(null);
      return null;
    } finally {
      setStoryGraphSummaryLoading(false);
    }
  }, [dramaId]);

  const load = useCallback(async () => {
    if (!Number.isFinite(dramaId) || dramaId <= 0) {
      setError("invalid_drama_id");
      setLoading(false);
      return null;
    }

    try {
      setLoading(true);
      setError(null);
      const nextDrama = await dramaAPI.get(dramaId, {
        redirectOnUnauthorized: false,
      });
      setDrama(nextDrama);
      applyTargetSettings(nextDrama);
      applySourceDraft(nextDrama);
      if (authenticated && !nextDrama.read_only) {
        try {
          const payload = await dramaAPI.getAiFirst(dramaId, {
            bypassCache: true,
          });
          applyAiFirstPayload(payload);
        } catch {
          setAiFirstPayload(null);
        }
      } else {
        setAiFirstPayload(null);
      }
      await refreshStoryGraphSummary();
      await refreshWorkspace();
      return nextDrama;
    } catch (err) {
      const message = getAiErrorCopy(err);
      setError(message);
      toast.error("加载剧集向导失败", { description: message });
      return null;
    } finally {
      setLoading(false);
    }
  }, [
    applyAiFirstPayload,
    applySourceDraft,
    applyTargetSettings,
    authenticated,
    dramaId,
    refreshStoryGraphSummary,
    refreshWorkspace,
  ]);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!Number.isFinite(dramaId) || dramaId <= 0) {
        if (!cancelled) {
          setError("invalid_drama_id");
          setLoading(false);
        }
        return;
      }

      try {
        if (!cancelled) {
          setLoading(true);
          setError(null);
        }
        const nextDrama = await dramaAPI.get(dramaId, {
          redirectOnUnauthorized: false,
        });
        if (cancelled) return;
        setDrama(nextDrama);
        applyTargetSettings(nextDrama);
        applySourceDraft(nextDrama);
        if (authenticated && !nextDrama.read_only) {
          try {
            const payload = await dramaAPI.getAiFirst(dramaId, {
              bypassCache: true,
            });
            if (!cancelled) applyAiFirstPayload(payload);
          } catch {
            if (!cancelled) setAiFirstPayload(null);
          }
        } else {
          setAiFirstPayload(null);
        }
        await refreshStoryGraphSummary();
      } catch (err) {
        if (!cancelled) {
          const message = getAiErrorCopy(err);
          setError(message);
          toast.error("加载剧集向导失败", { description: message });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [
    applyAiFirstPayload,
    applySourceDraft,
    applyTargetSettings,
    authenticated,
    dramaId,
    refreshStoryGraphSummary,
  ]);

  useEffect(() => {
    if (!drama?.id || readOnly || !sourceAnalysisTaskActive) return;

    let cancelled = false;
    const currentDramaId = drama.id;
    const poll = async () => {
      try {
        const payload = await dramaAPI.getAiFirst(currentDramaId, {
          bypassCache: true,
        });
        if (cancelled) return;
        applyAiFirstPayload(payload);
      } catch {
        // Keep polling transient failures.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyAiFirstPayload, drama?.id, readOnly, sourceAnalysisTaskActive]);

  useEffect(() => {
    if (!drama?.id || readOnly || !blueprintTaskActive) return;

    let cancelled = false;
    let handledTerminal = false;
    const currentDramaId = drama.id;
    const poll = async () => {
      try {
        const payload = await dramaAPI.getAiFirst(currentDramaId, {
          bypassCache: true,
        });
        if (cancelled) return;
        applyAiFirstPayload(payload);
        const task = payload.blueprint_task;
        if (!task || handledTerminal) return;

        if (isFailedTaskStatus(task.status)) {
          handledTerminal = true;
          setEpisodesGenerating(false);
          toast.error("分集蓝图任务失败", {
            description: getAiErrorCopy(
              task.error_message,
              "请检查大模型服务配置后重试",
            ),
          });
          return;
        }

        if (task.status === "completed") {
          handledTerminal = true;
          setEpisodesGenerating(false);
          await load();
          toast.success("分集蓝图已生成");
        }
      } catch {
        // Keep polling transient failures.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyAiFirstPayload, blueprintTaskActive, drama?.id, load, readOnly]);

  useEffect(() => {
    if (!drama?.id || readOnly || !pilotScriptTaskActive) return;

    let cancelled = false;
    let handledTerminal = false;
    const currentDramaId = drama.id;
    const poll = async () => {
      try {
        const payload = await dramaAPI.getAiFirst(currentDramaId, {
          bypassCache: true,
        });
        if (cancelled) return;
        applyAiFirstPayload(payload);
        const task = payload.pilot_script_task;
        if (!task || handledTerminal) return;

        if (isFailedTaskStatus(task.status)) {
          handledTerminal = true;
          setPilotGenerating(false);
          toast.error("剧本正文任务失败", {
            description: getAiErrorCopy(
              task.error_message,
              "请检查大模型服务配置后重试",
            ),
          });
          return;
        }

        if (task.status === "completed") {
          handledTerminal = true;
          setPilotGenerating(false);
          await load();
          toast.success("剧本正文已生成");
        }
      } catch {
        // Keep polling transient failures.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      void poll();
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [applyAiFirstPayload, drama?.id, load, pilotScriptTaskActive, readOnly]);

  function discardTargetSettingsDraft() {
    if (!drama) return;
    applyTargetSettings(drama);
  }

  function proceedWithExistingBlueprints() {
    if (!drama || readOnly) return;
    discardTargetSettingsDraft();
    router.push(getProjectStageHref(drama.id, "script"));
  }

  async function refreshAfterTaskAction() {
    if (!drama?.id) return;
    const payload = await dramaAPI.getAiFirst(drama.id, { bypassCache: true });
    applyAiFirstPayload(payload);
    await load();
  }

  async function retryAiFirstTask(taskId: number, label: TaskLabel) {
    if (!drama?.id || readOnly) return;
    try {
      setTaskActionBusyId(taskId);
      await taskAPI.retry(taskId);
      await refreshAfterTaskAction();
      toast.success(`${label}已重新排队`);
    } catch (err) {
      toast.error(`${label}重试失败`, { description: getAiErrorCopy(err) });
    } finally {
      setTaskActionBusyId(null);
    }
  }

  async function cancelAiFirstTask(taskId: number, label: TaskLabel) {
    if (!drama?.id || readOnly) return;
    try {
      setTaskActionBusyId(taskId);
      await taskAPI.cancel(taskId);
      if (label === "剧本正文任务") {
        setPilotGenerating(false);
      }
      if (label === "源稿理解任务") {
        setPlanGenerating(false);
      }
      if (label === "分集蓝图任务") {
        setEpisodesGenerating(false);
      }
      await refreshAfterTaskAction();
      toast.success(`${label}已取消`);
    } catch (err) {
      toast.error(`${label}取消失败`, { description: getAiErrorCopy(err) });
    } finally {
      setTaskActionBusyId(null);
    }
  }

  async function startSourceAnalysis() {
    if (!drama?.id || readOnly) return;
    if (!hasPersistedSource) {
      toast.warning("请先导入小说源稿");
      return;
    }
    if (!novelSourceHealth.ok) {
      toast.warning(novelSourceHealth.message);
      return;
    }

    try {
      setPlanGenerating(true);
      const analysisPayload = await dramaAPI.analyzeSource(drama.id);
      applyAiFirstPayload(analysisPayload);
      if (
        analysisPayload.source_analysis_task &&
        isActiveTaskStatus(analysisPayload.source_analysis_task.status)
      ) {
        toast.success("源稿理解任务已启动");
        return;
      }
      toast.success("源稿理解已完成，可以开始分集规划");
    } catch (err) {
      toast.error("源稿理解失败", { description: getAiErrorCopy(err) });
    } finally {
      setPlanGenerating(false);
    }
  }

  async function persistNovelSource({
    content,
    sourceType,
    title,
    successLabel,
  }: NovelSourcePersistenceRequest) {
    if (!drama || readOnly) return false;
    try {
      const source = {
        type: sourceType,
        title: title.trim() || drama.title,
        content,
        word_count: countNovelWords(content),
        chapter_count: buildChapterIndex(content).length,
        imported_at: new Date().toISOString(),
      };
      const sourceHealth = getNovelSourceHealth(source);
      if (!sourceHealth.ok) {
        toast.warning(sourceHealth.message);
        return false;
      }
      const currentDramaId = drama.id;
      const payload = await dramaAPI.saveSource(currentDramaId, {
        title: source.title,
        content: source.content,
        source_type: sourceType,
      });
      applyAiFirstPayload(payload);
      await load();
      setSourcePickerOpen(false);
      setSelectedWritingSourceId(null);
      toast.success(successLabel);
      return true;
    } catch (err) {
      toast.error("保存小说源稿失败", { description: getAiErrorCopy(err) });
      return false;
    }
  }

  async function requestNovelSourcePersistence(
    request: NovelSourcePersistenceRequest,
  ): Promise<NovelSourcePersistenceResult> {
    if (!drama || readOnly) return "rejected";
    const content = request.content.trim();
    const title = request.title.trim() || drama.title;
    const sourceHealth = getNovelSourceHealth({
      type: request.sourceType,
      title,
      content,
      word_count: countNovelWords(content),
      chapter_count: buildChapterIndex(content).length,
      imported_at: "",
    });
    if (!sourceHealth.ok) {
      toast.warning(sourceHealth.message);
      return "rejected";
    }

    const sourceChanged = Boolean(
      novelSource && novelSource.content.trim() !== content,
    );
    if (sourceChanged) {
      setPendingSourceReplacement({
        ...request,
        content,
        title,
      });
      return "confirmation_required";
    }

    const saved = await persistNovelSource({
      ...request,
      content,
      title,
    });
    return saved ? "saved" : "rejected";
  }

  async function saveNovelSource() {
    const content = sourceContentDraft.trim();
    if (!content) {
      toast.warning("请先粘贴小说源稿");
      return false;
    }

    try {
      setSourceSaving(true);
      const result = await requestNovelSourcePersistence({
        content,
        sourceType: "paste",
        title: sourceTitleDraft,
        successLabel: "源稿已保存",
      });
      return result === "saved";
    } finally {
      setSourceSaving(false);
    }
  }

  async function confirmSourceReplacement() {
    const request = pendingSourceReplacement;
    if (!request) return false;

    try {
      setSourceSaving(true);
      return await persistNovelSource(request);
    } finally {
      setSourceSaving(false);
      setPendingSourceReplacement(null);
    }
  }

  function cancelSourceReplacement() {
    const shouldReturnToPicker =
      pendingSourceReplacement?.sourceType === "writing_project";
    setPendingSourceReplacement(null);
    if (shouldReturnToPicker) setSourcePickerOpen(true);
  }

  const loadWritingSources = useCallback(
    async (query = writingSourceQuery) => {
      try {
        setWritingSourceLoading(true);
        const result = await writingAPI.list({
          page: 1,
          page_size: 30,
          kind: "novel",
          sort: "updated_at",
          q: query.trim() || undefined,
        });
        const items = Array.isArray(result.items) ? result.items : [];
        setWritingSources(items);
        setSelectedWritingSourceId((current) =>
          current != null && items.some((item) => item.id === current)
            ? current
            : null,
        );
      } catch (err) {
        toast.error("加载小说作品失败", { description: getAiErrorCopy(err) });
      } finally {
        setWritingSourceLoading(false);
      }
    },
    [writingSourceQuery],
  );

  function openWritingSourcePicker() {
    if (readOnly) return;
    setWritingSourceQuery("");
    setSelectedWritingSourceId(null);
    setSourcePickerOpen(true);
    void loadWritingSources("");
  }

  function closeWritingSourcePicker() {
    setSourcePickerOpen(false);
    setSelectedWritingSourceId(null);
  }

  function suspendWritingSourcePickerForReplacement() {
    setSourcePickerOpen(false);
  }

  async function importSelectedWritingSource(): Promise<NovelSourcePersistenceResult> {
    if (!selectedWritingSource || !drama || readOnly) {
      toast.warning("请先选择一部小说作品");
      return "rejected";
    }

    try {
      setWritingSourceImportingId(selectedWritingSource.id);
      const { blob } = await writingAPI.exportMarkdown(
        selectedWritingSource.id,
      );
      const content = (await blob.text()).trim();
      if (!content) {
        toast.warning("这个小说作品还没有可导入正文");
        return "rejected";
      }

      return requestNovelSourcePersistence({
        content,
        sourceType: "writing_project",
        title: selectedWritingSource.title,
        successLabel: "小说已导入",
      });
    } catch (err) {
      toast.error("导入小说源稿失败", { description: getAiErrorCopy(err) });
      return "rejected";
    } finally {
      setWritingSourceImportingId(null);
    }
  }

  function openScriptPlanning() {
    if (!drama || readOnly) return;
    if (!sourceAnalysisReady) {
      toast.warning("请先完成源稿理解");
      return;
    }
    router.push(getProjectStageHref(drama.id, "plan"));
  }

  async function createEpisodesFromPlan(
    options: { replaceWithoutScript?: boolean } = {},
  ) {
    if (!drama || readOnly) return;
    if (!novelSourceHealth.ok) {
      toast.warning(novelSourceHealth.message);
      return;
    }

    let asyncTaskStarted = false;
    try {
      setEpisodesGenerating(true);
      const savedTargetSettings = parseTargetSettingsKey(lastSavedTargetKey);
      const explicitAdaptationConfig: {
        target_episode_count?: number;
        episode_duration?: string;
        style_direction?: string;
        visual_style?: string;
        aspect_rhythm?: string;
      } = {};
      if (targetSettingsDirty && savedTargetSettings) {
        if (
          savedTargetSettings.targetEpisodeCount !==
          targetSettings.targetEpisodeCount
        ) {
          explicitAdaptationConfig.target_episode_count =
            targetSettings.targetEpisodeCount;
        }
        if (
          savedTargetSettings.episodeDuration !== targetSettings.episodeDuration
        ) {
          explicitAdaptationConfig.episode_duration =
            targetSettings.episodeDuration;
        }
        if (savedTargetSettings.visualStyle !== targetSettings.visualStyle) {
          explicitAdaptationConfig.style_direction =
            targetSettings.visualStyle || "精品短剧";
          explicitAdaptationConfig.visual_style =
            targetSettings.visualStyle || undefined;
        }
        if (savedTargetSettings.aspectRhythm !== targetSettings.aspectRhythm) {
          explicitAdaptationConfig.aspect_rhythm = targetSettings.aspectRhythm;
        }
      } else if (adaptationConfig) {
        if (adaptationConfig.target_episode_count > 0) {
          explicitAdaptationConfig.target_episode_count =
            adaptationConfig.target_episode_count;
        }
        if (adaptationConfig.episode_duration) {
          explicitAdaptationConfig.episode_duration =
            adaptationConfig.episode_duration;
        }
        if (adaptationConfig.style_direction || adaptationConfig.visual_style) {
          explicitAdaptationConfig.style_direction =
            adaptationConfig.style_direction ||
            adaptationConfig.visual_style ||
            "精品短剧";
          explicitAdaptationConfig.visual_style =
            adaptationConfig.visual_style || undefined;
        }
        if (adaptationConfig.aspect_rhythm) {
          explicitAdaptationConfig.aspect_rhythm =
            adaptationConfig.aspect_rhythm;
        }
      }
      const hasExplicitAdaptationConfig =
        Object.keys(explicitAdaptationConfig).length > 0;
      const payload = await dramaAPI.generateEpisodeBlueprints(drama.id, {
        replace_without_script: options.replaceWithoutScript,
        adaptation_config: hasExplicitAdaptationConfig
          ? explicitAdaptationConfig
          : undefined,
      });
      if (hasExplicitAdaptationConfig) {
        hasExplicitTargetSettingsRef.current = true;
        setLastSavedTargetKey(targetSettingsKey);
      }
      applyAiFirstPayload(payload);
      const task = payload.blueprint_task;
      if (task && isActiveTaskStatus(task.status)) {
        asyncTaskStarted = true;
        toast.success("分集蓝图任务已启动");
        return;
      }
      await load();
      toast.success("分集蓝图已生成");
    } catch (err) {
      toast.error("生成分集蓝图失败", { description: getAiErrorCopy(err) });
    } finally {
      if (!asyncTaskStarted) setEpisodesGenerating(false);
    }
  }

  async function regenerateEpisodeBlueprint(episode: Episode) {
    if (!drama || readOnly) return;
    try {
      setBlueprintRegeneratingEpisodeId(episode.id);
      await episodeAPI.regenerateBlueprint(episode.id);
      await load();
      toast.success(
        hasScript(episode)
          ? "本集蓝图已更新，原正文已标记需重写"
          : "本集蓝图已更新",
      );
    } catch (err) {
      toast.error("更新本集蓝图失败", { description: getAiErrorCopy(err) });
    } finally {
      setBlueprintRegeneratingEpisodeId(null);
    }
  }

  async function generateEpisodeScript(episode: Episode, rewrite = false) {
    if (!drama || readOnly) return;
    if (!normalizeEpisodeBlueprintPayload(episode.blueprint_payload)) {
      toast.warning("请先生成本集蓝图");
      return;
    }
    try {
      setScriptGeneratingEpisodeId(episode.id);
      if (rewrite) {
        await episodeAPI.rewriteScript(episode.id);
      } else {
        await episodeAPI.generateScript(episode.id);
      }
      await load();
      toast.success(rewrite ? "本集正文已重写" : "本集正文已生成");
    } catch (err) {
      toast.error(rewrite ? "重写本集正文失败" : "生成本集正文失败", {
        description: getAiErrorCopy(err),
      });
    } finally {
      setScriptGeneratingEpisodeId(null);
    }
  }

  async function generatePilotScripts(
    options: { episodeIds?: number[]; limit?: number } = {},
  ) {
    if (!drama || readOnly) return;
    if (blueprintEpisodes.length === 0) {
      toast.warning("请先生成分集蓝图");
      return;
    }

    if (pilotPendingEpisodes.length === 0) {
      toast.info("剧本正文已生成，可继续审阅或构建故事地图");
      return;
    }

    const selectedEpisodeIds = options.episodeIds?.length
      ? options.episodeIds
      : pilotPendingEpisodes
          .slice(0, options.limit || pilotGenerateLimit)
          .map((episode) => episode.id);
    const generationLimit = Math.max(
      1,
      options.limit || selectedEpisodeIds.length || pilotGenerateLimit,
    );
    let asyncTaskStarted = false;
    try {
      setPilotGenerating(true);
      const payload = await dramaAPI.generatePilotScripts(drama.id, {
        limit: generationLimit,
        episode_ids: selectedEpisodeIds,
      });
      applyAiFirstPayload(payload);
      const task = payload.pilot_script_task;
      if (task && isActiveTaskStatus(task.status)) {
        asyncTaskStarted = true;
        toast.success("剧本正文任务已启动");
        return;
      }
      await load();
      toast.success(`已生成 ${generationLimit} 集剧本正文`);
    } catch (err) {
      toast.error("生成剧本正文失败", { description: getAiErrorCopy(err) });
    } finally {
      if (!asyncTaskStarted) setPilotGenerating(false);
    }
  }

  return {
    adaptationPlan,
    adaptationConfig,
    aiFirstPayload,
    aiFirstState,
    blueprintBusy,
    blueprintEpisodes,
    blueprintRegeneratingEpisodeId,
    blueprintTask,
    blueprintTaskActive,
    blueprintTaskFailed,
    blueprintTaskProgress: formatTaskProgress(blueprintTask?.progress),
    createEpisodesFromPlan,
    currentScriptReadyEpisodes,
    drama,
    episodes,
    error,
    firstPilotPendingEpisode,
    firstScriptReadyEpisode,
    formatBlueprintDetail,
    formatBlueprintPhase,
    formatPilotScriptDetail,
    formatPilotScriptPhase,
    formatRuntimeTaskDetail,
    formatSourceAnalysisPhase,
    generateEpisodeScript,
    generatePilotScripts,
    hasPersistedSource,
    hasSourceIssue,
    hasUsableNovelSource,
    load,
    loading,
    novelSource,
    novelSourceHealth,
    pilotFailedEpisodes,
    pilotGenerateLimit,
    pilotPendingEpisodes,
    pilotScriptBusy,
    pilotScriptTask,
    pilotScriptTaskActive,
    pilotScriptTaskFailed,
    pilotScriptTaskProgress: formatTaskProgress(pilotScriptTask?.progress),
    plannedEpisodes,
    storyGraphTask,
    storyGraphTaskActive,
    storyGraphTaskFailed,
    storyGraphTaskProgress: formatTaskProgress(storyGraphTask?.progress),
    storyGraphSummary,
    storyGraphSummaryLoading,
    storyGraphStale,
    storyGraphUsable,
    planAspectRhythm,
    planBusy,
    planEpisodeDuration,
    planGenerating,
    planTargetEpisodes,
    planVisualStyle,
    readOnly,
    regenerateEpisodeBlueprint,
    retryAiFirstTask,
    cancelAiFirstTask,
    discardTargetSettingsDraft,
    proceedWithExistingBlueprints,
    saveNovelSource,
    scriptGeneratingEpisodeId,
    scriptReadyEpisodes,
    setPlanAspectRhythm,
    setPlanEpisodeDuration,
    setPlanTargetEpisodes,
    setPlanVisualStyle,
    setSourceContentDraft,
    setSourceTitleDraft,
    sourceAnalysisTask,
    sourceAnalysis,
    sourceAnalysisReady,
    sourceAnalysisTaskActive,
    sourceAnalysisTaskFailed,
    sourceAnalysisTaskProgress: formatTaskProgress(
      sourceAnalysisTask?.progress,
    ),
    sourceChunkStats,
    sourceContentDraft,
    sourceDialogHealth,
    sourceDraftChapterCount,
    sourceDraftWordCount,
    sourcePickerOpen,
    sourceSaving,
    sourceReplacementConfirmationOpen: pendingSourceReplacement !== null,
    sourceTitleDraft,
    startSourceAnalysis,
    openScriptPlanning,
    selectedWritingSource,
    selectedWritingSourceId,
    taskActionBusyId,
    targetSettingsDirty,
    writingSourceImportingId,
    writingSourceLoading,
    writingSourceQuery,
    writingSources,
    closeWritingSourcePicker,
    suspendWritingSourcePickerForReplacement,
    cancelSourceReplacement,
    confirmSourceReplacement,
    importSelectedWritingSource,
    loadWritingSources,
    openWritingSourcePicker,
    setSelectedWritingSourceId,
    setWritingSourceQuery,
  };
}

export type DramaAiFirstController = ReturnType<
  typeof useDramaAiFirstController
>;
