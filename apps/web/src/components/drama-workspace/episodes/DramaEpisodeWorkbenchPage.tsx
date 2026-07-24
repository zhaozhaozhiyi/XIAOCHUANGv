"use client";

import { useEffect, useMemo, useCallback, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useShallow } from "zustand/react/shallow";
import { Loader2, ArrowLeft, ArrowRight, Check } from "lucide-react";
import {
  hasCompleteShotFrames,
  isVisualCharacter,
  useWorkbench,
} from "@/hooks/use-workbench";
import { useGridTool } from "@/hooks/use-grid-tool";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { ImageViewer } from "@/components/shared/image-viewer";
import { ScriptPanel } from "@/components/episode/script/script-panel";
import { ProductionPanel } from "@/components/episode/production/production-panel";
import { ExportPanel } from "@/components/episode/export/export-panel";
import { GridToolDialog } from "@/components/episode/production/grid-tool-dialog";
import { cn } from "@/lib/cn";
import { getStoryboardTtsDialogue } from "@/lib/dialogue";
import { dramaAPI, type StoryGraphSummaryPayload } from "@/lib/api";
import type { Storyboard } from "@/types/api";
import {
  EPISODE_STAGES,
  EPISODE_STAGE_LABELS,
  getDefaultEpisodeStep,
  getEpisodeWorkbenchHref,
  getEpisodeStageForStep,
  getProjectStageHref,
  parseEpisodeStep,
  rememberEpisodeLocation,
  resolveEpisodeRoute,
  type EpisodeStage,
  type EpisodeStep,
  type ProjectStage,
} from "./episode-route";

const STAGE_SUBNAV: Record<
  EpisodeStage,
  ReadonlyArray<{ key: EpisodeStep; label: string }>
> = {
  script: [
    { key: "script-raw", label: "内容" },
    { key: "script-rewrite", label: "剧本" },
    { key: "script-extract", label: "角色与场景" },
    { key: "script-voice", label: "音色" },
  ],
  storyboard: [{ key: "script-storyboard", label: "分镜" }],
  assets: [
    { key: "prod-chars", label: "角色" },
    { key: "prod-scenes", label: "场景" },
    { key: "prod-shots", label: "镜头" },
    { key: "prod-continuity", label: "连续性" },
  ],
  video: [
    { key: "prod-dubbing", label: "配音" },
    { key: "prod-videos", label: "视频" },
  ],
  final: [
    { key: "prod-compose", label: "逐镜合成" },
    { key: "export-merge", label: "整集成片" },
  ],
};

const STAGE_PRODUCTION_TABS: Partial<Record<EpisodeStage, readonly string[]>> = {
  assets: ["chars", "scenes", "shots", "continuity"],
  video: ["dubbing", "videos"],
  final: ["compose"],
};

const STORYBOARD_WORKSPACE_STEPS = new Set<EpisodeStep>([
  "script-storyboard",
  "prod-chars",
  "prod-scenes",
  "prod-dubbing",
  "prod-shots",
  "prod-continuity",
  "prod-videos",
  "prod-compose",
  "export-merge",
]);

function isStoryboardWorkspaceStep(step: EpisodeStep | null | undefined) {
  return Boolean(step && STORYBOARD_WORKSPACE_STEPS.has(step));
}

type ContinueAction =
  | { label: string; projectStage: ProjectStage }
  | { label: string; stage: EpisodeStage }
  | { label: string; step: EpisodeStep };

export function DramaEpisodeWorkbenchPage({
  dramaId,
  episodeNumber,
}: {
  dramaId: number;
  episodeNumber: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeContext = useMemo(
    () => ({
      shot: searchParams.get("shot"),
      asset: searchParams.get("asset"),
      task: searchParams.get("task"),
      origin: searchParams.get("origin"),
    }),
    [searchParams],
  );
  const requestedRoute = useMemo(
    () =>
      resolveEpisodeRoute({
        stage: searchParams.get("stage"),
        step: searchParams.get("tool") ?? searchParams.get("step"),
        context: routeContext,
      }),
    [routeContext, searchParams],
  );
  const requestedRouteStage = searchParams.get("stage")
    ? requestedRoute.stage
    : null;
  const requestedRouteStep = (searchParams.get("tool") ?? searchParams.get("step"))
    ? requestedRoute.step
    : null;
  const pendingRouteStep = useRef<EpisodeStep | null>(null);
  const appliedRouteRequest = useRef<string | null>(null);

  const wb = useWorkbench(
    useShallow((state) => ({
      drama: state.drama,
      episode: state.episode,
      characters: state.characters,
      scenes: state.scenes,
      storyboards: state.storyboards,
      panel: state.panel,
      scriptStep: state.scriptStep,
      prodTab: state.prodTab,
      viewerOpen: state.viewerOpen,
      viewerSrc: state.viewerSrc,
      viewerTitle: state.viewerTitle,
      pendingDeleteStoryboard: state.pendingDeleteStoryboard,
      mergeUrl: state.mergeUrl,
      reset: state.reset,
      loadAll: state.loadAll,
      goSubStep: state.goSubStep,
      closeImageViewer: state.closeImageViewer,
      cancelDeleteShot: state.cancelDeleteShot,
      confirmDeleteShot: state.confirmDeleteShot,
      charsVoiced: state.charsVoiced,
    })),
  );
  const gt = useGridTool();
  const resetWorkbench = wb.reset;
  const loadWorkbench = wb.loadAll;
  const workbenchDrama = wb.drama;
  const workbenchEpisode = wb.episode;
  const goWorkbenchSubStep = wb.goSubStep;
  const setGridStorageKey = gt.setStorageKey;
  const loadGridHistory = gt.loadHistory;
  const [refreshKey, setRefreshKey] = useState(0);
  const [storyGraphSummary, setStoryGraphSummary] =
    useState<StoryGraphSummaryPayload | null>(null);
  const [storyGraphLoading, setStoryGraphLoading] = useState(true);
  const [storyGraphLoadFailed, setStoryGraphLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setStoryGraphLoading(true);
        setStoryGraphLoadFailed(false);
      }
    });

    void dramaAPI
      .getStoryGraph(dramaId)
      .then((payload) => {
        if (!cancelled) setStoryGraphSummary(payload);
      })
      .catch(() => {
        if (!cancelled) {
          setStoryGraphSummary(null);
          setStoryGraphLoadFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setStoryGraphLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dramaId, refreshKey]);

  useEffect(() => {
    // Reset state when navigating to a new episode
    resetWorkbench();
    loadWorkbench(dramaId, episodeNumber);
    // Set localStorage key for grid tool
    setGridStorageKey(`xiaochuang:grid:${dramaId}:${episodeNumber}`);
  }, [
    dramaId,
    episodeNumber,
    loadWorkbench,
    refreshKey,
    resetWorkbench,
    setGridStorageKey,
  ]);

  // Load grid history after drama is loaded
  useEffect(() => {
    if (workbenchDrama) {
      loadGridHistory(dramaId);
    }
  }, [dramaId, loadGridHistory, workbenchDrama]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const storyboardUnlocked = Boolean(
    !storyGraphLoading &&
    storyGraphSummary?.graph?.status === "ready" &&
    !storyGraphSummary.is_stale,
  );
  const storyboardGateMessage = storyGraphLoading
    ? "正在确认正式故事地图状态。"
    : storyGraphLoadFailed
      ? "暂时无法确认故事地图状态，请刷新后重试。"
      : storyGraphSummary?.is_stale
        ? "剧本正文已经变更，故事地图基于旧版本。请先在第四步重建故事地图。"
        : "请先在第四步从全剧剧本构建正式故事地图，再开始本集分镜。";
  const activeStep = useMemo<EpisodeStep>(() => {
    if (wb.panel === "script") {
      const stepMap = [
        "script-raw",
        "script-rewrite",
        "script-extract",
        "script-voice",
        "script-storyboard",
      ];
      return (stepMap[wb.scriptStep] || "script-raw") as EpisodeStep;
    }
    if (wb.panel === "production") {
      const tabMap: Record<string, string> = {
        chars: "prod-chars",
        scenes: "prod-scenes",
        dubbing: "prod-dubbing",
        shots: "prod-shots",
        continuity: "prod-continuity",
        videos: "prod-videos",
        compose: "prod-compose",
      };
      return (tabMap[wb.prodTab] || "prod-chars") as EpisodeStep;
    }
    return "export-merge";
  }, [wb.panel, wb.scriptStep, wb.prodTab]);
  const activeStage = getEpisodeStageForStep(activeStep);
  const replaceRouteStage = useCallback(
    (stage: EpisodeStage, clearTool = false) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.delete("step");
      if (clearTool) nextSearchParams.delete("tool");
      nextSearchParams.set("stage", stage);
      router.replace(
        `${getEpisodeWorkbenchHref(dramaId, episodeNumber)}?${nextSearchParams.toString()}`,
        { scroll: false },
      );
    },
    [dramaId, episodeNumber, router, searchParams],
  );
  const setFocusedShot = useCallback(
    (shotId: number | null) => {
      const nextSearchParams = new URLSearchParams(searchParams.toString());
      nextSearchParams.delete("step");
      nextSearchParams.set("stage", activeStage);
      if (shotId == null) nextSearchParams.delete("shot");
      else nextSearchParams.set("shot", String(shotId));
      router.replace(
        `${getEpisodeWorkbenchHref(dramaId, episodeNumber)}?${nextSearchParams.toString()}`,
        { scroll: false },
      );
    },
    [activeStage, dramaId, episodeNumber, router, searchParams],
  );
  const goToStep = useCallback(
    (step: string) => {
      const nextStep = parseEpisodeStep(step);
      if (!nextStep) return;
      const resolvedStep =
        !storyboardUnlocked && isStoryboardWorkspaceStep(nextStep)
          ? "script-storyboard"
          : nextStep;
      pendingRouteStep.current = resolvedStep;
      goWorkbenchSubStep(resolvedStep);
      replaceRouteStage(getEpisodeStageForStep(resolvedStep), true);
    },
    [goWorkbenchSubStep, replaceRouteStage, storyboardUnlocked],
  );
  const goToStage = useCallback(
    (stage: EpisodeStage) => {
      goToStep(getDefaultEpisodeStep(stage, routeContext));
    },
    [goToStep, routeContext],
  );

  useEffect(() => {
    if (!workbenchEpisode) return;
    if (
      storyGraphLoading &&
      (isStoryboardWorkspaceStep(requestedRouteStep) ||
        (requestedRouteStage != null && requestedRouteStage !== "script"))
    )
      return;
    const requestedStep = requestedRouteStep ?? (requestedRouteStage
      ? getDefaultEpisodeStep(requestedRouteStage, routeContext)
      : null);
    const requestKey = [
      workbenchEpisode.id,
      requestedRouteStage || "",
      requestedRouteStep || requestedStep || "",
      routeContext.shot || "",
      routeContext.asset || "",
      routeContext.task || "",
      routeContext.origin || "",
    ].join(":");
    if (appliedRouteRequest.current === requestKey) return;
    appliedRouteRequest.current = requestKey;
    if (!requestedStep) return;
    // A new stage preserves the user's local sub-navigation within that stage.
    // A legacy `step` URL remains exact for backwards-compatible deep links.
    if (
      requestedRouteStage &&
      !requestedRouteStep &&
      requestedRouteStage === activeStage &&
      requestedStep === activeStep
    )
      return;
    const resolvedStep =
      !storyboardUnlocked && isStoryboardWorkspaceStep(requestedStep)
        ? "script-storyboard"
        : requestedStep;
    if (resolvedStep === activeStep) return;
    pendingRouteStep.current = resolvedStep;
    goWorkbenchSubStep(resolvedStep);
    if (resolvedStep !== requestedStep) {
      replaceRouteStage(getEpisodeStageForStep(resolvedStep));
    }
  }, [
    activeStep,
    activeStage,
    goWorkbenchSubStep,
    replaceRouteStage,
    requestedRouteStage,
    requestedRouteStep,
    routeContext,
    storyGraphLoading,
    storyboardUnlocked,
    workbenchEpisode,
  ]);

  useEffect(() => {
    if (!workbenchEpisode) return;
    if (
      storyGraphLoading &&
      (isStoryboardWorkspaceStep(requestedRouteStep) ||
        (requestedRouteStage != null && requestedRouteStage !== "script"))
    )
      return;
    if (pendingRouteStep.current) {
      if (
        pendingRouteStep.current !== activeStep ||
        (requestedRouteStage !== activeStage && requestedRouteStep !== activeStep)
      )
        return;
      pendingRouteStep.current = null;
    }
    rememberEpisodeLocation(dramaId, episodeNumber, activeStep);
    if (requestedRouteStage === activeStage && !requestedRouteStep) return;
    replaceRouteStage(activeStage);
  }, [
    activeStep,
    activeStage,
    dramaId,
    episodeNumber,
    replaceRouteStage,
    requestedRouteStage,
    requestedRouteStep,
    storyGraphLoading,
    workbenchEpisode,
  ]);

  const projectBackStage =
    !storyboardUnlocked && isStoryboardWorkspaceStep(activeStep)
      ? "graph"
      : activeStep === "script-raw" || activeStep === "script-rewrite"
        ? "script"
        : "storyboard";
  const visualCharacters = useMemo(
    () => wb.characters.filter(isVisualCharacter),
    [wb.characters],
  );
  const stageSubnavSteps = STAGE_SUBNAV[activeStage];
  const focusedShotId =
    routeContext.shot && Number.isInteger(Number(routeContext.shot))
      ? Number(routeContext.shot)
      : null;
  const isShotFocusRoute =
    focusedShotId != null && (activeStage === "assets" || activeStage === "video");

  const isDone = (key: string) => {
    if (key === "script-raw") return !!wb.episode?.content;
    if (key === "script-rewrite") return !!wb.episode?.script_content;
    if (key === "script-extract") return wb.characters.length > 0;
    if (key === "script-voice")
      return (
        wb.characters.length > 0 && wb.charsVoiced() === wb.characters.length
      );
    if (key === "script-storyboard") return wb.storyboards.length > 0;
    if (key === "prod-chars")
      return (
        wb.characters.length > 0 &&
        (visualCharacters.length === 0 ||
          visualCharacters.every((c) => !!c.image_url))
      );
    if (key === "prod-scenes")
      return (
        wb.storyboards.length > 0 &&
        (wb.scenes.length === 0 || wb.scenes.every((s) => !!s.image_url))
      );
    if (key === "prod-dubbing") {
      const eligible = wb.storyboards.filter(
        (s) => !!getStoryboardTtsDialogue(s),
      );
      return (
        wb.storyboards.length > 0 &&
        (eligible.length === 0 || eligible.every((s) => !!s.tts_audio_url))
      );
    }
    if (key === "prod-shots")
      return (
        wb.storyboards.length > 0 && wb.storyboards.every(hasCompleteShotFrames)
      );
    if (key === "prod-videos")
      return (
        wb.storyboards.length > 0 && wb.storyboards.every((s) => !!s.video_url)
      );
    if (key === "prod-compose")
      return (
        wb.storyboards.length > 0 &&
        wb.storyboards.every((s) => !!s.composed_video_url)
      );
    if (key === "export-merge") return !!wb.mergeUrl;
    return false;
  };
  const isStageDone = (stage: EpisodeStage) => {
    if (stage === "script") return isDone("script-rewrite");
    if (stage === "storyboard") return isDone("script-storyboard");
    if (stage === "assets")
      return (
        isDone("prod-chars") &&
        isDone("prod-scenes") &&
        isDone("prod-shots")
      );
    if (stage === "video") return isDone("prod-dubbing") && isDone("prod-videos");
    return isDone("export-merge");
  };
  const continueAction: ContinueAction = (() => {
    if (!storyboardUnlocked && activeStage !== "script") {
      return { label: "前往故事地图", projectStage: "graph" as const };
    }

    if (activeStage !== "script" && wb.storyboards.length === 0) {
      return { label: "完成分镜", stage: "storyboard" as const };
    }

    if (activeStage === "script") {
      if (!isDone("script-raw")) return { label: "开始整理内容", step: "script-raw" as const };
      if (!isDone("script-rewrite")) return { label: "继续剧本", step: "script-rewrite" as const };
      if (!isDone("script-extract")) return { label: "补全角色与场景", step: "script-extract" as const };
      if (!isDone("script-voice")) return { label: "分配音色", step: "script-voice" as const };
      return { label: "进入分镜", stage: "storyboard" as const };
    }

    if (activeStage === "storyboard") {
      return isDone("script-storyboard")
        ? { label: "进入素材", stage: "assets" as const }
        : { label: "继续分镜", step: "script-storyboard" as const };
    }

    if (activeStage === "assets") {
      if (routeContext.shot) return { label: "补全镜头素材", step: "prod-shots" as const };
      if (!isDone("prod-chars")) return { label: "补全角色素材", step: "prod-chars" as const };
      if (!isDone("prod-scenes")) return { label: "补全场景素材", step: "prod-scenes" as const };
      if (!isDone("prod-shots")) return { label: "补全镜头素材", step: "prod-shots" as const };
      return { label: "进入视频", stage: "video" as const };
    }

    if (activeStage === "video") {
      if (routeContext.shot) return { label: "生成镜头视频", step: "prod-videos" as const };
      if (!isDone("prod-dubbing")) return { label: "补全配音", step: "prod-dubbing" as const };
      if (!isDone("prod-videos")) return { label: "生成视频", step: "prod-videos" as const };
      return { label: "进入成片", stage: "final" as const };
    }

    if (!isDone("prod-compose")) return { label: "合成镜头", step: "prod-compose" as const };
    if (!isDone("export-merge")) return { label: "生成成片", step: "export-merge" as const };
    return { label: "查看成片", step: "export-merge" as const };
  })();

  const goContinue = useCallback(() => {
    if ("projectStage" in continueAction) {
      router.push(getProjectStageHref(dramaId, continueAction.projectStage));
      return;
    }
    if ("stage" in continueAction) {
      goToStage(continueAction.stage);
      return;
    }
    goToStep(continueAction.step);
  }, [continueAction, dramaId, goToStage, goToStep, router]);

  const handleOpenGrid = (sb: Storyboard) => {
    gt.openFresh(
      wb.storyboards.map((s) => s.id),
      dramaId,
      wb.episode?.id || 0,
    );
    // Pre-select the target storyboard
    gt.setSingleTarget(sb.id);
  };

  if (!wb.drama) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className={cn("studio", isShotFocusRoute && "is-shot-focus-route")}>
      {/* ===== Topbar ===== */}
      <header className="studio-topbar">
        <div className="studio-topbar-main">
          <Link
            className="back-btn topbar-back"
            href={getProjectStageHref(dramaId, projectBackStage)}
          >
            <ArrowLeft size={15} /> 剧集
          </Link>

          <div className="studio-identity">
            <h1 className="studio-title">
              {wb.episode?.title?.trim() || `第 ${episodeNumber} 集`}
            </h1>
            <span className="studio-episode-chip">
              {EPISODE_STAGE_LABELS[activeStage]}
            </span>
          </div>
        </div>

        <div className="studio-topbar-side">
          <button className="studio-btn studio-btn-primary" onClick={goContinue}>
            {continueAction.label}
            <ArrowRight size={14} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="studio-body">
        <main className="main">
          {!isShotFocusRoute ? <nav className="episode-stage-nav" aria-label="本集制作阶段">
            {EPISODE_STAGES.map((stage) => {
              const locked = !storyboardUnlocked && stage !== "script";
              const done = isStageDone(stage);
              return (
                <button
                  key={stage}
                  className={cn(
                    "episode-stage-nav-item",
                    activeStage === stage && "active",
                    done && "done",
                    locked && "is-locked",
                  )}
                  aria-label={
                    locked
                      ? `${EPISODE_STAGE_LABELS[stage]}，需先完成故事地图`
                      : EPISODE_STAGE_LABELS[stage]
                  }
                  onClick={() => goToStage(stage)}
                >
                  <span
                    className={cn(
                      "episode-stage-status",
                      done && "is-done",
                    )}
                    aria-hidden="true"
                  >
                    {done ? <Check size={12} /> : null}
                  </span>
                  <span>{EPISODE_STAGE_LABELS[stage]}</span>
                </button>
              );
            })}
          </nav> : null}

          {stageSubnavSteps.length > 1 && !isShotFocusRoute && (
            <div className="stage-subnav">
              {stageSubnavSteps.map((sub) => {
                const locked =
                  !storyboardUnlocked &&
                  isStoryboardWorkspaceStep(sub.key as EpisodeStep);
                return (
                  <button
                    key={sub.key}
                    className={cn(
                      "stage-subnav-item",
                      activeStep === sub.key && "active",
                      locked && "is-locked",
                    )}
                    aria-label={
                      locked ? `${sub.label}，需先完成故事地图` : sub.label
                    }
                    onClick={() => goToStep(sub.key)}
                  >
                    <span>{sub.label}</span>
                    {isDone(sub.key) && <span className="stage-subnav-dot" />}
                  </button>
                );
              })}
            </div>
          )}
          <div className="content-wrap">
            <div
              className={cn(
                "content-card",
                `episode-stage-${activeStage}`,
                (activeStep === "script-raw" ||
                  activeStep === "script-rewrite") &&
                  "content-card-document",
              )}
            >
              {wb.panel === "script" && (
                <ScriptPanel
                  activeStep={activeStep}
                  onRefresh={refresh}
                  storyboardUnlocked={storyboardUnlocked}
                  storyboardGateLoading={storyGraphLoading}
                  storyboardGateMessage={storyboardGateMessage}
                  storyboardGateHref={getProjectStageHref(dramaId, "graph")}
                />
              )}
              {wb.panel === "production" && (
                <ProductionPanel
                  prodTab={wb.prodTab}
                  onOpenGrid={handleOpenGrid}
                  allowedTabs={STAGE_PRODUCTION_TABS[activeStage]}
                  showStepAction={false}
                  canvasEpisodeNumber={episodeNumber}
                  focusedShotId={focusedShotId}
                  onFocusShot={setFocusedShot}
                />
              )}
              {wb.panel === "export" && <ExportPanel />}
            </div>
          </div>
        </main>
      </div>

      {/* Image Viewer */}
      {wb.viewerOpen && (
        <ImageViewer
          open={wb.viewerOpen}
          src={wb.viewerSrc}
          title={wb.viewerTitle}
          onClose={wb.closeImageViewer}
        />
      )}

      {/* Grid Tool Dialog */}
      {wb.episode && (
        <GridToolDialog
          storyboards={wb.storyboards}
          dramaId={dramaId}
          episodeId={wb.episode.id}
          onDone={refresh}
        />
      )}

      <ConfirmDialog
        open={Boolean(wb.pendingDeleteStoryboard)}
        onOpenChange={(open) => {
          if (!open) wb.cancelDeleteShot();
        }}
        title="删除分镜"
        description="确定删除此分镜？此操作不可恢复。"
        confirmLabel="删除"
        onConfirm={() => wb.confirmDeleteShot()}
      />
    </div>
  );
}
