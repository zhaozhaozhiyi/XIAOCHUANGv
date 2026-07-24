"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Image from "next/image";
import { toast } from "sonner";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  FileUp,
  LayoutGrid,
  Loader2,
  LogIn,
  Mic2,
  Mountain,
  Play,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  UserRound,
  Video,
  Wand2,
  X,
} from "lucide-react";
import {
  aiConfigAPI,
  dramaAPI,
  episodeAPI,
  imageAPI,
  taskAPI,
  writingAPI,
  type DramaAiFirstPayload,
} from "@/lib/api";
import { getAiErrorCopy } from "@/lib/ai-error-copy";
import { dramaStyleLabel, dramaStyleSelectOptions } from "@/lib/drama-style";
import {
  buildDramaMetadataWithProjectDefaults,
  getAdaptationPlan,
  getNovelSource,
  getProjectDefaults,
  normalizeEpisodeBlueprintPayload,
  type AdaptationPlan,
  type NovelSource,
  type NovelSourceChapter,
} from "@/lib/drama-metadata";
import {
  getDramaAspectRatioLabel,
  getDramaEpisodeCount,
  getDramaAiFirstState,
  getNovelSourceHealth,
} from "@/lib/drama-product-state";
import { redirectToLoginFromCurrentLocation } from "@/lib/login-redirect";
import { staticUrl } from "@/lib/utils";
import { useAppSession } from "@/components/shared/app-session-provider";
import { Button } from "@/components/ui/button";
import { LegacyDramaDialogs } from "./LegacyDramaDialogs";
import type {
  AIServiceConfig,
  Drama,
  Episode,
  ImageGeneration,
  WritingListItem,
} from "@/types/api";
import {
  AdaptationBriefCard,
  AdaptationTargetFields,
  CharacterBibleCard,
  CharacterBibleDialog,
  LegacyAdaptationPlanNotice,
  SceneBibleCard,
  buildChapterIndex,
  buildCoverPrompt,
  buildDraftAdaptationPlan,
  createTargetSettingsKey,
  countNovelWords,
  episodePreviewText,
  extractCharacterBibleFromSource,
  extractSceneBibleFromSource,
  formatBlueprintDetail,
  formatBlueprintPhase,
  formatBriefDetail,
  formatBriefPhase,
  formatCount,
  formatEpisodeDuration,
  formatPilotScriptDetail,
  formatPilotScriptPhase,
  formatSourceAnalysisPhase,
  formatTaskProgress,
  getEpisodeStaleLabel,
  hasScript,
  isActiveTaskStatus,
  isFailedTaskStatus,
  pickChapterRange,
  sleep,
  type AdaptationCharacter,
  type AdaptationTargetSettings,
} from "./ai-first-workbench-parts";

type LegacyDramaDetailPageProps = {
  embedded?: boolean;
};

export default function LegacyDramaDetailPage({
  embedded = false,
}: LegacyDramaDetailPageProps) {
  const router = useRouter();
  const params = useParams();
  const { authenticated } = useAppSession();
  const dramaId = Number(params.id);
  const redirectedForeignDramaRef = useRef(false);

  const [drama, setDrama] = useState<Drama | null>(null);
  const [aiFirstPayload, setAiFirstPayload] =
    useState<DramaAiFirstPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [addDialog, setAddDialog] = useState(false);
  const [splitDialog, setSplitDialog] = useState(false);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);
  const [previewVideoTitle, setPreviewVideoTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [projectDefaultsDialogOpen, setProjectDefaultsDialogOpen] =
    useState(false);
  const [coverGenerating, setCoverGenerating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [splitContent, setSplitContent] = useState("");
  const [activeTab, setActiveTab] = useState<
    "episodes" | "characters" | "scenes" | "source" | "plan"
  >("episodes");
  const [previewScriptEpisode, setPreviewScriptEpisode] =
    useState<Episode | null>(null);
  const [aiConfigs, setAiConfigs] = useState<AIServiceConfig[]>([]);
  const [defaultsSaving, setDefaultsSaving] = useState(false);
  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [sourceDialogMode, setSourceDialogMode] = useState<"edit" | "view">(
    "edit",
  );
  const [sourceTitleDraft, setSourceTitleDraft] = useState("");
  const [sourceContentDraft, setSourceContentDraft] = useState("");
  const [sourceSaving, setSourceSaving] = useState(false);
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
  const [blueprintRegeneratingEpisodeId, setBlueprintRegeneratingEpisodeId] =
    useState<number | null>(null);
  const [scriptGeneratingEpisodeId, setScriptGeneratingEpisodeId] = useState<
    number | null
  >(null);
  const [pilotGenerating, setPilotGenerating] = useState(false);
  const [briefSelectingId, setBriefSelectingId] = useState<string | null>(null);
  const [taskActionBusyId, setTaskActionBusyId] = useState<number | null>(null);
  const [targetSaving, setTargetSaving] = useState(false);
  const targetAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const lastSavedTargetKeyRef = useRef("");
  const [planTargetEpisodes, setPlanTargetEpisodes] = useState(24);
  const [planEpisodeDuration, setPlanEpisodeDuration] = useState("60-90 秒");
  const [planVisualStyle, setPlanVisualStyle] = useState("");
  const [planAspectRhythm, setPlanAspectRhythm] = useState("16:9 · 高密度钩子");
  const [pickerTargetEpisodes, setPickerTargetEpisodes] = useState(24);
  const [pickerEpisodeDuration, setPickerEpisodeDuration] =
    useState("60-90 秒");
  const [pickerVisualStyle, setPickerVisualStyle] = useState("");
  const [pickerAspectRhythm, setPickerAspectRhythm] =
    useState("16:9 · 高密度钩子");
  const [selectedPlanCharacter, setSelectedPlanCharacter] =
    useState<AdaptationCharacter | null>(null);
  const [projectDefaults, setProjectDefaults] = useState({
    image_config_id: "",
    video_config_id: "",
    audio_config_id: "",
  });
  const briefGenerationAfterAnalysisRef = useRef(false);
  const pilotNavigateTargetRef = useRef<number | null>(null);

  const episodes = useMemo(() => drama?.episodes || [], [drama?.episodes]);
  const imageConfigOptions = useMemo(
    () => [
      { label: "跟随系统默认", value: "" },
      ...aiConfigs
        .filter((item) => item.service_type === "image")
        .map((item) => ({ label: item.name, value: String(item.id) })),
    ],
    [aiConfigs],
  );
  const videoConfigOptions = useMemo(
    () => [
      { label: "跟随系统默认", value: "" },
      ...aiConfigs
        .filter((item) => item.service_type === "video")
        .map((item) => ({ label: item.name, value: String(item.id) })),
    ],
    [aiConfigs],
  );
  const audioConfigOptions = useMemo(
    () => [
      { label: "跟随系统默认", value: "" },
      ...aiConfigs
        .filter((item) => item.service_type === "audio")
        .map((item) => ({ label: item.name, value: String(item.id) })),
    ],
    [aiConfigs],
  );
  const hasActiveImageConfig = useMemo(
    () =>
      aiConfigs.some(
        (item) => item.service_type === "image" && Number(item.is_active) === 1,
      ),
    [aiConfigs],
  );
  const missingConfigHints = useMemo(
    () =>
      [
        aiConfigs.some(
          (item) =>
            item.service_type === "image" && Number(item.is_active) === 1,
        )
          ? null
          : "图片模型",
        aiConfigs.some(
          (item) =>
            item.service_type === "video" && Number(item.is_active) === 1,
        )
          ? null
          : "视频模型",
        aiConfigs.some(
          (item) =>
            item.service_type === "audio" && Number(item.is_active) === 1,
        )
          ? null
          : "配音模型",
      ].filter(Boolean) as string[],
    [aiConfigs],
  );
  const readOnly = useMemo(
    () => Boolean(drama?.read_only) || !authenticated,
    [authenticated, drama?.read_only],
  );
  const novelSource = useMemo(() => getNovelSource(drama), [drama]);
  const adaptationPlan = useMemo(() => getAdaptationPlan(drama), [drama]);
  const adaptationBriefs = useMemo(
    () => drama?.adaptation_briefs || [],
    [drama?.adaptation_briefs],
  );
  const selectedBriefId = drama?.selected_brief_id || "";
  const aiFirstState = useMemo(() => getDramaAiFirstState(drama), [drama]);
  const novelSourceHealth = aiFirstState.sourceHealth;
  const sourceAnalysisTask = aiFirstPayload?.source_analysis_task ?? null;
  const sourceAnalysisTaskActive = isActiveTaskStatus(
    sourceAnalysisTask?.status,
  );
  const sourceAnalysisTaskFailed = isFailedTaskStatus(
    sourceAnalysisTask?.status,
  );
  const sourceAnalysisTaskProgress = formatTaskProgress(
    sourceAnalysisTask?.progress,
  );
  const briefTask = aiFirstPayload?.brief_task ?? null;
  const briefTaskActive = isActiveTaskStatus(briefTask?.status);
  const briefTaskFailed = isFailedTaskStatus(briefTask?.status);
  const briefTaskProgress = formatTaskProgress(briefTask?.progress);
  const blueprintTask = aiFirstPayload?.blueprint_task ?? null;
  const blueprintTaskActive = isActiveTaskStatus(blueprintTask?.status);
  const blueprintTaskFailed = isFailedTaskStatus(blueprintTask?.status);
  const blueprintTaskProgress = formatTaskProgress(blueprintTask?.progress);
  const pilotScriptTask = aiFirstPayload?.pilot_script_task ?? null;
  const pilotScriptTaskActive = isActiveTaskStatus(pilotScriptTask?.status);
  const pilotScriptTaskFailed = isFailedTaskStatus(pilotScriptTask?.status);
  const pilotScriptTaskProgress = formatTaskProgress(pilotScriptTask?.progress);
  const planBusy =
    planGenerating || sourceAnalysisTaskActive || briefTaskActive;
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
  const displayEpisodeCount = useMemo(
    () => getDramaEpisodeCount(drama),
    [drama],
  );
  const displayAspectRatio = useMemo(
    () => getDramaAspectRatioLabel(drama),
    [drama],
  );
  const sourceDialogHealth = useMemo(() => {
    if (!sourceContentDraft.trim()) return getNovelSourceHealth(null);
    return getNovelSourceHealth({
      type: "paste",
      title: sourceTitleDraft.trim() || drama?.title || "",
      content: sourceContentDraft,
      word_count: 0,
      chapter_count: 0,
      imported_at: "",
    });
  }, [drama?.title, sourceContentDraft, sourceTitleDraft]);
  const sourceDraftWordCount = useMemo(
    () => countNovelWords(sourceContentDraft),
    [sourceContentDraft],
  );
  const sourceDraftChapterCount = useMemo(
    () => buildChapterIndex(sourceContentDraft).length || 0,
    [sourceContentDraft],
  );
  const sourceDialogHasBlockingIssue =
    Boolean(sourceContentDraft.trim()) &&
    sourceDialogHealth.kind !== "valid" &&
    sourceDialogHealth.kind !== "missing";
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
  const targetSettingsKey = useMemo(
    () => createTargetSettingsKey(targetSettings),
    [targetSettings],
  );
  const selectedWritingSource = useMemo(
    () =>
      writingSources.find((item) => item.id === selectedWritingSourceId) ??
      null,
    [selectedWritingSourceId, writingSources],
  );

  const openLoginNextHere = useCallback(() => {
    redirectToLoginFromCurrentLocation();
  }, []);
  const nextEpisode = useMemo(
    () =>
      episodes.find((episode) => !hasScript(episode)) ?? episodes[0] ?? null,
    [episodes],
  );
  const blueprintEpisodes = useMemo(
    () =>
      episodes.filter((episode) =>
        normalizeEpisodeBlueprintPayload(episode.blueprint_payload),
      ),
    [episodes],
  );
  const scriptReadyEpisodes = useMemo(
    () => episodes.filter((episode) => hasScript(episode)),
    [episodes],
  );
  const blueprintScriptReadyEpisodes = useMemo(
    () => blueprintEpisodes.filter((episode) => hasScript(episode)),
    [blueprintEpisodes],
  );
  const pilotPendingEpisodes = useMemo(
    () =>
      blueprintEpisodes.filter(
        (episode) => !hasScript(episode) && !episode.failure_reason,
      ),
    [blueprintEpisodes],
  );
  const pilotFailedEpisodes = useMemo(
    () =>
      blueprintEpisodes.filter(
        (episode) => !hasScript(episode) && episode.failure_reason,
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
  const coverBusy = coverGenerating;

  const applyTargetSettings = useCallback((nextDrama: Drama) => {
    const plan = getAdaptationPlan(nextDrama);
    const targetEpisodeCount =
      plan?.target_episode_count || nextDrama.total_episodes || 24;
    const episodeDuration = plan?.episode_duration || "60-90 秒";
    const visualStyle = plan?.visual_style || nextDrama.style || "";
    const aspectRhythm = plan?.aspect_rhythm || "16:9 · 高密度钩子";
    setPlanTargetEpisodes(targetEpisodeCount);
    setPlanEpisodeDuration(episodeDuration);
    setPlanVisualStyle(visualStyle);
    setPlanAspectRhythm(aspectRhythm);
    lastSavedTargetKeyRef.current = createTargetSettingsKey({
      aspectRhythm,
      episodeDuration,
      targetEpisodeCount,
      visualStyle,
    });
  }, []);

  const syncSourcePickerTargetSettings = useCallback(() => {
    setPickerTargetEpisodes(Math.max(1, Number(planTargetEpisodes) || 1));
    setPickerEpisodeDuration(planEpisodeDuration.trim() || "60-90 秒");
    setPickerVisualStyle(planVisualStyle.trim());
    setPickerAspectRhythm(planAspectRhythm.trim() || "16:9 · 高密度钩子");
  }, [
    planAspectRhythm,
    planEpisodeDuration,
    planTargetEpisodes,
    planVisualStyle,
  ]);

  const applySourcePickerTargetSettings = useCallback(() => {
    setPlanTargetEpisodes(Math.max(1, Number(pickerTargetEpisodes) || 1));
    setPlanEpisodeDuration(pickerEpisodeDuration.trim() || "60-90 秒");
    setPlanVisualStyle(pickerVisualStyle.trim());
    setPlanAspectRhythm(pickerAspectRhythm.trim() || "16:9 · 高密度钩子");
  }, [
    pickerAspectRhythm,
    pickerEpisodeDuration,
    pickerTargetEpisodes,
    pickerVisualStyle,
  ]);

  const applyAiFirstPayload = useCallback((payload: DramaAiFirstPayload) => {
    setAiFirstPayload(payload);
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
  }, []);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const d = (await dramaAPI.get(dramaId, {
        redirectOnUnauthorized: false,
      })) as unknown as Drama;
      setDrama(d);
      applyTargetSettings(d);
      const defaults = getProjectDefaults(d);
      setProjectDefaults({
        image_config_id: defaults.image_config_id
          ? String(defaults.image_config_id)
          : "",
        video_config_id: defaults.video_config_id
          ? String(defaults.video_config_id)
          : "",
        audio_config_id: defaults.audio_config_id
          ? String(defaults.audio_config_id)
          : "",
      });
      if (authenticated && !d.read_only) {
        void dramaAPI
          .getAiFirst(dramaId, { bypassCache: true })
          .then(applyAiFirstPayload)
          .catch(() => undefined);
      } else {
        setAiFirstPayload(null);
      }
    } catch (e: unknown) {
      toast.error("加载短剧项目失败", { description: getAiErrorCopy(e) });
    } finally {
      setLoading(false);
    }
  }, [applyAiFirstPayload, applyTargetSettings, authenticated, dramaId]);

  useEffect(() => {
    redirectedForeignDramaRef.current = false;
    let cancelled = false;
    async function init() {
      const authed = authenticated;
      try {
        if (!cancelled) setLoading(true);
        const [d, configRows] = await Promise.all([
          dramaAPI.get(dramaId, {
            redirectOnUnauthorized: false,
          }) as Promise<Drama>,
          aiConfigAPI.list(),
        ]);
        if (!cancelled && authed && d.read_only) {
          if (!redirectedForeignDramaRef.current) {
            redirectedForeignDramaRef.current = true;
            toast.info("这是其他用户的项目，无法在站内编辑，已为你返回首页");
          }
          router.replace("/");
        } else if (!cancelled) {
          setDrama(d);
          setAiConfigs(Array.isArray(configRows) ? configRows : []);
          applyTargetSettings(d);
          const defaults = getProjectDefaults(d);
          setProjectDefaults({
            image_config_id: defaults.image_config_id
              ? String(defaults.image_config_id)
              : "",
            video_config_id: defaults.video_config_id
              ? String(defaults.video_config_id)
              : "",
            audio_config_id: defaults.audio_config_id
              ? String(defaults.audio_config_id)
              : "",
          });
          if (authed && !d.read_only) {
            void dramaAPI
              .getAiFirst(dramaId, { bypassCache: true })
              .then((payload) => {
                if (!cancelled) applyAiFirstPayload(payload);
              })
              .catch(() => undefined);
          } else {
            setAiFirstPayload(null);
          }
        }
      } catch (e: unknown) {
        if (!cancelled)
          toast.error("加载短剧项目失败", { description: getAiErrorCopy(e) });
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
    applyTargetSettings,
    authenticated,
    dramaId,
    router,
  ]);

  useEffect(() => {
    if (!drama?.id || readOnly || !sourceAnalysisTaskActive) return;

    let cancelled = false;
    let generatingBriefs = false;
    const currentDramaId = drama.id;
    const currentDramaStyle = drama.style;
    const poll = async () => {
      try {
        const payload = await dramaAPI.getAiFirst(currentDramaId, {
          bypassCache: true,
        });
        if (cancelled) return;
        applyAiFirstPayload(payload);
        const task = payload.source_analysis_task;

        if (
          briefGenerationAfterAnalysisRef.current &&
          task &&
          isFailedTaskStatus(task.status)
        ) {
          briefGenerationAfterAnalysisRef.current = false;
          setPlanGenerating(false);
          toast.error("源稿理解任务失败", {
            description: getAiErrorCopy(
              task.error_message,
              "请检查大模型服务配置后重试",
            ),
          });
          return;
        }

        if (
          briefGenerationAfterAnalysisRef.current &&
          !generatingBriefs &&
          task?.status === "completed" &&
          payload.source_analysis
        ) {
          generatingBriefs = true;
          const briefPayload = await dramaAPI.generateAdaptationBriefs(
            currentDramaId,
            {
              count: 2,
              target_episode_count: planTargetEpisodes,
              episode_duration: planEpisodeDuration,
              style_direction: planVisualStyle || currentDramaStyle || null,
            },
          );
          if (cancelled) return;
          applyAiFirstPayload(briefPayload);
          if (
            briefPayload.brief_task &&
            isActiveTaskStatus(briefPayload.brief_task.status)
          ) {
            briefGenerationAfterAnalysisRef.current = false;
            toast.success("改编策略任务已启动");
            return;
          }
          await load();
          setActiveTab("plan");
          toast.success("改编策略已生成");
          briefGenerationAfterAnalysisRef.current = false;
          setPlanGenerating(false);
        }
      } catch (e: unknown) {
        if (briefGenerationAfterAnalysisRef.current) {
          toast.error("同步源稿理解进度失败", {
            description: getAiErrorCopy(e),
          });
        }
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
  }, [
    applyAiFirstPayload,
    drama?.id,
    drama?.style,
    load,
    planEpisodeDuration,
    planTargetEpisodes,
    planVisualStyle,
    readOnly,
    sourceAnalysisTaskActive,
  ]);

  useEffect(() => {
    if (!drama?.id || readOnly || !briefTaskActive) return;

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
        const task = payload.brief_task;
        if (!task || handledTerminal) return;

        if (isFailedTaskStatus(task.status)) {
          handledTerminal = true;
          setPlanGenerating(false);
          toast.error("改编策略任务失败", {
            description: getAiErrorCopy(
              task.error_message,
              "请检查大模型服务配置后重试",
            ),
          });
          return;
        }

        if (task.status === "completed") {
          handledTerminal = true;
          setPlanGenerating(false);
          await load();
          setActiveTab("plan");
          toast.success("改编策略已生成");
        }
      } catch {
        // Keep polling; transient network errors should not interrupt the visible task state.
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
  }, [applyAiFirstPayload, briefTaskActive, drama?.id, load, readOnly]);

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
          setActiveTab("episodes");
          toast.success("分集蓝图已生成");
        }
      } catch {
        // Keep polling; transient network errors should not interrupt the visible task state.
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
          pilotNavigateTargetRef.current = null;
          setPilotGenerating(false);
          toast.error("试播正文任务失败", {
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
          const targetEpisodeNumber =
            pilotNavigateTargetRef.current ||
            payload.episodes.find((episode) => episode.has_script)
              ?.episode_number ||
            null;
          pilotNavigateTargetRef.current = null;
          await load();
          toast.success("试播正文已生成");
          if (targetEpisodeNumber) {
            router.push(
              `/drama/${currentDramaId}/episode/${targetEpisodeNumber}`,
            );
          } else {
            setActiveTab("episodes");
          }
        }
      } catch {
        // Keep polling; transient network errors should not interrupt the visible task state.
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
  }, [
    applyAiFirstPayload,
    drama?.id,
    load,
    pilotScriptTaskActive,
    readOnly,
    router,
  ]);

  async function refreshAfterTaskAction() {
    if (!drama?.id) return;
    const payload = await dramaAPI.getAiFirst(drama.id, { bypassCache: true });
    applyAiFirstPayload(payload);
    await load();
  }

  async function retryAiFirstTask(taskId: number, label: string) {
    if (!drama?.id || readOnly) return;
    try {
      setTaskActionBusyId(taskId);
      await taskAPI.retry(taskId);
      await refreshAfterTaskAction();
      toast.success(`${label}已重新排队`);
    } catch (e: unknown) {
      toast.error(`${label}重试失败`, { description: getAiErrorCopy(e) });
    } finally {
      setTaskActionBusyId(null);
    }
  }

  async function cancelAiFirstTask(taskId: number, label: string) {
    if (!drama?.id || readOnly) return;
    try {
      setTaskActionBusyId(taskId);
      await taskAPI.cancel(taskId);
      if (label === "试播正文任务") {
        pilotNavigateTargetRef.current = null;
        setPilotGenerating(false);
      }
      if (label === "源稿理解任务") {
        briefGenerationAfterAnalysisRef.current = false;
        setPlanGenerating(false);
      }
      await refreshAfterTaskAction();
      toast.success(`${label}已取消`);
    } catch (e: unknown) {
      toast.error(`${label}取消失败`, { description: getAiErrorCopy(e) });
    } finally {
      setTaskActionBusyId(null);
    }
  }

  async function addEpisode() {
    try {
      setCreating(true);
      const created = (await episodeAPI.create({
        drama_id: dramaId,
        title: newTitle || undefined,
      })) as Episode;
      toast.success("已添加新集");
      setAddDialog(false);
      window.location.href = `/drama/${dramaId}/episode/${created.episode_number}`;
    } catch (e: unknown) {
      toast.error("添加分集失败", { description: getAiErrorCopy(e) });
    } finally {
      setCreating(false);
    }
  }

  async function splitEpisodes() {
    const content = splitContent.trim();
    const replaceExisting = !content && episodes.length === 1;
    if (!content && !replaceExisting) {
      toast.warning("请输入剧本内容");
      return;
    }
    try {
      setSplitting(true);
      const result = await dramaAPI.splitEpisodes(dramaId, {
        content: content || undefined,
        replace_existing: replaceExisting,
      });
      toast.success(`已自动创建 ${result.count} 集`);
      setSplitDialog(false);
      setSplitContent("");
      await load();
    } catch (e: unknown) {
      toast.error("拆分分集失败", { description: getAiErrorCopy(e) });
    } finally {
      setSplitting(false);
    }
  }

  async function generateCover() {
    if (!drama || coverBusy) return;
    if (!hasActiveImageConfig) {
      toast.warning("未找到可用图片模型配置", {
        description: "请先在设置中启用图片 AI 配置，或为项目选择默认图片模型。",
      });
      return;
    }
    try {
      setCoverGenerating(true);
      const record = (await imageAPI.generate({
        drama_id: drama.id,
        prompt: buildCoverPrompt(drama),
        size: "1920x1080",
        frame_type: "drama_cover",
      })) as ImageGeneration;
      const generationId = record.id;
      toast.success("已开始生成封面");
      for (let attempt = 0; attempt < 90; attempt += 1) {
        await sleep(2000);
        const latest = await imageAPI.get(generationId);
        if (latest.status === "completed") {
          const thumbnail = latest.image_url || null;
          if (thumbnail) {
            setDrama((current) =>
              current ? { ...current, thumbnail } : current,
            );
            await load();
            toast.success("封面已生成");
            return;
          }
        }
        if (latest.status === "failed") {
          throw new Error(latest.error_msg || "封面生成失败");
        }
      }
      toast.warning("封面仍在生成中，稍后刷新页面查看");
    } catch (e: unknown) {
      toast.error("封面生成失败", { description: getAiErrorCopy(e) });
    } finally {
      setCoverGenerating(false);
    }
  }

  async function saveProjectDefaults() {
    if (!drama) return;
    try {
      setDefaultsSaving(true);
      const metadata = buildDramaMetadataWithProjectDefaults(drama.metadata, {
        image_config_id: projectDefaults.image_config_id
          ? Number(projectDefaults.image_config_id)
          : null,
        video_config_id: projectDefaults.video_config_id
          ? Number(projectDefaults.video_config_id)
          : null,
        audio_config_id: projectDefaults.audio_config_id
          ? Number(projectDefaults.audio_config_id)
          : null,
        lead_character_name: "",
        lead_character_description: "",
        lead_voice_id: "",
        voice_notes: "",
      });
      await dramaAPI.update(drama.id, { metadata });
      setDrama((current) =>
        current ? { ...current, metadata: JSON.stringify(metadata) } : current,
      );
      toast.success("项目默认设定已保存");
    } catch (e: unknown) {
      toast.error("保存项目默认设定失败", { description: getAiErrorCopy(e) });
    } finally {
      setDefaultsSaving(false);
    }
  }

  function openSourceDialog(mode: "edit" | "view") {
    if (mode === "view" && !novelSource) return;
    setSourceDialogMode(mode);
    setSourceTitleDraft(novelSource?.title || drama?.title || "");
    setSourceContentDraft(novelSource?.content || "");
    setSourceDialogOpen(true);
  }

  async function saveNovelSource() {
    if (!drama || readOnly) return;
    const content = sourceContentDraft.trim();
    if (!content) {
      toast.warning("请先粘贴小说源稿");
      return;
    }

    try {
      setSourceSaving(true);
      const chapterIndex = buildChapterIndex(content);
      const source: NovelSource = {
        type: "paste",
        title: sourceTitleDraft.trim() || drama.title,
        content,
        word_count: countNovelWords(content),
        chapter_count: chapterIndex.length,
        imported_at: new Date().toISOString(),
        summary: content.slice(0, 220).replace(/\s+/g, " "),
        chapter_index: chapterIndex,
      };
      const sourceHealth = getNovelSourceHealth(source);
      if (!sourceHealth.ok) {
        toast.warning(sourceHealth.message);
        return;
      }
      const payload = await dramaAPI.saveSource(drama.id, {
        title: source.title,
        content: source.content,
        source_type: "paste",
      });
      applyAiFirstPayload(payload);
      await load();
      setSourceDialogOpen(false);
      toast.success(
        sourceHealth.over_context_limit
          ? "小说源稿已保存，已进入长篇分块模式"
          : "小说源稿已保存，旧改编规划已失效",
      );
    } catch (e: unknown) {
      toast.error("保存小说源稿失败", { description: getAiErrorCopy(e) });
    } finally {
      setSourceSaving(false);
    }
  }

  async function loadWritingSources(query = writingSourceQuery) {
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
    } catch (e: unknown) {
      toast.error("加载小说作品失败", { description: getAiErrorCopy(e) });
    } finally {
      setWritingSourceLoading(false);
    }
  }

  function openWritingSourcePicker() {
    if (readOnly) return;
    setWritingSourceQuery("");
    setSelectedWritingSourceId(null);
    syncSourcePickerTargetSettings();
    setSourcePickerOpen(true);
    void loadWritingSources("");
  }

  async function importWritingSource(item: WritingListItem) {
    if (!drama || readOnly) return;
    try {
      setWritingSourceImportingId(item.id);
      const { blob } = await writingAPI.exportMarkdown(item.id);
      const content = (await blob.text()).trim();
      if (!content) {
        toast.warning("这个小说作品还没有可导入正文");
        return;
      }
      const chapterIndex = buildChapterIndex(content);
      const source: NovelSource = {
        type: "writing_project",
        title: item.title || drama.title,
        content,
        word_count: countNovelWords(content),
        chapter_count: chapterIndex.length,
        imported_at: new Date().toISOString(),
        summary: (item.synopsis || content.slice(0, 220)).replace(/\s+/g, " "),
        chapter_index: chapterIndex,
      };
      const sourceHealth = getNovelSourceHealth(source);
      if (!sourceHealth.ok) {
        toast.warning(sourceHealth.message);
        return;
      }
      const payload = await dramaAPI.saveSource(drama.id, {
        title: source.title,
        content: source.content,
        source_type: "writing_project",
      });
      applyAiFirstPayload(payload);
      await load();
      applySourcePickerTargetSettings();
      setSelectedWritingSourceId(null);
      setSourcePickerOpen(false);
      toast.success(
        sourceHealth.over_context_limit
          ? "已引入源稿，系统将按长篇分块理解"
          : "已从小说模块引入源稿，旧改编规划已失效",
      );
    } catch (e: unknown) {
      toast.error("导入小说源稿失败", { description: getAiErrorCopy(e) });
    } finally {
      setWritingSourceImportingId(null);
    }
  }

  async function importSelectedWritingSource() {
    if (!selectedWritingSource) {
      toast.warning("请先选择一部小说作品");
      return;
    }
    await importWritingSource(selectedWritingSource);
  }

  const saveAdaptationTargets = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!drama || readOnly) return;

      const { aspectRhythm, episodeDuration, targetEpisodeCount, visualStyle } =
        targetSettings;

      try {
        setTargetSaving(true);

        await dramaAPI.update(drama.id, {
          style: visualStyle || null,
          total_episodes: targetEpisodeCount,
        });

        setDrama((current) =>
          current
            ? {
                ...current,
                style: visualStyle || null,
                total_episodes: targetEpisodeCount,
              }
            : current,
        );
        setPlanTargetEpisodes(targetEpisodeCount);
        setPlanEpisodeDuration(episodeDuration);
        setPlanAspectRhythm(aspectRhythm);
        lastSavedTargetKeyRef.current = createTargetSettingsKey({
          aspectRhythm,
          episodeDuration,
          targetEpisodeCount,
          visualStyle,
        });
        setActiveTab("plan");
        if (!options.silent) {
          toast.success(
            hasUsableNovelSource
              ? "改编目标已保存，可重新生成改编策略"
              : hasSourceIssue
                ? "改编目标已保存，请先修复源稿后再生成策略"
                : "改编目标已保存",
          );
        }
      } catch (e: unknown) {
        toast.error("保存改编目标失败", { description: getAiErrorCopy(e) });
      } finally {
        setTargetSaving(false);
      }
    },
    [drama, hasSourceIssue, hasUsableNovelSource, readOnly, targetSettings],
  );

  useEffect(() => {
    if (!drama || readOnly || !novelSource) return;
    if (lastSavedTargetKeyRef.current === targetSettingsKey) return;

    if (targetAutosaveTimerRef.current)
      clearTimeout(targetAutosaveTimerRef.current);
    targetAutosaveTimerRef.current = setTimeout(() => {
      void saveAdaptationTargets({ silent: true });
    }, 700);

    return () => {
      if (targetAutosaveTimerRef.current)
        clearTimeout(targetAutosaveTimerRef.current);
    };
  }, [drama, novelSource, readOnly, saveAdaptationTargets, targetSettingsKey]);

  async function generateAdaptationPlan() {
    if (!drama || readOnly) return;
    if (!hasPersistedSource) {
      toast.warning("请先导入小说源稿");
      return;
    }
    if (!novelSourceHealth.ok) {
      toast.warning(novelSourceHealth.message);
      return;
    }

    let waitingForAsyncSourceAnalysis = false;
    let waitingForAsyncBriefs = false;
    try {
      setPlanGenerating(true);
      if (!drama.source_health && novelSource?.content) {
        const sourcePayload = await dramaAPI.saveSource(drama.id, {
          title: novelSource.title || drama.title,
          content: novelSource.content,
          source_type: novelSource.type,
        });
        applyAiFirstPayload(sourcePayload);
      }
      const analysisPayload = await dramaAPI.analyzeSource(drama.id);
      applyAiFirstPayload(analysisPayload);
      if (
        analysisPayload.source_analysis_task &&
        isActiveTaskStatus(analysisPayload.source_analysis_task.status)
      ) {
        briefGenerationAfterAnalysisRef.current = true;
        waitingForAsyncSourceAnalysis = true;
        toast.success("源稿理解任务已启动，完成后会继续生成改编策略");
        return;
      }
      const briefPayload = await dramaAPI.generateAdaptationBriefs(drama.id, {
        count: 2,
        target_episode_count: planTargetEpisodes,
        episode_duration: planEpisodeDuration,
        style_direction: planVisualStyle || drama.style || null,
      });
      applyAiFirstPayload(briefPayload);
      if (
        briefPayload.brief_task &&
        isActiveTaskStatus(briefPayload.brief_task.status)
      ) {
        waitingForAsyncBriefs = true;
        toast.success("改编策略任务已启动");
        return;
      }
      await load();
      setActiveTab("plan");
      toast.success("改编策略已生成");
    } catch (e: unknown) {
      toast.error("生成改编策略失败", { description: getAiErrorCopy(e) });
    } finally {
      if (!waitingForAsyncSourceAnalysis && !waitingForAsyncBriefs)
        setPlanGenerating(false);
    }
  }

  async function selectAiFirstBrief(briefId: string) {
    if (!drama || readOnly) return;
    try {
      setBriefSelectingId(briefId);
      await dramaAPI.selectAdaptationBrief(drama.id, briefId);
      await load();
      toast.success("已选择改编策略");
    } catch (e: unknown) {
      toast.error("选择改编策略失败", { description: getAiErrorCopy(e) });
    } finally {
      setBriefSelectingId(null);
    }
  }

  async function createEpisodesFromPlan(
    options: { navigateToEpisodeNumber?: number } = {},
  ) {
    if (!drama || readOnly) return;
    if (!novelSourceHealth.ok) {
      toast.warning(novelSourceHealth.message);
      return;
    }
    if (adaptationBriefs.length > 0) {
      if (!selectedBriefId) {
        toast.warning("请先选择一套改编策略");
        return;
      }
      let asyncTaskStarted = false;
      try {
        setEpisodesGenerating(true);
        const payload = await dramaAPI.generateEpisodeBlueprints(drama.id);
        applyAiFirstPayload(payload);
        const task = payload.blueprint_task;
        if (task && isActiveTaskStatus(task.status)) {
          asyncTaskStarted = true;
          toast.success("分集蓝图任务已启动");
          return;
        }
        await load();
        toast.success("分集蓝图已生成");
        if (options.navigateToEpisodeNumber) {
          router.push(
            `/drama/${drama.id}/episode/${options.navigateToEpisodeNumber}`,
          );
          return;
        }
        setActiveTab("episodes");
      } catch (e: unknown) {
        toast.error("生成分集蓝图失败", { description: getAiErrorCopy(e) });
      } finally {
        if (!asyncTaskStarted) setEpisodesGenerating(false);
      }
      return;
    }
    if (!adaptationPlan) {
      toast.warning("请先生成并选择改编策略");
      return;
    }
    toast.warning(
      "旧方案草稿不能直接生成分集，请重新生成 AI 改编策略后再创建分集蓝图。",
    );
  }

  async function regenerateEpisodeBlueprint(episode: Episode) {
    if (!drama || readOnly) return;
    if (!selectedBriefId) {
      toast.warning("请先选择一套改编策略");
      return;
    }
    try {
      setBlueprintRegeneratingEpisodeId(episode.id);
      await episodeAPI.regenerateBlueprint(episode.id);
      await load();
      toast.success(
        hasScript(episode)
          ? "本集蓝图已更新，原正文已标记需重写"
          : "本集蓝图已重生",
      );
    } catch (e: unknown) {
      toast.error("重生本集蓝图失败", { description: getAiErrorCopy(e) });
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
    } catch (e: unknown) {
      toast.error(rewrite ? "重写本集正文失败" : "生成本集正文失败", {
        description: getAiErrorCopy(e),
      });
    } finally {
      setScriptGeneratingEpisodeId(null);
    }
  }

  async function generatePilotScripts(
    options: { navigateToFirst?: boolean } = {},
  ) {
    if (!drama || readOnly) return;
    if (blueprintEpisodes.length === 0) {
      toast.warning("请先生成分集蓝图");
      return;
    }

    if (pilotPendingEpisodes.length === 0) {
      if (firstScriptReadyEpisode && options.navigateToFirst) {
        router.push(
          `/drama/${drama.id}/episode/${firstScriptReadyEpisode.episode_number}`,
        );
        return;
      }
      toast.info("试播正文已生成，可直接进入工作台");
      return;
    }

    const targetEpisodeNumber = firstPilotPendingEpisode?.episode_number || 1;
    let asyncTaskStarted = false;
    try {
      setPilotGenerating(true);
      const payload = await dramaAPI.generatePilotScripts(drama.id, {
        limit: pilotGenerateLimit,
      });
      applyAiFirstPayload(payload);
      const task = payload.pilot_script_task;
      if (task && isActiveTaskStatus(task.status)) {
        asyncTaskStarted = true;
        pilotNavigateTargetRef.current = options.navigateToFirst
          ? targetEpisodeNumber
          : null;
        toast.success("试播正文任务已启动");
        return;
      }
      await load();
      toast.success(`已生成 ${pilotGenerateLimit} 集试播正文`);
      if (options.navigateToFirst) {
        router.push(`/drama/${drama.id}/episode/${targetEpisodeNumber}`);
        return;
      }
      setActiveTab("episodes");
    } catch (e: unknown) {
      toast.error("生成试播正文失败", { description: getAiErrorCopy(e) });
    } finally {
      if (!asyncTaskStarted) setPilotGenerating(false);
    }
  }

  async function openPlanEpisode(episodeNumber: number) {
    if (!drama) return;
    if (readOnly) {
      toast.info("登录后可进入分集工作台");
      return;
    }

    const existingEpisode = episodes.find(
      (episode) => episode.episode_number === episodeNumber,
    );
    if (existingEpisode) {
      router.push(
        `/drama/${drama.id}/episode/${existingEpisode.episode_number}`,
      );
      return;
    }

    if (episodes.length > 0) {
      toast.warning("当前项目已有分集，但没有找到对应集数，请从分集卡片进入。");
      setActiveTab("episodes");
      return;
    }

    await createEpisodesFromPlan({ navigateToEpisodeNumber: episodeNumber });
  }

  if (loading) {
    return (
      <div className="page-shell bg-bg-base text-text-0 animate-fade-up">
        <div className="mx-auto w-full">
          <section className="relative min-h-[320px] overflow-hidden rounded-[10px] border border-border bg-bg-0 shadow-shadow-sm">
            <div
              className="absolute inset-0 opacity-[0.18]"
              style={{
                backgroundImage:
                  "linear-gradient(color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px)",
                backgroundSize: "51px 51px",
              }}
              aria-hidden
            />
            <div className="relative flex min-h-[320px] flex-col justify-between p-4 sm:p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex size-10 animate-pulse items-center justify-center rounded-[10px] border border-border bg-bg-surface">
                  <div className="size-5 rounded-[5px] bg-bg-2" />
                </div>
                <div className="mr-[7%] flex w-full max-w-[360px] flex-col items-start gap-4 pt-7">
                  <div className="h-9 w-40 animate-pulse rounded-[var(--radius-sm)] bg-bg-2" />
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="h-8 w-16 animate-pulse rounded-full bg-bg-2" />
                    <div className="h-8 w-14 animate-pulse rounded-full bg-bg-2" />
                    <div className="h-8 w-14 animate-pulse rounded-full bg-bg-2" />
                  </div>
                </div>
              </div>

              <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[136px] w-[120px] -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-[14px] border border-dashed border-border bg-bg-panel md:flex md:flex-col md:items-center md:justify-center md:gap-3">
                <div className="size-9 rounded-[10px] bg-bg-2" />
                <div className="h-4 w-14 rounded-full bg-bg-2" />
              </div>

              <div className="flex items-end justify-end gap-3">
                <div className="flex h-11 w-[106px] animate-pulse items-center justify-center gap-2 rounded-[10px] bg-accent-bg">
                  <div className="size-4 rounded-[4px] bg-accent-glow" />
                  <div className="h-4 w-14 rounded-full bg-accent-glow" />
                </div>
                <div className="flex size-11 animate-pulse items-center justify-center rounded-[8px] border border-border bg-bg-surface">
                  <div className="size-4 rounded-[4px] bg-bg-2" />
                </div>
              </div>
            </div>
          </section>

          <section className="mt-5">
            <div className="h-8 w-28 animate-pulse rounded-[var(--radius-sm)] bg-bg-2" />
            <div className="mt-5 flex h-[42px] w-full max-w-[500px] animate-pulse items-center gap-1 rounded-[9px] border border-border bg-bg-2 p-1">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className={`flex h-8 flex-1 items-center justify-center gap-2 rounded-[8px] ${item === 0 ? "bg-bg-0" : ""}`}
                >
                  <div className="size-4 rounded-[4px] bg-bg-3" />
                  <div className="h-4 w-14 rounded-full bg-bg-3" />
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
              <div className="flex min-h-[308px] animate-pulse flex-col items-center justify-center rounded-[12px] border border-dashed border-accent-glow bg-accent-bg px-6 py-10 text-center">
                <div className="size-[54px] rounded-[14px] bg-accent-glow" />
                <div className="mt-6 h-7 w-48 rounded-[var(--radius-sm)] bg-accent-glow" />
                <div className="mt-3 h-5 w-72 max-w-full rounded-full bg-accent-glow" />
                <div className="mt-7 h-10 w-[104px] rounded-[11px] bg-accent-glow" />
              </div>
              <div className="flex min-h-[308px] animate-pulse flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-10 text-center">
                <div className="size-11 rounded-[12px] bg-bg-2" />
                <div className="mt-5 h-5 w-28 rounded-full bg-bg-2" />
                <div className="mt-3 h-5 w-44 rounded-full bg-bg-2" />
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  }

  if (!drama) return null;

  const coverUrl = staticUrl(drama.thumbnail);
  const hasEpisodes = episodes.length > 0;
  const tabs = [
    {
      key: "episodes" as const,
      label: "分集列表",
      icon: LayoutGrid,
      count: episodes.length,
    },
    {
      key: "characters" as const,
      label: "角色",
      icon: UserRound,
      count: drama.characters?.length || 0,
    },
    {
      key: "scenes" as const,
      label: "场景",
      icon: Mountain,
      count: drama.scenes?.length || 0,
    },
    ...(novelSource
      ? [{ key: "source" as const, label: "原稿", icon: BookOpen, count: 1 }]
      : []),
    ...(adaptationPlan || adaptationBriefs.length
      ? [
          {
            key: "plan" as const,
            label: aiFirstState.legacyPlanOnly ? "旧方案" : "改编策略",
            icon: Wand2,
            count:
              adaptationBriefs.length || (aiFirstState.legacyPlanOnly ? 1 : 0),
          },
        ]
      : []),
  ];
  const rootClassName = embedded
    ? "drama-ai-first-embedded text-text-0 animate-fade-up"
    : "page-shell bg-bg-base text-text-0 animate-fade-up";
  const innerClassName = embedded ? "w-full min-w-0" : "mx-auto w-full";

  return (
    <div className={rootClassName}>
      <div className={innerClassName}>
        {readOnly ? (
          <div className="mb-5 flex flex-col gap-3 rounded-[14px] border border-border bg-bg-0 px-4 py-3.5 shadow-shadow-xs sm:flex-row sm:items-center sm:justify-between sm:px-5">
            <p className="text-sm leading-6 text-text-2">
              当前为
              <strong className="font-semibold text-text-0">只读浏览</strong>
              ：可查看项目与分集信息；创作、分集、生成与进入制作页需登录且为项目作者。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 gap-2 rounded-[10px]"
              onClick={openLoginNextHere}
            >
              <LogIn size={15} />
              登录后创作
            </Button>
          </div>
        ) : null}
        {!embedded ? (
          <section className="relative h-[100px] overflow-hidden bg-bg-0 shadow-shadow-sm">
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: coverUrl
                  ? `linear-gradient(90deg, color-mix(in srgb, var(--color-bg-0) 76%, transparent) 0%, color-mix(in srgb, var(--color-bg-0) 62%, transparent) 48%, var(--color-bg-0) 100%), url(${coverUrl})`
                  : "linear-gradient(105deg, var(--color-bg-2) 0%, var(--color-bg-0) 50%, var(--color-bg-surface) 100%)",
                backgroundSize: "cover",
                backgroundPosition: "center",
              }}
              aria-hidden
            />
            <div
              className="absolute inset-0 opacity-[0.18]"
              style={{
                backgroundImage:
                  "linear-gradient(color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--color-border) 70%, transparent) 1px, transparent 1px)",
                backgroundSize: "51px 51px",
              }}
              aria-hidden
            />
            <div className="relative flex h-full items-center justify-between gap-4 px-4 py-0 sm:px-5">
              <div className="flex min-w-0 flex-col justify-center text-left">
                <h1 className="truncate font-body text-[24px] font-black leading-tight tracking-normal text-text-0 sm:text-[26px]">
                  {drama.title}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex h-7 items-center bg-accent-bg px-3 text-xs font-medium text-accent-text">
                    {drama.style ? dramaStyleLabel(drama.style) : "通用"}
                  </span>
                  <span className="inline-flex h-7 items-center bg-bg-2 px-3 text-xs text-text-2">
                    {displayAspectRatio}
                  </span>
                  <span className="inline-flex h-7 items-center bg-bg-2 px-3 text-xs text-text-2">
                    {displayEpisodeCount} 集
                  </span>
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {!readOnly ? (
                  <>
                    {!coverUrl ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-9 rounded-[8px] border border-border bg-bg-surface text-text-1 hover:bg-bg-hover hover:text-text-0"
                        aria-label="AI 生成项目封面"
                        title="AI 生成项目封面"
                        disabled={coverBusy}
                        onClick={generateCover}
                      >
                        {coverGenerating ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Sparkles
                            size={16}
                            fill="currentColor"
                            strokeWidth={0}
                          />
                        )}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="default"
                    className="h-9 rounded-[9px] px-4 text-sm font-bold"
                    onClick={openLoginNextHere}
                  >
                    <LogIn size={16} />
                    登录后编辑
                  </Button>
                )}
              </div>
            </div>
          </section>
        ) : null}

        <section
          id={embedded ? "ai-first-workbench" : undefined}
          className={embedded ? "space-y-5" : "mt-5"}
        >
          {!embedded ? (
            <h2 className="font-body text-2xl font-black tracking-normal text-text-0">
              创作中枢
            </h2>
          ) : null}

          {!readOnly && !hasEpisodes ? (
            <div className="mt-5 space-y-5">
              <div className="flex flex-wrap items-center gap-2 text-xs text-text-2">
                <span
                  className={`rounded-full border px-3 py-1.5 font-semibold ${
                    hasUsableNovelSource
                      ? "border-border bg-bg-2 text-text-2"
                      : "border-accent-glow bg-accent-bg text-accent-text"
                  }`}
                  aria-current={!hasUsableNovelSource ? "step" : undefined}
                >
                  01 小说源稿
                </span>
                <span className="text-text-3">→</span>
                <span
                  className={`rounded-full border px-3 py-1.5 font-semibold ${
                    hasUsableNovelSource
                      ? "border-accent-glow bg-accent-bg text-accent-text"
                      : "border-border bg-bg-2 text-text-2"
                  }`}
                  aria-current={hasUsableNovelSource ? "step" : undefined}
                >
                  02 改编策略
                </span>
                <span className="text-text-3">→</span>
                <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5 font-semibold">
                  03 分集制作
                </span>
              </div>
              {!novelSource ? (
                <section className="space-y-5 border-0 bg-transparent p-0 shadow-none">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                        <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent text-xs font-black text-on-accent">
                          01
                        </span>
                        <BookOpen size={16} />
                        添加小说 / 导入原稿
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.82fr)]">
                    <button
                      type="button"
                      onClick={openWritingSourcePicker}
                      className="group flex min-h-[176px] flex-col items-start justify-between rounded-[14px] border-0 bg-[color-mix(in_srgb,var(--color-accent)_7%,var(--color-bg-2))] px-5 py-5 text-left transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,var(--color-bg-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0"
                    >
                      <div className="flex size-11 items-center justify-center rounded-[11px] bg-bg-surface-glass text-accent backdrop-blur-md">
                        <BookOpen size={22} />
                      </div>
                      <div className="mt-6">
                        <h3 className="font-body text-lg font-black tracking-normal text-text-0 group-hover:text-accent">
                          从小说模块引入
                        </h3>
                        <p className="mt-2 max-w-xl text-sm leading-6 text-text-2">
                          选择已有小说作品，自动导出全文作为源稿；适合从创作工作台进入短剧改编。
                        </p>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => openSourceDialog("edit")}
                      className="group flex min-h-[176px] flex-col items-start justify-between rounded-[14px] border-0 bg-[color-mix(in_srgb,var(--color-bg-2)_62%,var(--color-bg-0))] px-5 py-5 text-left transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-[color-mix(in_srgb,var(--color-accent)_6%,var(--color-bg-2))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-0"
                    >
                      <div className="flex size-11 items-center justify-center rounded-[11px] bg-bg-surface-glass text-text-2 backdrop-blur-md group-hover:text-accent">
                        <FileUp size={22} />
                      </div>
                      <div className="mt-6">
                        <h3 className="font-body text-base font-black tracking-normal text-text-0">
                          粘贴 / 导入原稿
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-text-2">
                          直接粘贴整本小说全文，保存后统计字数、章节并进入改编策略。
                        </p>
                      </div>
                    </button>
                  </div>
                </section>
              ) : null}

              {novelSource ? (
                <section className="space-y-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                        <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent text-xs font-black text-on-accent">
                          {hasSourceIssue ? "01" : "02"}
                        </span>
                        {hasSourceIssue ? (
                          <AlertTriangle size={16} className="text-warning" />
                        ) : (
                          <Wand2 size={16} />
                        )}
                        {hasSourceIssue ? "修复小说源稿" : "改编策略"}
                      </div>
                      <p className="mt-1 text-sm leading-6 text-text-2">
                        {hasSourceIssue
                          ? "当前源稿还不能用于改编，请先重新导入或粘贴完整正文。"
                          : "基于整本小说确定制作默认设定、角色圣经、场景圣经和分集大纲，再进入分集制作。"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-9 shrink-0 rounded-full border-0 bg-bg-2/80 px-3 shadow-none hover:bg-bg-hover"
                        onClick={() => setProjectDefaultsDialogOpen(true)}
                      >
                        <Settings2 size={14} />
                        配置默认值
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-9 rounded-full bg-bg-2/80 px-3 shadow-none hover:bg-bg-hover"
                        onClick={() => openSourceDialog("view")}
                      >
                        <Eye size={13} />
                        查看原稿
                      </Button>
                    </div>
                  </div>

                  {hasSourceIssue ? (
                    <div
                      role="alert"
                      className="mt-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3"
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          size={16}
                          className="mt-0.5 shrink-0 text-warning"
                        />
                        <div>
                          <div className="text-sm font-semibold text-warning">
                            请先修复源稿再继续改编
                          </div>
                          <p className="mt-1 text-sm leading-6 text-text-2">
                            {novelSourceHealth.message}{" "}
                            当前改编策略仅适合排查问题，不建议继续生成分集。
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="py-1">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold text-text-0">
                          <span className="inline-flex size-6 items-center justify-center rounded-full bg-bg-2/80 text-xs font-semibold text-accent-text">
                            A
                          </span>
                          改编目标
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-text-3">
                        {targetSaving ? (
                          <Loader2
                            size={13}
                            className="animate-spin text-accent"
                          />
                        ) : (
                          <CheckCircle2 size={13} className="text-accent" />
                        )}
                        {targetSaving ? "正在同步" : "更改后自动生效"}
                      </div>
                    </div>
                    <AdaptationTargetFields
                      gridClassName="mt-4 sm:grid-cols-2 lg:grid-cols-4"
                      targetEpisodeCount={planTargetEpisodes}
                      onTargetEpisodeCountChange={setPlanTargetEpisodes}
                      episodeDuration={planEpisodeDuration}
                      onEpisodeDurationChange={setPlanEpisodeDuration}
                      visualStyle={planVisualStyle}
                      onVisualStyleChange={setPlanVisualStyle}
                      aspectRhythm={planAspectRhythm}
                      onAspectRhythmChange={setPlanAspectRhythm}
                    />
                  </div>

                  <div className="py-1">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold text-text-0">
                          <span className="inline-flex size-6 items-center justify-center rounded-full bg-bg-2/80 text-xs font-semibold text-accent-text">
                            B
                          </span>
                          改编策略
                        </div>
                      </div>
                      {adaptationPlan ? (
                        <span
                          className={`inline-flex h-7 shrink-0 items-center text-xs font-semibold ${
                            hasSourceIssue ? "text-warning" : "text-text-3"
                          }`}
                        >
                          {hasSourceIssue ? "待重新生成" : "旧数据待迁移"}
                        </span>
                      ) : null}
                    </div>

                    {sourceAnalysisTask &&
                    (sourceAnalysisTaskActive || sourceAnalysisTaskFailed) ? (
                      <div
                        role={sourceAnalysisTaskFailed ? "alert" : "status"}
                        aria-live="polite"
                        className="mt-4 rounded-[14px] border border-border bg-bg-2/70 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-0">
                            {sourceAnalysisTaskFailed ? (
                              <AlertTriangle
                                size={15}
                                className="shrink-0 text-warning"
                              />
                            ) : (
                              <Loader2
                                size={15}
                                className="shrink-0 animate-spin text-accent-text"
                              />
                            )}
                            <span className="truncate">
                              {sourceAnalysisTaskFailed
                                ? "源稿理解失败"
                                : formatSourceAnalysisPhase(
                                    sourceAnalysisTask.result_summary,
                                  )}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs font-semibold text-text-2">
                            {sourceAnalysisTaskProgress}%
                          </span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-0">
                          <div
                            className={`h-full rounded-full ${sourceAnalysisTaskFailed ? "bg-warning" : "bg-accent"}`}
                            style={{ width: `${sourceAnalysisTaskProgress}%` }}
                          />
                        </div>
                        <p className="mt-2 text-xs leading-5 text-text-2">
                          {sourceAnalysisTaskFailed
                            ? getAiErrorCopy(
                                sourceAnalysisTask.error_message,
                                "请检查大模型服务配置后重试。",
                              )
                            : sourceChunkStats.total > 0
                              ? `${sourceChunkStats.ready}/${sourceChunkStats.total} 个分块已完成${sourceChunkStats.running > 0 ? `，${sourceChunkStats.running} 个进行中` : ""}${sourceChunkStats.failed > 0 ? `，${sourceChunkStats.failed} 个失败` : ""}。`
                              : "任务已进入队列，页面会自动刷新进度。"}
                        </p>
                        {!readOnly ? (
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            {sourceAnalysisTaskActive ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full px-3 text-xs"
                                disabled={
                                  taskActionBusyId === sourceAnalysisTask.id
                                }
                                onClick={() => {
                                  void cancelAiFirstTask(
                                    sourceAnalysisTask.id,
                                    "源稿理解任务",
                                  );
                                }}
                              >
                                {taskActionBusyId === sourceAnalysisTask.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <X size={13} />
                                )}
                                取消
                              </Button>
                            ) : sourceAnalysisTaskFailed ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full px-3 text-xs"
                                disabled={
                                  taskActionBusyId === sourceAnalysisTask.id
                                }
                                onClick={() => {
                                  void retryAiFirstTask(
                                    sourceAnalysisTask.id,
                                    "源稿理解任务",
                                  );
                                }}
                              >
                                {taskActionBusyId === sourceAnalysisTask.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={13} />
                                )}
                                重试理解
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {briefTask && (briefTaskActive || briefTaskFailed) ? (
                      <div
                        role={briefTaskFailed ? "alert" : "status"}
                        aria-live="polite"
                        className="mt-4 rounded-[14px] border border-border bg-bg-2/70 px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text-0">
                            {briefTaskFailed ? (
                              <AlertTriangle
                                size={15}
                                className="shrink-0 text-warning"
                              />
                            ) : (
                              <Loader2
                                size={15}
                                className="shrink-0 animate-spin text-accent-text"
                              />
                            )}
                            <span className="truncate">
                              {briefTaskFailed
                                ? "改编策略任务失败"
                                : formatBriefPhase(briefTask.result_summary)}
                            </span>
                          </div>
                          <span className="shrink-0 text-xs font-semibold text-text-2">
                            {briefTaskProgress}%
                          </span>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-0">
                          <div
                            className={`h-full rounded-full ${briefTaskFailed ? "bg-warning" : "bg-accent"}`}
                            style={{ width: `${briefTaskProgress}%` }}
                          />
                        </div>
                        <p className="mt-2 text-xs leading-5 text-text-2">
                          {briefTaskFailed
                            ? getAiErrorCopy(
                                briefTask.error_message,
                                "请检查大模型服务配置后重试。",
                              )
                            : formatBriefDetail(briefTask.result_summary)}
                        </p>
                        {!readOnly ? (
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            {briefTaskActive ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full px-3 text-xs"
                                disabled={taskActionBusyId === briefTask.id}
                                onClick={() => {
                                  void cancelAiFirstTask(
                                    briefTask.id,
                                    "改编策略任务",
                                  );
                                }}
                              >
                                {taskActionBusyId === briefTask.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <X size={13} />
                                )}
                                取消
                              </Button>
                            ) : briefTaskFailed ? (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-8 rounded-full px-3 text-xs"
                                disabled={taskActionBusyId === briefTask.id}
                                onClick={() => {
                                  void retryAiFirstTask(
                                    briefTask.id,
                                    "改编策略任务",
                                  );
                                }}
                              >
                                {taskActionBusyId === briefTask.id ? (
                                  <Loader2 size={13} className="animate-spin" />
                                ) : (
                                  <RefreshCw size={13} />
                                )}
                                重试策略
                              </Button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {!adaptationPlan && adaptationBriefs.length === 0 ? (
                      <div className="mt-6 flex min-h-[188px] flex-col items-center justify-center px-6 py-8 text-center">
                        <Sparkles
                          size={36}
                          className="text-text-3"
                          strokeWidth={1.8}
                        />
                        <h3 className="mt-4 font-body text-lg font-black tracking-normal text-text-0">
                          等待生成改编策略
                        </h3>
                        <p className="mt-2 max-w-md text-sm leading-6 text-text-2">
                          {hasSourceIssue
                            ? "当前原稿内容异常，请先修复或更换源稿，再生成可用的改编策略。"
                            : novelSource
                              ? "将先理解源稿，再生成目标集数、主线、角色圣经、场景圣经和分集大纲。长篇源稿会进入分块任务。"
                              : "请先导入小说源稿，再生成改编策略。"}
                        </p>
                        {hasSourceIssue ? (
                          <Button
                            type="button"
                            className="mt-5 h-9 rounded-[9px]"
                            onClick={() => openSourceDialog("edit")}
                          >
                            <RefreshCw size={14} />
                            修复源稿
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            className="mt-5 h-9 rounded-[9px]"
                            disabled={!hasUsableNovelSource || planBusy}
                            onClick={generateAdaptationPlan}
                          >
                            {planBusy ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Wand2 size={14} />
                            )}
                            {sourceAnalysisTaskActive
                              ? "理解源稿中"
                              : briefTaskActive
                                ? "生成策略中"
                                : planGenerating
                                  ? "生成中"
                                  : "生成改编策略"}
                          </Button>
                        )}
                      </div>
                    ) : adaptationBriefs.length > 0 ? (
                      <div className="mt-4">
                        {hasSourceIssue ? (
                          <div
                            role="alert"
                            className="mb-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3"
                          >
                            <div className="text-sm font-semibold text-warning">
                              当前策略基于异常源稿生成
                            </div>
                            <p className="mt-1 text-sm leading-6 text-text-2">
                              请先修复原稿，再重新生成改编策略；在此之前不建议继续确认分集。
                            </p>
                          </div>
                        ) : null}
                        <div className="grid gap-3 lg:grid-cols-2">
                          {adaptationBriefs.map((brief) => (
                            <AdaptationBriefCard
                              key={brief.id}
                              brief={brief}
                              disabled={
                                readOnly ||
                                hasSourceIssue ||
                                planBusy ||
                                blueprintBusy
                              }
                              selected={brief.id === selectedBriefId}
                              selecting={briefSelectingId === brief.id}
                              onSelect={selectAiFirstBrief}
                            />
                          ))}
                        </div>
                        <div className="mt-4 flex flex-col gap-3 rounded-[18px] bg-accent-bg/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-text-0">
                              {selectedBriefId
                                ? "策略已选择，可以生成分集蓝图"
                                : "请先选择一套策略"}
                            </div>
                            <p className="mt-1 text-sm leading-6 text-text-2">
                              分集蓝图会创建真实 Episode，并保留源稿追溯。
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            className="h-9 shrink-0 rounded-full px-4"
                            disabled={
                              planBusy ||
                              blueprintBusy ||
                              !selectedBriefId ||
                              hasSourceIssue
                            }
                            onClick={() => {
                              void createEpisodesFromPlan();
                            }}
                          >
                            {blueprintBusy ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            {blueprintBusy ? "生成中" : "生成分集蓝图"}
                          </Button>
                        </div>
                        {blueprintTask &&
                        (blueprintTaskActive || blueprintTaskFailed) ? (
                          <div
                            role={blueprintTaskFailed ? "alert" : "status"}
                            aria-live="polite"
                            className="mt-3 rounded-[12px] border border-border bg-bg-2/70 px-3 py-3"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-0">
                                {blueprintTaskFailed ? (
                                  <AlertTriangle
                                    size={14}
                                    className="shrink-0 text-warning"
                                  />
                                ) : (
                                  <Loader2
                                    size={14}
                                    className="shrink-0 animate-spin text-accent-text"
                                  />
                                )}
                                <span className="truncate">
                                  {blueprintTaskFailed
                                    ? "分集蓝图任务失败"
                                    : formatBlueprintPhase(
                                        blueprintTask.result_summary,
                                      )}
                                </span>
                              </div>
                              <span className="shrink-0 text-xs font-semibold text-text-2">
                                {blueprintTaskProgress}%
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-0">
                              <div
                                className={`h-full rounded-full ${blueprintTaskFailed ? "bg-warning" : "bg-accent"}`}
                                style={{ width: `${blueprintTaskProgress}%` }}
                              />
                            </div>
                            <p className="mt-2 text-xs leading-5 text-text-2">
                              {blueprintTaskFailed
                                ? getAiErrorCopy(
                                    blueprintTask.error_message,
                                    "请检查大模型服务配置后重试。",
                                  )
                                : formatBlueprintDetail(
                                    blueprintTask.result_summary,
                                  )}
                            </p>
                            {!readOnly ? (
                              <div className="mt-3 flex flex-wrap justify-end gap-2">
                                {blueprintTaskActive ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-full px-3 text-xs"
                                    disabled={
                                      taskActionBusyId === blueprintTask.id
                                    }
                                    onClick={() => {
                                      void cancelAiFirstTask(
                                        blueprintTask.id,
                                        "分集蓝图任务",
                                      );
                                    }}
                                  >
                                    {taskActionBusyId === blueprintTask.id ? (
                                      <Loader2
                                        size={13}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <X size={13} />
                                    )}
                                    取消
                                  </Button>
                                ) : blueprintTaskFailed ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-full px-3 text-xs"
                                    disabled={
                                      taskActionBusyId === blueprintTask.id
                                    }
                                    onClick={() => {
                                      void retryAiFirstTask(
                                        blueprintTask.id,
                                        "分集蓝图任务",
                                      );
                                    }}
                                  >
                                    {taskActionBusyId === blueprintTask.id ? (
                                      <Loader2
                                        size={13}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <RefreshCw size={13} />
                                    )}
                                    重试蓝图
                                  </Button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    ) : adaptationPlan ? (
                      <LegacyAdaptationPlanNotice
                        hasSourceIssue={hasSourceIssue}
                        onFixSource={() => openSourceDialog("edit")}
                        onRegenerate={generateAdaptationPlan}
                        plan={adaptationPlan}
                        planGenerating={planGenerating || briefTaskActive}
                        readOnly={readOnly}
                        sourceAnalysisTaskActive={sourceAnalysisTaskActive}
                      />
                    ) : null}
                  </div>
                </section>
              ) : null}
            </div>
          ) : null}

          {!readOnly && hasEpisodes ? (
            <div className="mt-5 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                <span className="inline-flex size-7 items-center justify-center rounded-full bg-accent text-xs font-black text-on-accent">
                  03
                </span>
                <LayoutGrid size={16} />
                分集制作
              </div>
              <p className="text-sm leading-6 text-text-2">
                分集蓝图生成后，先生成 1 到 3
                集试播正文，再进入单集工作台继续剧本、分镜和视频制作。
              </p>
            </div>
          ) : null}

          {!readOnly && hasEpisodes && blueprintEpisodes.length > 0 ? (
            <div className="mt-4 flex flex-col gap-3 rounded-[14px] border border-border bg-bg-0 px-5 py-4 shadow-shadow-xs sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-text-0">
                  <span>试播正文</span>
                  <span className="inline-flex h-6 items-center rounded-full bg-bg-2 px-2.5 text-xs font-semibold text-text-2">
                    {blueprintScriptReadyEpisodes.length}/
                    {blueprintEpisodes.length} 已生成
                  </span>
                  {pilotFailedEpisodes.length > 0 ? (
                    <span className="inline-flex h-6 items-center rounded-full bg-warning-bg px-2.5 text-xs font-semibold text-warning">
                      {pilotFailedEpisodes.length} 集失败
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-6 text-text-2">
                  {pilotPendingEpisodes.length > 0
                    ? `还有 ${pilotPendingEpisodes.length} 集只有蓝图。下一步会先生成 ${pilotGenerateLimit} 集试播正文，并进入第 ${firstPilotPendingEpisode?.episode_number || 1} 集工作台。`
                    : "试播正文已就绪，可以进入工作台继续提取资产、拆分镜头和制作视频。"}
                </p>
                {pilotScriptTask &&
                (pilotScriptTaskActive || pilotScriptTaskFailed) ? (
                  <div
                    role={pilotScriptTaskFailed ? "alert" : "status"}
                    aria-live="polite"
                    className="mt-3 rounded-[12px] border border-border bg-bg-2/70 px-3 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-0">
                        {pilotScriptTaskFailed ? (
                          <AlertTriangle
                            size={14}
                            className="shrink-0 text-warning"
                          />
                        ) : (
                          <Loader2
                            size={14}
                            className="shrink-0 animate-spin text-accent-text"
                          />
                        )}
                        <span className="truncate">
                          {pilotScriptTaskFailed
                            ? "试播正文任务失败"
                            : formatPilotScriptPhase(
                                pilotScriptTask.result_summary,
                              )}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-text-2">
                        {pilotScriptTaskProgress}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-0">
                      <div
                        className={`h-full rounded-full ${pilotScriptTaskFailed ? "bg-warning" : "bg-accent"}`}
                        style={{ width: `${pilotScriptTaskProgress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs leading-5 text-text-2">
                      {pilotScriptTaskFailed
                        ? getAiErrorCopy(
                            pilotScriptTask.error_message,
                            "请检查大模型服务配置后重试。",
                          )
                        : formatPilotScriptDetail(
                            pilotScriptTask.result_summary,
                          )}
                    </p>
                    {!readOnly ? (
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        {pilotScriptTaskActive ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full px-3 text-xs"
                            disabled={taskActionBusyId === pilotScriptTask.id}
                            onClick={() => {
                              void cancelAiFirstTask(
                                pilotScriptTask.id,
                                "试播正文任务",
                              );
                            }}
                          >
                            {taskActionBusyId === pilotScriptTask.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <X size={13} />
                            )}
                            取消
                          </Button>
                        ) : pilotScriptTaskFailed ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full px-3 text-xs"
                            disabled={taskActionBusyId === pilotScriptTask.id}
                            onClick={() => {
                              void retryAiFirstTask(
                                pilotScriptTask.id,
                                "试播正文任务",
                              );
                            }}
                          >
                            {taskActionBusyId === pilotScriptTask.id ? (
                              <Loader2 size={13} className="animate-spin" />
                            ) : (
                              <RefreshCw size={13} />
                            )}
                            重试试播
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0 rounded-full px-4"
                disabled={
                  pilotScriptBusy ||
                  (pilotPendingEpisodes.length === 0 &&
                    !firstScriptReadyEpisode)
                }
                onClick={() => {
                  void generatePilotScripts({ navigateToFirst: true });
                }}
              >
                {pilotScriptBusy ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Play size={14} fill="currentColor" strokeWidth={0} />
                )}
                {pilotPendingEpisodes.length > 0
                  ? pilotScriptBusy
                    ? "生成中"
                    : `生成试播 ${pilotGenerateLimit} 集并进入`
                  : "进入试播工作台"}
              </Button>
            </div>
          ) : null}

          {readOnly || hasEpisodes ? (
            <>
              <div className="mt-4 flex w-full max-w-[720px] rounded-[9px] border border-border bg-bg-2 p-1">
                {tabs.map(({ key, label, icon: Icon, count }) => (
                  <button
                    key={key}
                    type="button"
                    aria-label={label}
                    onClick={() => setActiveTab(key)}
                    className={`flex h-8 min-w-0 flex-1 items-center justify-center gap-2 rounded-[8px] px-3 text-sm font-bold transition-colors ${
                      activeTab === key
                        ? "bg-bg-0 text-text-0 shadow-shadow-xs"
                        : "text-text-1 hover:bg-bg-hover"
                    }`}
                  >
                    <Icon size={15} />
                    <span className="truncate">{label}</span>
                    {count > 0 ? (
                      <span className="inline-flex size-5 items-center justify-center rounded-full bg-accent text-xs text-on-accent">
                        {count}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>

              {activeTab === "episodes" ? (
                <div className="mt-5">
                  {episodes.length === 0 ? (
                    readOnly ? (
                      <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-12 text-center">
                        <FileText
                          size={40}
                          className="text-text-3"
                          strokeWidth={1.5}
                        />
                        <p className="mt-4 max-w-md text-sm leading-7 text-text-2">
                          暂无公开分集内容，或作者尚未发布。登录后可创建自己的项目。
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-6 h-10 rounded-[11px]"
                          onClick={openLoginNextHere}
                        >
                          <LogIn size={15} />
                          登录
                        </Button>
                      </div>
                    ) : (
                      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
                        <div className="flex min-h-[308px] flex-col items-center justify-center rounded-[12px] border border-dashed border-accent-glow bg-accent-bg px-6 py-10 text-center">
                          <FileUp
                            size={54}
                            className="text-accent"
                            strokeWidth={1.9}
                          />
                          <h3 className="mt-6 font-body text-[22px] font-black tracking-normal text-text-0">
                            快速按标记分集
                          </h3>
                          <p className="mt-3 text-sm text-text-2">
                            适合已经写好“第1集 /
                            第2集”标记的剧本；整本小说请先走上方源稿和改编规划。
                          </p>
                          <Button
                            className="mt-7 h-10 rounded-[11px] px-5 text-sm font-bold"
                            onClick={() => {
                              setSplitContent("");
                              setSplitDialog(true);
                            }}
                          >
                            <FileUp size={15} />
                            开始分集
                          </Button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setNewTitle("");
                            setAddDialog(true);
                          }}
                          className="flex min-h-[308px] flex-col items-center justify-center rounded-[12px] border border-dashed border-border-strong bg-bg-0 px-6 py-10 text-center transition-colors hover:border-accent hover:bg-bg-hover"
                        >
                          <Plus
                            size={44}
                            className="text-text-3"
                            strokeWidth={1.7}
                          />
                          <h3 className="mt-5 font-body text-base font-black tracking-normal text-text-0">
                            手动新增一集
                          </h3>
                          <p className="mt-3 text-sm text-text-2">
                            从零开始创作你的短剧故事
                          </p>
                        </button>
                      </div>
                    )
                  ) : (
                    <div className="space-y-4">
                      {!readOnly &&
                      episodes.length === 1 &&
                      (episodes[0]?.content || "").trim().length > 1200 ? (
                        <div className="flex flex-col gap-3 rounded-[14px] border border-accent-glow bg-accent-bg px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <div className="text-sm font-semibold text-text-0">
                              当前只有 1 集，可以重新按标记分集
                            </div>
                            <p className="mt-1 text-sm leading-6 text-text-2">
                              系统会读取当前第 1
                              集的原始内容，按“第1集”“第一章”等明确标记重新拆成多集。
                            </p>
                          </div>
                          <Button
                            className="h-9 rounded-[var(--radius-sm)] px-4"
                            disabled={splitting}
                            onClick={() => {
                              setSplitContent("");
                              void splitEpisodes();
                            }}
                          >
                            {splitting ? "分集中..." : "重新分集"}
                          </Button>
                        </div>
                      ) : null}

                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                        {episodes.map((ep: Episode, i: number) => {
                          const preview = episodePreviewText(ep);
                          const blueprint = normalizeEpisodeBlueprintPayload(
                            ep.blueprint_payload,
                          );
                          const staleLabel = getEpisodeStaleLabel(ep);
                          const scriptActionRewrite = Boolean(
                            hasScript(ep) && staleLabel,
                          );
                          const showScriptAction = Boolean(
                            blueprint && (!hasScript(ep) || staleLabel),
                          );
                          const statusTone = ep.failure_reason
                            ? "bg-warning-bg text-warning"
                            : hasScript(ep)
                              ? "bg-success-bg text-success"
                              : blueprint
                                ? "bg-accent-bg text-accent-text"
                                : "bg-bg-2 text-text-3";
                          const statusLabel = ep.failure_reason
                            ? "生成失败"
                            : hasScript(ep)
                              ? "正文已生成"
                              : blueprint
                                ? "蓝图已生成"
                                : "待完善";
                          return (
                            <article
                              key={ep.id}
                              className={`group flex min-h-[200px] flex-col rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs transition-colors ${
                                readOnly
                                  ? preview
                                    ? "cursor-pointer hover:border-accent hover:bg-bg-hover"
                                    : ""
                                  : "cursor-pointer hover:border-accent hover:bg-bg-hover"
                              }`}
                              style={{ animationDelay: `${i * 0.05}s` }}
                              onClick={() => {
                                if (readOnly) {
                                  if (preview) setPreviewScriptEpisode(ep);
                                  else toast.info("本集暂无公开正文");
                                  return;
                                }
                                router.push(
                                  `/drama/${drama.id}/episode/${ep.episode_number}`,
                                );
                              }}
                            >
                              <div className="w-fit rounded-[4px] border border-accent-glow bg-accent-bg px-3 py-1.5 text-sm font-medium text-accent-text">
                                第 {ep.episode_number} 集
                              </div>
                              <h3 className="mt-4 font-body text-lg font-black tracking-normal text-text-0">
                                {ep.title || `第${ep.episode_number}集`}
                              </h3>
                              <div className="mt-3 flex items-center gap-1.5 text-sm text-text-2">
                                <Clock3 size={14} />
                                {formatEpisodeDuration(ep.duration)}
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <span
                                  className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold ${statusTone}`}
                                >
                                  {statusLabel}
                                </span>
                                {blueprint?.source_trace?.length ? (
                                  <span className="inline-flex h-6 items-center rounded-full bg-bg-2 px-2.5 text-xs font-semibold text-text-3">
                                    {blueprint.source_trace.length} 条追溯
                                  </span>
                                ) : null}
                                {staleLabel ? (
                                  <span className="inline-flex h-6 items-center rounded-full bg-warning-bg px-2.5 text-xs font-semibold text-warning">
                                    {staleLabel}
                                  </span>
                                ) : null}
                              </div>
                              {blueprint && !preview ? (
                                <p className="mt-3 line-clamp-3 text-sm leading-6 text-text-2">
                                  {blueprint.summary ||
                                    blueprint.opening_hook ||
                                    blueprint.positioning}
                                </p>
                              ) : ep.failure_reason ? (
                                <p
                                  className="mt-3 line-clamp-2 text-xs leading-5 text-warning"
                                  role="alert"
                                >
                                  {ep.failure_reason}
                                </p>
                              ) : null}

                              <div className="mt-auto border-t border-border pt-3">
                                {ep.video_url ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="mb-2 h-8 rounded-[8px]"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setPreviewVideoUrl(
                                        staticUrl(ep.video_url),
                                      );
                                      setPreviewVideoTitle(
                                        ep.title ||
                                          `第 ${ep.episode_number} 集`,
                                      );
                                    }}
                                  >
                                    预览视频
                                  </Button>
                                ) : null}
                                {readOnly ? (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="ml-auto flex h-8 rounded-[7px] px-4 text-sm font-bold"
                                    disabled={!preview}
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      if (preview) setPreviewScriptEpisode(ep);
                                      else toast.info("本集暂无公开正文");
                                    }}
                                  >
                                    <FileText size={14} />
                                    {preview ? "预览原文" : "暂无正文"}
                                  </Button>
                                ) : (
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    {blueprint ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-[7px] px-3 text-sm font-bold"
                                        disabled={
                                          blueprintRegeneratingEpisodeId !==
                                            null ||
                                          planBusy ||
                                          blueprintBusy ||
                                          pilotScriptBusy
                                        }
                                        aria-label={`重生第${ep.episode_number}集蓝图`}
                                        title="重生蓝图"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void regenerateEpisodeBlueprint(ep);
                                        }}
                                      >
                                        {blueprintRegeneratingEpisodeId ===
                                        ep.id ? (
                                          <Loader2
                                            size={14}
                                            className="animate-spin"
                                          />
                                        ) : (
                                          <RefreshCw size={14} />
                                        )}
                                        重生蓝图
                                      </Button>
                                    ) : null}
                                    {showScriptAction ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        className="h-8 rounded-[7px] px-3 text-sm font-bold"
                                        disabled={
                                          scriptGeneratingEpisodeId !== null ||
                                          blueprintRegeneratingEpisodeId !==
                                            null ||
                                          planBusy ||
                                          blueprintBusy ||
                                          pilotScriptBusy
                                        }
                                        aria-label={`${scriptActionRewrite ? "重写" : "生成"}第${ep.episode_number}集正文`}
                                        title={
                                          scriptActionRewrite
                                            ? "重写正文"
                                            : "生成正文"
                                        }
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void generateEpisodeScript(
                                            ep,
                                            scriptActionRewrite,
                                          );
                                        }}
                                      >
                                        {scriptGeneratingEpisodeId === ep.id ? (
                                          <Loader2
                                            size={14}
                                            className="animate-spin"
                                          />
                                        ) : (
                                          <Wand2 size={14} />
                                        )}
                                        {scriptActionRewrite
                                          ? "重写正文"
                                          : "生成正文"}
                                      </Button>
                                    ) : null}
                                    <Button
                                      size="sm"
                                      className="h-8 rounded-[7px] px-4 text-sm font-bold"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        router.push(
                                          `/drama/${drama.id}/episode/${ep.episode_number}`,
                                        );
                                      }}
                                    >
                                      <Play
                                        size={14}
                                        fill="currentColor"
                                        strokeWidth={0}
                                      />
                                      {hasScript(ep)
                                        ? "进入制作"
                                        : blueprint
                                          ? "查看蓝图"
                                          : "进入制作"}
                                    </Button>
                                  </div>
                                )}
                              </div>
                            </article>
                          );
                        })}

                        {!readOnly ? (
                          <button
                            type="button"
                            onClick={() => {
                              setNewTitle("");
                              setAddDialog(true);
                            }}
                            className="flex min-h-[200px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 p-5 text-center transition-colors hover:border-accent hover:bg-bg-hover"
                          >
                            <Plus
                              size={42}
                              className="text-text-3"
                              strokeWidth={1.7}
                            />
                            <span className="mt-5 font-body text-base font-black tracking-normal text-text-0">
                              新增一集
                            </span>
                            <span className="mt-3 text-sm text-text-2">
                              继续创作你的短剧故事
                            </span>
                          </button>
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>
              ) : activeTab === "characters" ? (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {(drama.characters || []).map((character) => (
                    <article
                      key={character.id}
                      className="min-h-[150px] rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-[8px] bg-accent-bg text-accent">
                          <UserRound size={19} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-body text-base font-black tracking-normal text-text-0">
                            {character.name}
                          </h3>
                          <p className="text-sm text-text-2">
                            {character.role || "角色"}
                          </p>
                        </div>
                      </div>
                      <p className="mt-4 line-clamp-3 text-sm leading-6 text-text-2">
                        {character.description ||
                          character.appearance ||
                          character.personality ||
                          "暂无角色描述"}
                      </p>
                    </article>
                  ))}
                  {!drama.characters || drama.characters.length === 0 ? (
                    <div className="col-span-full flex min-h-[220px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 text-center">
                      <UserRound size={36} className="text-text-3" />
                      <p className="mt-4 text-sm text-text-2">
                        暂无角色，进入分集制作后可从剧本提取。
                      </p>
                    </div>
                  ) : null}
                </div>
              ) : activeTab === "source" ? (
                <div className="mt-5 rounded-[14px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                  {novelSource ? (
                    <>
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                            <BookOpen size={16} />
                            原稿
                          </div>
                          <h3 className="mt-3 truncate font-body text-xl font-black tracking-normal text-text-0">
                            {novelSource.title || drama.title}
                          </h3>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-text-2">
                            <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">
                              {formatCount(novelSource.word_count)} 字
                            </span>
                            <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">
                              {novelSource.chapter_count || 1} 章
                            </span>
                            <span className="rounded-full border border-border bg-bg-2 px-3 py-1.5">
                              导入{" "}
                              {novelSource.imported_at
                                ? new Date(
                                    novelSource.imported_at,
                                  ).toLocaleDateString()
                                : "未记录"}
                            </span>
                          </div>
                        </div>
                        {!readOnly ? (
                          <div className="flex shrink-0 flex-wrap gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-[9px]"
                              onClick={() => openSourceDialog("view")}
                            >
                              <Eye size={14} />
                              查看原稿
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-9 rounded-[9px]"
                              onClick={() => openSourceDialog("edit")}
                            >
                              <RefreshCw size={14} />
                              重新导入
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      {hasSourceIssue ? (
                        <div
                          role="alert"
                          className="mt-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3"
                        >
                          <div className="flex items-start gap-2">
                            <AlertTriangle
                              size={16}
                              className="mt-0.5 shrink-0 text-warning"
                            />
                            <div>
                              <div className="text-sm font-semibold text-warning">
                                当前原稿内容异常
                              </div>
                              <p className="mt-1 text-sm leading-6 text-text-2">
                                {novelSourceHealth.message}
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : null}
                      <p className="mt-4 line-clamp-5 text-sm leading-7 text-text-2">
                        {novelSource.summary ||
                          novelSource.content.slice(0, 320)}
                      </p>
                    </>
                  ) : (
                    <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                      <BookOpen size={36} className="text-text-3" />
                      <p className="mt-4 text-sm text-text-2">暂无原稿。</p>
                    </div>
                  )}
                </div>
              ) : activeTab === "plan" ? (
                <div className="mt-5 rounded-[14px] border border-border bg-bg-0 p-5 shadow-shadow-xs">
                  {adaptationPlan ? (
                    <LegacyAdaptationPlanNotice
                      hasSourceIssue={hasSourceIssue}
                      onFixSource={() => openSourceDialog("edit")}
                      onRegenerate={generateAdaptationPlan}
                      plan={adaptationPlan}
                      planGenerating={planGenerating || briefTaskActive}
                      readOnly={readOnly}
                      sourceAnalysisTaskActive={sourceAnalysisTaskActive}
                    />
                  ) : adaptationBriefs.length > 0 ? (
                    <>
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="flex items-center gap-2 text-base font-semibold text-text-0">
                            <Wand2 size={16} />
                            改编策略
                          </div>
                          <p className="mt-2 text-sm leading-6 text-text-2">
                            已生成 {adaptationBriefs.length}{" "}
                            套策略；分集蓝图会基于选中的策略创建真实 Episode。
                          </p>
                        </div>
                        {!readOnly ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-9 rounded-[9px]"
                            disabled={planBusy}
                            onClick={generateAdaptationPlan}
                          >
                            {planBusy ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                            {sourceAnalysisTaskActive
                              ? "理解源稿中"
                              : briefTaskActive
                                ? "生成策略中"
                                : "重新生成策略"}
                          </Button>
                        ) : null}
                      </div>
                      {briefTask && (briefTaskActive || briefTaskFailed) ? (
                        <div
                          role={briefTaskFailed ? "alert" : "status"}
                          aria-live="polite"
                          className="mt-3 rounded-[12px] border border-border bg-bg-2/70 px-3 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-0">
                              {briefTaskFailed ? (
                                <AlertTriangle
                                  size={14}
                                  className="shrink-0 text-warning"
                                />
                              ) : (
                                <Loader2
                                  size={14}
                                  className="shrink-0 animate-spin text-accent-text"
                                />
                              )}
                              <span className="truncate">
                                {briefTaskFailed
                                  ? "改编策略任务失败"
                                  : formatBriefPhase(briefTask.result_summary)}
                              </span>
                            </div>
                            <span className="shrink-0 text-xs font-semibold text-text-2">
                              {briefTaskProgress}%
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-0">
                            <div
                              className={`h-full rounded-full ${briefTaskFailed ? "bg-warning" : "bg-accent"}`}
                              style={{ width: `${briefTaskProgress}%` }}
                            />
                          </div>
                          <p className="mt-2 text-xs leading-5 text-text-2">
                            {briefTaskFailed
                              ? getAiErrorCopy(
                                  briefTask.error_message,
                                  "请检查大模型服务配置后重试。",
                                )
                              : formatBriefDetail(briefTask.result_summary)}
                          </p>
                          {!readOnly ? (
                            <div className="mt-3 flex flex-wrap justify-end gap-2">
                              {briefTaskActive ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 rounded-full px-3 text-xs"
                                  disabled={taskActionBusyId === briefTask.id}
                                  onClick={() => {
                                    void cancelAiFirstTask(
                                      briefTask.id,
                                      "改编策略任务",
                                    );
                                  }}
                                >
                                  {taskActionBusyId === briefTask.id ? (
                                    <Loader2
                                      size={13}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <X size={13} />
                                  )}
                                  取消
                                </Button>
                              ) : briefTaskFailed ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 rounded-full px-3 text-xs"
                                  disabled={taskActionBusyId === briefTask.id}
                                  onClick={() => {
                                    void retryAiFirstTask(
                                      briefTask.id,
                                      "改编策略任务",
                                    );
                                  }}
                                >
                                  {taskActionBusyId === briefTask.id ? (
                                    <Loader2
                                      size={13}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <RefreshCw size={13} />
                                  )}
                                  重试策略
                                </Button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {adaptationBriefs.map((brief) => (
                          <AdaptationBriefCard
                            key={brief.id}
                            brief={brief}
                            disabled={
                              readOnly ||
                              hasSourceIssue ||
                              hasEpisodes ||
                              planBusy ||
                              blueprintBusy
                            }
                            selected={brief.id === selectedBriefId}
                            selecting={briefSelectingId === brief.id}
                            onSelect={selectAiFirstBrief}
                          />
                        ))}
                      </div>
                      {!readOnly && !hasEpisodes ? (
                        <>
                          <div className="mt-4 flex flex-col gap-3 rounded-[16px] bg-accent-bg/60 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-text-0">
                                {selectedBriefId
                                  ? "策略已选择"
                                  : "请先选择一套策略"}
                              </div>
                              <p className="mt-1 text-sm leading-6 text-text-2">
                                生成后会进入分集列表，可继续生成试播正文并进入工作台。
                              </p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              className="h-9 shrink-0 rounded-full px-4"
                              disabled={
                                planBusy ||
                                blueprintBusy ||
                                !selectedBriefId ||
                                hasSourceIssue
                              }
                              onClick={() => {
                                void createEpisodesFromPlan();
                              }}
                            >
                              {blueprintBusy ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <CheckCircle2 size={14} />
                              )}
                              {blueprintBusy ? "生成中" : "生成分集蓝图"}
                            </Button>
                          </div>
                          {blueprintTask &&
                          (blueprintTaskActive || blueprintTaskFailed) ? (
                            <div
                              role={blueprintTaskFailed ? "alert" : "status"}
                              aria-live="polite"
                              className="mt-3 rounded-[12px] border border-border bg-bg-2/70 px-3 py-3"
                            >
                              <div className="flex items-center justify-between gap-3">
                                <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-text-0">
                                  {blueprintTaskFailed ? (
                                    <AlertTriangle
                                      size={14}
                                      className="shrink-0 text-warning"
                                    />
                                  ) : (
                                    <Loader2
                                      size={14}
                                      className="shrink-0 animate-spin text-accent-text"
                                    />
                                  )}
                                  <span className="truncate">
                                    {blueprintTaskFailed
                                      ? "分集蓝图任务失败"
                                      : formatBlueprintPhase(
                                          blueprintTask.result_summary,
                                        )}
                                  </span>
                                </div>
                                <span className="shrink-0 text-xs font-semibold text-text-2">
                                  {blueprintTaskProgress}%
                                </span>
                              </div>
                              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-0">
                                <div
                                  className={`h-full rounded-full ${blueprintTaskFailed ? "bg-warning" : "bg-accent"}`}
                                  style={{ width: `${blueprintTaskProgress}%` }}
                                />
                              </div>
                              <p className="mt-2 text-xs leading-5 text-text-2">
                                {blueprintTaskFailed
                                  ? getAiErrorCopy(
                                      blueprintTask.error_message,
                                      "请检查大模型服务配置后重试。",
                                    )
                                  : formatBlueprintDetail(
                                      blueprintTask.result_summary,
                                    )}
                              </p>
                              {!readOnly ? (
                                <div className="mt-3 flex flex-wrap justify-end gap-2">
                                  {blueprintTaskActive ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 rounded-full px-3 text-xs"
                                      disabled={
                                        taskActionBusyId === blueprintTask.id
                                      }
                                      onClick={() => {
                                        void cancelAiFirstTask(
                                          blueprintTask.id,
                                          "分集蓝图任务",
                                        );
                                      }}
                                    >
                                      {taskActionBusyId === blueprintTask.id ? (
                                        <Loader2
                                          size={13}
                                          className="animate-spin"
                                        />
                                      ) : (
                                        <X size={13} />
                                      )}
                                      取消
                                    </Button>
                                  ) : blueprintTaskFailed ? (
                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      className="h-8 rounded-full px-3 text-xs"
                                      disabled={
                                        taskActionBusyId === blueprintTask.id
                                      }
                                      onClick={() => {
                                        void retryAiFirstTask(
                                          blueprintTask.id,
                                          "分集蓝图任务",
                                        );
                                      }}
                                    >
                                      {taskActionBusyId === blueprintTask.id ? (
                                        <Loader2
                                          size={13}
                                          className="animate-spin"
                                        />
                                      ) : (
                                        <RefreshCw size={13} />
                                      )}
                                      重试蓝图
                                    </Button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </>
                  ) : (
                    <div className="flex min-h-[220px] flex-col items-center justify-center text-center">
                      <Wand2 size={36} className="text-text-3" />
                      <p className="mt-4 text-sm text-text-2">暂无改编策略。</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {(drama.scenes || []).map((scene) => (
                    <article
                      key={scene.id}
                      className="min-h-[150px] rounded-[10px] border border-border bg-bg-0 p-5 shadow-shadow-xs"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex size-11 items-center justify-center rounded-[8px] bg-accent-bg text-accent">
                          <Mountain size={19} />
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate font-body text-base font-black tracking-normal text-text-0">
                            {scene.location || "未命名场景"}
                          </h3>
                          <p className="text-sm text-text-2">
                            {scene.time || "场景"}
                          </p>
                        </div>
                      </div>
                      <p className="mt-4 line-clamp-3 text-sm leading-6 text-text-2">
                        {scene.prompt || "暂无场景描述"}
                      </p>
                    </article>
                  ))}
                  {!drama.scenes || drama.scenes.length === 0 ? (
                    <div className="col-span-full flex min-h-[220px] flex-col items-center justify-center rounded-[10px] border border-dashed border-border-strong bg-bg-0 text-center">
                      <Mountain size={36} className="text-text-3" />
                      <p className="mt-4 text-sm text-text-2">
                        暂无场景，进入分集制作后可从剧本提取。
                      </p>
                    </div>
                  ) : null}
                </div>
              )}
            </>
          ) : null}
        </section>

        {/* Add Episode Dialog */}
      </div>

      <LegacyDramaDialogs
        addDialog={addDialog}
        adaptationPlan={adaptationPlan}
        audioConfigOptions={audioConfigOptions}
        creating={creating}
        defaultsSaving={defaultsSaving}
        imageConfigOptions={imageConfigOptions}
        importSelectedWritingSource={importSelectedWritingSource}
        loadWritingSources={loadWritingSources}
        missingConfigHints={missingConfigHints}
        newTitle={newTitle}
        openLoginNextHere={openLoginNextHere}
        pickerAspectRhythm={pickerAspectRhythm}
        pickerEpisodeDuration={pickerEpisodeDuration}
        pickerTargetEpisodes={pickerTargetEpisodes}
        pickerVisualStyle={pickerVisualStyle}
        previewScriptEpisode={previewScriptEpisode}
        previewVideoTitle={previewVideoTitle}
        previewVideoUrl={previewVideoUrl}
        projectDefaults={projectDefaults}
        projectDefaultsDialogOpen={projectDefaultsDialogOpen}
        saveNovelSource={saveNovelSource}
        saveProjectDefaults={saveProjectDefaults}
        selectedPlanCharacter={selectedPlanCharacter}
        selectedWritingSource={selectedWritingSource}
        selectedWritingSourceId={selectedWritingSourceId}
        setAddDialog={setAddDialog}
        setNewTitle={setNewTitle}
        setPickerAspectRhythm={setPickerAspectRhythm}
        setPickerEpisodeDuration={setPickerEpisodeDuration}
        setPickerTargetEpisodes={setPickerTargetEpisodes}
        setPickerVisualStyle={setPickerVisualStyle}
        setPreviewScriptEpisode={setPreviewScriptEpisode}
        setPreviewVideoUrl={setPreviewVideoUrl}
        setProjectDefaults={setProjectDefaults}
        setProjectDefaultsDialogOpen={setProjectDefaultsDialogOpen}
        setSelectedPlanCharacter={setSelectedPlanCharacter}
        setSelectedWritingSourceId={setSelectedWritingSourceId}
        setSourceContentDraft={setSourceContentDraft}
        setSourceDialogOpen={setSourceDialogOpen}
        setSourcePickerOpen={setSourcePickerOpen}
        setSourceTitleDraft={setSourceTitleDraft}
        setSplitContent={setSplitContent}
        setSplitDialog={setSplitDialog}
        setWritingSourceQuery={setWritingSourceQuery}
        sourceContentDraft={sourceContentDraft}
        sourceDialogHasBlockingIssue={sourceDialogHasBlockingIssue}
        sourceDialogHealth={sourceDialogHealth}
        sourceDialogMode={sourceDialogMode}
        sourceDialogOpen={sourceDialogOpen}
        sourceDraftChapterCount={sourceDraftChapterCount}
        sourceDraftWordCount={sourceDraftWordCount}
        sourcePickerOpen={sourcePickerOpen}
        sourceSaving={sourceSaving}
        sourceTitleDraft={sourceTitleDraft}
        splitContent={splitContent}
        splitDialog={splitDialog}
        splitEpisodes={splitEpisodes}
        splitting={splitting}
        videoConfigOptions={videoConfigOptions}
        writingSourceImportingId={writingSourceImportingId}
        writingSourceLoading={writingSourceLoading}
        writingSourceQuery={writingSourceQuery}
        writingSources={writingSources}
        onAddEpisode={addEpisode}
      />
    </div>
  );
}
