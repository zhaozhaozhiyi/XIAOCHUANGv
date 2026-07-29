"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  Users,
  MapPin,
  Mic2,
  ImageIcon,
  Video,
  Clapperboard,
  Plus,
  Layers,
  Settings2,
  AlertTriangle,
  RefreshCw,
  GitBranch,
  CheckCircle2,
  CircleAlert,
  Clock3,
  PencilLine,
  X,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { toast } from "sonner";
import {
  hasCompleteShotFrames,
  isActiveWorkbenchTask,
  isVisualCharacter,
  useWorkbench,
} from "@/hooks/use-workbench";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogContent,
  DialogDescription,
  DialogHeaderBar,
  DialogMain,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { getAiErrorCopy } from "@/lib/ai-error-copy";
import { getStoryboardTtsDialogue } from "@/lib/dialogue";
import { staticUrl } from "@/lib/utils";
import {
  dramaWorkspaceAPI,
  episodeContinuityAPI,
  episodeAPI,
  type EpisodeContinuityBoundary,
  type EpisodeContinuityPayload,
  type EpisodeContinuityPreflight,
  type EpisodeContinuityRun,
  type EpisodeDialogueCue,
  type EpisodeDialogueTake,
  type EpisodeDialogueTakePreview,
  type EpisodeEditRevision,
  type EpisodeEditRevisionPreview,
  type DramaShotTarget,
} from "@/lib/api";
import type { Storyboard, TaskRecord } from "@/types/api";

interface ProductionPanelProps {
  prodTab: string;
  onOpenGrid?: (sb: Storyboard) => void;
  focusedShotId?: number | null;
  onFocusShot?: (shotId: number | null) => void;
  /** Used by the five-stage workbench to avoid leaking unrelated production steps. */
  allowedTabs?: readonly string[];
  showStepAction?: boolean;
  canvasEpisodeNumber?: number;
}

export function ProductionPanel({
  prodTab,
  onOpenGrid,
  focusedShotId,
  onFocusShot,
  allowedTabs,
  showStepAction = true,
  canvasEpisodeNumber,
}: ProductionPanelProps) {
  const wb = useWorkbench(
    useShallow((state) => ({
      characters: state.characters,
      scenes: state.scenes,
      storyboards: state.storyboards,
      running: state.running,
      runningType: state.runningType,
      pendingCharImages: state.pendingCharImages,
      pendingSceneImages: state.pendingSceneImages,
      pendingShotFrames: state.pendingShotFrames,
      pendingVideos: state.pendingVideos,
      pendingComposes: state.pendingComposes,
      lockedImageConfigLabel: state.lockedImageConfigLabel,
      lockedVideoConfigLabel: state.lockedVideoConfigLabel,
      lockedAudioConfigLabel: state.lockedAudioConfigLabel,
      openImageViewer: state.openImageViewer,
      goSubStep: state.goSubStep,
      batchCharImages: state.batchCharImages,
      genCharImg: state.genCharImg,
      batchSceneImages: state.batchSceneImages,
      genSceneImg: state.genSceneImg,
      batchShotTTS: state.batchShotTTS,
      genShotTTS: state.genShotTTS,
      genShotFrame: state.genShotFrame,
      batchShotVideos: state.batchShotVideos,
      genShotVideo: state.genShotVideo,
      batchCompose: state.batchCompose,
      composeShot: state.composeShot,
    })),
  );
  const visualCharacters = useMemo(
    () => wb.characters.filter(isVisualCharacter),
    [wb.characters],
  );
  const charImgCount = visualCharacters.filter((c) => !!c.image_url).length;
  const sceneImgCount = wb.scenes.filter((s) => !!s.image_url).length;
  const ttsEligibleCount = wb.storyboards.filter(
    (s) => !!getStoryboardTtsDialogue(s),
  ).length;
  const ttsGeneratedCount = wb.storyboards.filter(
    (s) => !!getStoryboardTtsDialogue(s) && !!s.tts_audio_url,
  ).length;
  const shotImgCount = wb.storyboards.filter(hasCompleteShotFrames).length;
  const shotVidCount = wb.storyboards.filter((s) => !!s.video_url).length;
  const composedCount = wb.storyboards.filter(
    (s) => !!s.composed_video_url,
  ).length;
  const prodTabs = [
    {
      id: "chars",
      label: "角色形象",
      icon: Users,
      badge: visualCharacters.length
        ? `${charImgCount}/${visualCharacters.length}`
        : "",
    },
    {
      id: "scenes",
      label: "场景图片",
      icon: MapPin,
      badge: wb.scenes.length ? `${sceneImgCount}/${wb.scenes.length}` : "",
    },
    {
      id: "dubbing",
      label: "配音生成",
      icon: Mic2,
      badge: ttsEligibleCount ? `${ttsGeneratedCount}/${ttsEligibleCount}` : "",
    },
    {
      id: "shots",
      label: "镜头图片",
      icon: ImageIcon,
      badge: wb.storyboards.length
        ? `${shotImgCount}/${wb.storyboards.length}`
        : "",
    },
    { id: "continuity", label: "连续性", icon: GitBranch, badge: "" },
    {
      id: "videos",
      label: "视频生成",
      icon: Video,
      badge: wb.storyboards.length
        ? `${shotVidCount}/${wb.storyboards.length}`
        : "",
    },
    {
      id: "compose",
      label: "视频合成",
      icon: Layers,
      badge: wb.storyboards.length
        ? `${composedCount}/${wb.storyboards.length}`
        : "",
    },
  ];
  const visibleTabs = allowedTabs
    ? prodTabs.filter((tab) => allowedTabs.includes(tab.id))
    : prodTabs;
  const shotFocusMode =
    focusedShotId != null && (prodTab === "shots" || prodTab === "videos");

  if (!wb.storyboards.length) {
    return (
      <div className="production-panel production-locked-panel">
        <div className="studio-locked-empty">
          <Clapperboard size={34} className="studio-locked-icon" />
          <div className="empty-title">尚未准备就绪</div>
          <div className="empty-desc">请先完成分镜拆解</div>
        </div>
        {showStepAction ? (
          <FloatingWorkbenchAction
            label="前往分镜"
            onClick={() => wb.goSubStep("script-storyboard")}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={cn("production-panel", shotFocusMode && "is-shot-focus-mode")}>
      <div className="production-toolbar">
        <div className="step-indicator">
          <Clapperboard size={14} />
          <span className="step-name">{shotFocusMode ? "镜头聚焦" : "制作工作台"}</span>
        </div>
        {visibleTabs.length > 1 && !shotFocusMode ? (
          <div className="prod-tabs">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  className={cn("prod-tab", prodTab === tab.id && "active")}
                  onClick={() => useWorkbench.setState({ prodTab: tab.id })}
                >
                  <Icon size={11} />
                  {tab.label}
                  {tab.badge && (
                    <span className="prod-tab-badge">{tab.badge}</span>
                  )}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* Tab content */}
      <div className="panel-scroll">
        {prodTab === "chars" && <CharsTab />}
        {prodTab === "scenes" && <ScenesTab />}
        {prodTab === "dubbing" && <DubbingTab />}
        {prodTab === "shots" && (
          <ShotsTab
            onOpenGrid={onOpenGrid}
            focusedShotId={focusedShotId}
            onFocusShot={onFocusShot}
            canvasEpisodeNumber={canvasEpisodeNumber}
          />
        )}
        {prodTab === "continuity" && <ContinuityTab />}
        {prodTab === "videos" && (
          <VideosTab
            focusedShotId={focusedShotId}
            onFocusShot={onFocusShot}
            canvasEpisodeNumber={canvasEpisodeNumber}
          />
        )}
        {prodTab === "compose" && <ComposeTab />}
      </div>
      {showStepAction ? <ProductionStepAction prodTab={prodTab} /> : null}
    </div>
  );
}

function FloatingWorkbenchAction({
  label,
  onClick,
  disabled = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="step-bubble">
      <button
        className="bubble-btn primary"
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
    </div>
  );
}

function ProductionStepAction({ prodTab }: { prodTab: string }) {
  const wb = useWorkbench();
  const nextMap: Record<string, { label: string; step: string }> = {
    chars: { label: "进入场景图", step: "prod-scenes" },
    scenes: { label: "进入配音生成", step: "prod-dubbing" },
    dubbing: { label: "进入镜头图片", step: "prod-shots" },
    shots: { label: "检查镜头连续性", step: "prod-continuity" },
    continuity: { label: "查看镜头视频", step: "prod-videos" },
    videos: { label: "进入视频合成", step: "prod-compose" },
    compose: { label: "合并成片", step: "export-merge" },
  };
  const next = nextMap[prodTab];
  if (!next) return null;
  return (
    <FloatingWorkbenchAction
      label={next.label}
      onClick={() => wb.goSubStep(next.step)}
    />
  );
}

function ConfigBadge({ label, value, compact = false }: { label: string; value: string; compact?: boolean }) {
  const isDefault =
    !value ||
    value === "未选择" ||
    value === "默认配置" ||
    value.startsWith("默认：");
  const displayValue = value.startsWith("默认：") ? value.slice(3) : value;

  if (compact) {
    return (
      <details
        className={cn("locked-config locked-config-details", isDefault && "is-default")}
        title={isDefault ? `${label}将使用当前默认配置` : `${label}：${value}`}
      >
        <summary>
          <Settings2 size={11} aria-hidden />
          <span className="locked-config-label">{label}</span>
          <span className="locked-config-default">默认</span>
        </summary>
        <span className="locked-config-value">{displayValue || "默认配置"}</span>
      </details>
    );
  }

  return (
    <span
      className={cn("locked-config", isDefault && "is-default")}
      title={
        isDefault
          ? `${label}未固定，将使用当前默认配置：${displayValue || "默认配置"}`
          : `${label}：${value}`
      }
    >
      <Settings2 size={11} aria-hidden />
      <span className="locked-config-label">{label}</span>
      {isDefault && <span className="locked-config-default">默认</span>}
      <span className="locked-config-value">{displayValue || "默认配置"}</span>
    </span>
  );
}

function isFailedWorkbenchTask(task: TaskRecord | null | undefined) {
  return !!task && ["failed", "canceled"].includes(String(task.status || ""));
}

function taskFailureCopy(task: TaskRecord) {
  if (task.status === "canceled") return "任务已取消，可以重新提交生成。";
  return getAiErrorCopy(new Error(task.error_message || "生成失败"));
}

function EntityTaskNotice({
  task,
  label,
  onRetry,
}: {
  task: TaskRecord | null | undefined;
  label: string;
  onRetry?: (taskId: number) => void;
}) {
  if (!task) return null;
  if (isActiveWorkbenchTask(task)) {
    return (
      <div className="entity-task-notice is-running">
        <Loader2 size={12} className="animate-spin" />
        <span>
          {label}正在{task.status === "queued" ? "排队" : "生成"}
          ，刷新后会自动恢复状态。
        </span>
      </div>
    );
  }
  if (!isFailedWorkbenchTask(task)) return null;
  return (
    <div className="entity-task-notice is-error">
      <AlertTriangle size={13} />
      <span className="entity-task-message">{taskFailureCopy(task)}</span>
      {onRetry ? (
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="panel-btn entity-task-retry"
          onClick={() => onRetry(task.id)}
        >
          <RefreshCw size={10} />
          重试
        </Button>
      ) : null}
    </div>
  );
}

type EpisodeProductionMode = "checking" | "continuity" | "legacy";

function useEpisodeProductionMode(
  episodeId: number | undefined,
  storyboardIds: string,
) {
  const [productionMode, setProductionMode] =
    useState<EpisodeProductionMode>("checking");

  useEffect(() => {
    let canceled = false;
    if (!episodeId) return;

    void episodeContinuityAPI
      .get(episodeId)
      .then((continuity) => {
        if (canceled) return;
        setProductionMode(
          continuity.storyboard_set_id != null &&
            listOrEmpty(continuity.boundaries).length > 0
            ? "continuity"
            : "legacy",
        );
      })
      .catch(() => {
        if (!canceled) setProductionMode("continuity");
      });

    return () => {
      canceled = true;
    };
  }, [episodeId, storyboardIds]);

  return episodeId ? productionMode : "legacy";
}

// ——————————————————————————————————————————————
// Chars Tab
// ——————————————————————————————————————————————
function CharsTab() {
  const wb = useWorkbench();
  const visualCharacters = wb.characters.filter(isVisualCharacter);
  const isBatchGenerating =
    wb.running && wb.runningType === "batch_char_images";

  const handleBatchGenerate = async () => {
    await wb.batchCharImages();
  };

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">
          {visualCharacters.length} 个需生成形象角色
        </span>
        <ConfigBadge label="图片配置" value={wb.lockedImageConfigLabel} />
        {wb.characters.length > visualCharacters.length && (
          <span className="tag">旁白仅保留声音</span>
        )}
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            disabled={visualCharacters.length === 0 || isBatchGenerating}
            onClick={handleBatchGenerate}
          >
            {isBatchGenerating ? (
              <Loader2 size={10} className="animate-spin" />
            ) : null}
            {isBatchGenerating ? "生成中..." : "批量生成"}
          </Button>
        </div>
      </div>

      {visualCharacters.length === 0 ? (
        <div className="step-empty">
          <Users size={32} className="mx-auto mb-2 opacity-50" />
          <div className="empty-title">暂无角色形象</div>
          <div className="empty-desc">暂无需生成形象的角色，请先提取角色</div>
        </div>
      ) : (
        <div className="asset-grid">
          {visualCharacters.map((c) => {
            const task = wb.entityTasks[`character-image:${c.id}`];
            const isPending =
              wb.pendingCharImages.has(c.id) || isActiveWorkbenchTask(task);
            const isFailed = isFailedWorkbenchTask(task);
            const imageSrc = staticUrl(c.image_url);
            return (
              <div key={c.id} className="card asset-card">
                <div className="asset-cover relative">
                  {c.image_url ? (
                    <img
                      src={imageSrc}
                      className="previewable-image"
                      onClick={() =>
                        wb.openImageViewer(imageSrc, `${c.name} 角色形象`)
                      }
                      alt={c.name}
                    />
                  ) : (
                    <div className="asset-cover-empty">
                      <Users size={24} />
                    </div>
                  )}
                  <span
                    className={cn(
                      "asset-cover-badge",
                      isFailed
                        ? "is-error"
                        : c.image_url
                          ? "is-ready"
                          : isPending
                            ? "is-pending"
                            : "",
                    )}
                  >
                    {isFailed
                      ? "生成失败"
                      : c.image_url
                        ? "已生成"
                        : isPending
                          ? "生成中"
                          : "待生成"}
                  </span>
                </div>
                <div className="asset-body">
                  <div className="asset-name">{c.name}</div>
                  <div className="asset-meta">{c.role || "角色"}</div>
                </div>
                <div className="asset-foot">
                  <span
                    className={cn(
                      "dot",
                      c.image_url && "ok",
                      isPending && "pending",
                      isFailed && "error",
                    )}
                  />
                  <span className="asset-foot-status">
                    {isFailed
                      ? "生成失败"
                      : c.image_url
                        ? "已生成"
                        : isPending
                          ? "生成中"
                          : "待生成"}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="panel-btn ml-auto"
                    disabled={isPending}
                    onClick={() =>
                      isFailed && task
                        ? wb.retryEntityTask(task.id)
                        : wb.genCharImg(c.id)
                    }
                  >
                    {isPending
                      ? "生成中"
                      : isFailed
                        ? "重试"
                        : c.image_url
                          ? "重新生成"
                          : "生成"}
                  </Button>
                </div>
                <EntityTaskNotice
                  task={task}
                  label="角色图"
                  onRetry={wb.retryEntityTask}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ——————————————————————————————————————————————
// Scenes Tab
// ——————————————————————————————————————————————
function ScenesTab() {
  const wb = useWorkbench();
  const isBatchGenerating =
    wb.running && wb.runningType === "batch_scene_images";

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">{wb.scenes.length} 个场景</span>
        <ConfigBadge label="图片配置" value={wb.lockedImageConfigLabel} />
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            disabled={wb.scenes.length === 0 || isBatchGenerating}
            onClick={() => wb.batchSceneImages()}
          >
            {isBatchGenerating ? (
              <Loader2 size={10} className="animate-spin" />
            ) : null}
            {isBatchGenerating ? "生成中..." : "批量生成"}
          </Button>
        </div>
      </div>

      {wb.scenes.length === 0 ? (
        <div className="step-empty">
          <MapPin size={32} className="mx-auto mb-2 opacity-50" />
          <div className="empty-title">暂无场景图片</div>
          <div className="empty-desc">暂无场景，请先提取场景</div>
        </div>
      ) : (
        <div className="asset-grid">
          {wb.scenes.map((s) => {
            const task = wb.entityTasks[`scene-image:${s.id}`];
            const isPending =
              wb.pendingSceneImages.has(s.id) || isActiveWorkbenchTask(task);
            const isFailed = isFailedWorkbenchTask(task);
            const imageSrc = staticUrl(s.image_url);
            return (
              <div key={s.id} className="card asset-card">
                <div className="asset-cover wide relative">
                  {s.image_url ? (
                    <img
                      src={imageSrc}
                      className="previewable-image"
                      onClick={() =>
                        wb.openImageViewer(imageSrc, `${s.location} 场景图`)
                      }
                      alt={s.location || "场景"}
                    />
                  ) : (
                    <div className="asset-cover-empty">
                      <MapPin size={24} />
                    </div>
                  )}
                  <span
                    className={cn(
                      "asset-cover-badge",
                      isFailed
                        ? "is-error"
                        : s.image_url
                          ? "is-ready"
                          : isPending
                            ? "is-pending"
                            : "",
                    )}
                  >
                    {isFailed
                      ? "生成失败"
                      : s.image_url
                        ? "已生成"
                        : isPending
                          ? "生成中"
                          : "待生成"}
                  </span>
                </div>
                <div className="asset-body">
                  <div className="asset-name">{s.location}</div>
                  <div className="asset-meta">{s.time || "—"}</div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="w-full mt-2 panel-btn"
                    disabled={isPending}
                    onClick={() =>
                      isFailed && task
                        ? wb.retryEntityTask(task.id)
                        : wb.genSceneImg(s.id)
                    }
                  >
                    {isPending ? (
                      <>
                        <Loader2 size={10} className="animate-spin" /> 生成中...
                      </>
                    ) : isFailed ? (
                      "重试场景图"
                    ) : s.image_url ? (
                      "重新生成场景图"
                    ) : (
                      "生成场景图"
                    )}
                  </Button>
                </div>
                <EntityTaskNotice
                  task={task}
                  label="场景图"
                  onRetry={wb.retryEntityTask}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ——————————————————————————————————————————————
// Dubbing Tab
// ——————————————————————————————————————————————
function DubbingTab() {
  const wb = useWorkbench();
  const ttsEligible = wb.storyboards.filter(
    (s) => !!getStoryboardTtsDialogue(s),
  );
  const isBatchGenerating = wb.running && wb.runningType === "batch_tts";

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">{ttsEligible.length} 条对白可配音</span>
        <ConfigBadge label="配音配置" value={wb.lockedAudioConfigLabel} />
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            disabled={ttsEligible.length === 0 || isBatchGenerating}
            onClick={() => wb.batchShotTTS()}
          >
            {isBatchGenerating ? (
              <Loader2 size={10} className="animate-spin" />
            ) : null}
            {isBatchGenerating ? "生成中..." : "批量配音"}
          </Button>
        </div>
      </div>

      {ttsEligible.length === 0 ? (
        <div className="step-empty">
          <Mic2 size={32} className="mx-auto mb-2 opacity-50" />
          <div className="empty-title">当前没有可生成的配音</div>
          <div className="empty-desc">先在分镜里填写对白内容</div>
        </div>
      ) : (
        <div className="dub-grid">
          {ttsEligible.map((sb) => {
            const dialogue = getStoryboardTtsDialogue(sb);
            const task = wb.entityTasks[`shot-tts:${sb.id}`];
            const isPending =
              wb.pendingShotTts.has(sb.id) || isActiveWorkbenchTask(task);
            const isFailed = isFailedWorkbenchTask(task);
            return (
              <div key={sb.id} className="card dub-card">
                <div className="dub-head">
                  <span className="shot-num">
                    #{String(sb.storyboard_number).padStart(2, "0")}
                  </span>
                  <div className="dub-copy">
                    <div className="asset-meta">
                      {dialogue.split("：")[0] || "旁白"}
                    </div>
                    <div className="dub-desc">{dialogue}</div>
                  </div>
                  <div className="dub-meta">
                    <span
                      className={cn(
                        "asset-cover-badge",
                        isFailed
                          ? "is-error"
                          : sb.tts_audio_url
                            ? "is-ready"
                            : isPending
                              ? "is-pending"
                              : "",
                      )}
                    >
                      {isFailed
                        ? "生成失败"
                        : sb.tts_audio_url
                          ? "已生成"
                          : isPending
                            ? "生成中"
                            : "待生成"}
                    </span>
                  </div>
                </div>
                <div className="dub-foot">
                  {sb.tts_audio_url ? (
                    <audio
                      src={staticUrl(sb.tts_audio_url)}
                      controls
                      className="dub-audio"
                      preload="none"
                    />
                  ) : null}
                  {!sb.tts_audio_url || isFailed ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="panel-btn"
                      disabled={isPending}
                      onClick={() =>
                        isFailed && task
                          ? wb.retryEntityTask(task.id)
                          : wb.genShotTTS(sb)
                      }
                    >
                      {isPending ? (
                        <>
                          <Loader2 size={10} className="animate-spin" />{" "}
                          生成中...
                        </>
                      ) : isFailed ? (
                        "重试配音"
                      ) : (
                        "生成配音"
                      )}
                    </Button>
                  ) : null}
                </div>
                <EntityTaskNotice
                  task={task}
                  label="配音"
                  onRetry={wb.retryEntityTask}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ——————————————————————————————————————————————
// Shots Tab
// ——————————————————————————————————————————————
function ShotsTab({
  onOpenGrid,
  focusedShotId,
  onFocusShot,
  canvasEpisodeNumber,
}: {
  onOpenGrid?: (sb: Storyboard) => void;
  focusedShotId?: number | null;
  onFocusShot?: (shotId: number | null) => void;
  canvasEpisodeNumber?: number;
}) {
  return (
    <ShotProductionWorkspace
      kind="frames"
      focusedShotId={focusedShotId}
      onFocusShot={onFocusShot}
      onOpenGrid={onOpenGrid}
      canvasEpisodeNumber={canvasEpisodeNumber}
    />
  );
}

type ShotProductionKind = "frames" | "video";
type ShotProductionStatus = "rework" | "pending" | "missing" | "confirmed";

type ShotProductionItem = {
  storyboard: Storyboard;
  index: number;
  status: ShotProductionStatus;
  statusLabel: string;
  task: TaskRecord | null;
  firstFrameTask?: TaskRecord | null;
  lastFrameTask?: TaskRecord | null;
  firstFrame?: string | null;
  lastFrame?: string | null;
  video?: string | null;
};

const SHOT_STATUS_ORDER: Record<ShotProductionStatus, number> = {
  rework: 0,
  pending: 1,
  missing: 2,
  confirmed: 3,
};

function getShotProductionItems(
  kind: ShotProductionKind,
  storyboards: Storyboard[],
  pendingFrames: Map<number, string>,
  pendingVideos: Set<number>,
  entityTasks: Record<string, TaskRecord>,
) {
  return storyboards
    .map<ShotProductionItem>((storyboard, index) => {
      if (kind === "frames") {
        const firstFrame = storyboard.first_frame_image || storyboard.composed_image;
        const lastFrame = storyboard.last_frame_image || storyboard.composed_image;
        const firstFrameTask = entityTasks[`shot-frame:${storyboard.id}:first_frame`] ?? null;
        const lastFrameTask = entityTasks[`shot-frame:${storyboard.id}:last_frame`] ?? null;
        const hasFailedTask =
          isFailedWorkbenchTask(firstFrameTask) || isFailedWorkbenchTask(lastFrameTask);
        const isPending =
          pendingFrames.has(storyboard.id) ||
          isActiveWorkbenchTask(firstFrameTask) ||
          isActiveWorkbenchTask(lastFrameTask);
        const complete = Boolean(firstFrame && lastFrame);
        const status: ShotProductionStatus = hasFailedTask
          ? "rework"
          : isPending
            ? "pending"
            : complete
              ? "confirmed"
              : "missing";
        const missingFrames = [
          !firstFrame ? "首帧" : null,
          !lastFrame ? "尾帧" : null,
        ].filter(Boolean);

        return {
          storyboard,
          index,
          status,
          statusLabel:
            status === "rework"
              ? "需重做"
              : status === "pending"
                ? "生成中"
                : status === "missing"
                  ? `缺${missingFrames.join("、")}`
                  : "画面齐全",
          task: firstFrameTask || lastFrameTask,
          firstFrameTask,
          lastFrameTask,
          firstFrame,
          lastFrame,
        };
      }

      const task = entityTasks[`shot-video:${storyboard.id}`] ?? null;
      const isPending =
        pendingVideos.has(storyboard.id) ||
        storyboard.status === "video_queued" ||
        storyboard.status === "video_processing" ||
        isActiveWorkbenchTask(task);
      const failed =
        isFailedWorkbenchTask(task) || storyboard.status === "video_failed";
      const status: ShotProductionStatus = failed
        ? "rework"
        : isPending
          ? "pending"
          : storyboard.video_url
            ? "confirmed"
            : "missing";
      return {
        storyboard,
        index,
        status,
        statusLabel:
          status === "rework"
            ? "需重做"
            : status === "pending"
              ? "生成中"
              : status === "missing"
                ? "缺视频"
                : "视频就绪",
        task,
        video: storyboard.video_url,
      };
    })
    .sort(
      (left, right) =>
        SHOT_STATUS_ORDER[left.status] - SHOT_STATUS_ORDER[right.status] ||
        left.index - right.index,
    );
}

function ShotProductionWorkspace({
  kind,
  focusedShotId,
  onFocusShot,
  onOpenGrid,
  isContinuityProduction = false,
  onOpenContinuity,
  canvasEpisodeNumber,
}: {
  kind: ShotProductionKind;
  focusedShotId?: number | null;
  onFocusShot?: (shotId: number | null) => void;
  onOpenGrid?: (sb: Storyboard) => void;
  isContinuityProduction?: boolean;
  onOpenContinuity?: () => void;
  canvasEpisodeNumber?: number;
}) {
  const wb = useWorkbench();
  const [selectedShotId, setSelectedShotId] = useState<number | null>(
    focusedShotId ?? null,
  );
  const [dismissedShotId, setDismissedShotId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [isBatchSubmitting, setIsBatchSubmitting] = useState(false);
  const [focusListState, setFocusListState] = useState<{
    shotId: number | null;
    open: boolean;
  }>({ shotId: focusedShotId ?? null, open: false });
  const items = useMemo(
    () =>
      getShotProductionItems(
        kind,
        wb.storyboards,
        wb.pendingShotFrames,
        wb.pendingVideos,
        wb.entityTasks,
      ),
    [
      kind,
      wb.entityTasks,
      wb.pendingShotFrames,
      wb.pendingVideos,
      wb.storyboards,
    ],
  );
  const focusedItem =
    (focusedShotId != null &&
      focusedShotId !== dismissedShotId &&
      items.find((item) => item.storyboard.id === focusedShotId)) ||
    null;
  const isFocusMode = Boolean(focusedItem);
  const selectedItem = focusedItem ?? (
    dismissedShotId == null
      ? items.find((item) => item.storyboard.id === selectedShotId) ?? items[0] ?? null
      : null
  );
  const selectedItems = items.filter((item) => selectedIds.has(item.storyboard.id));
  const canBatchGenerate =
    selectedItems.length > 1 &&
    selectedItems.every((item) => item.status === "missing") &&
    !isContinuityProduction;
  const completedCount = items.filter((item) => item.status === "confirmed").length;
  const focusListOpen =
    isFocusMode &&
    focusListState.open &&
    focusListState.shotId === focusedItem?.storyboard.id;

  const focusItem = useCallback(
    (item: ShotProductionItem) => {
      setDismissedShotId(null);
      setSelectedShotId(item.storyboard.id);
      onFocusShot?.(item.storyboard.id);
    },
    [onFocusShot],
  );
  const toggleSelection = useCallback((shotId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });
  }, []);
  const generateFrames = useCallback(
    async (item: ShotProductionItem) => {
      if (item.firstFrameTask && isFailedWorkbenchTask(item.firstFrameTask)) {
        await wb.retryEntityTask(item.firstFrameTask.id);
      } else if (!item.firstFrame) {
        await wb.genShotFrame(item.storyboard, "first_frame");
      }
      if (item.lastFrameTask && isFailedWorkbenchTask(item.lastFrameTask)) {
        await wb.retryEntityTask(item.lastFrameTask.id);
      } else if (!item.lastFrame) {
        await wb.genShotFrame(item.storyboard, "last_frame");
      }
    },
    [wb],
  );
  const generateVideo = useCallback(
    async (item: ShotProductionItem) => {
      if (item.task && isFailedWorkbenchTask(item.task)) {
        await wb.retryEntityTask(item.task.id);
        return;
      }
      await wb.genShotVideo(item.storyboard);
    },
    [wb],
  );
  const batchGenerate = useCallback(async () => {
    const dramaId = wb.drama?.id;
    const episodeId = wb.episode?.id;
    if (!canBatchGenerate || !dramaId || !episodeId) return;
    setIsBatchSubmitting(true);
    try {
      const target: DramaShotTarget = kind === "frames" ? "first_frame" : "video";
      const body = {
        episode_id: episodeId,
        storyboard_ids: selectedItems.map((item) => item.storyboard.id),
        targets: [target],
      };
      const preview = await dramaWorkspaceAPI.previewShotBatch(dramaId, body);
      if (preview.summary.create !== selectedItems.length) {
        toast.warning("所选镜头状态已变化", {
          description: `可生成 ${preview.summary.create} 个；请刷新后重新选择。`,
        });
        return;
      }
      const result = await dramaWorkspaceAPI.generateShotBatch(dramaId, body);
      toast.success("已提交批量生成", {
        description: `${result.created} 个镜头已加入制作队列。`,
      });
      setSelectedIds(new Set());
    } catch (error) {
      toast.error("批量生成未能提交", { description: getAiErrorCopy(error) });
    } finally {
      setIsBatchSubmitting(false);
    }
  }, [canBatchGenerate, kind, selectedItems, wb.drama?.id, wb.episode?.id]);

  if (!items.length) {
    return (
      <div className="step-empty">
        {kind === "frames" ? <ImageIcon size={32} /> : <Video size={32} />}
        <div className="empty-title">暂无可制作镜头</div>
        <div className="empty-desc">请先完成分镜拆解。</div>
      </div>
    );
  }

  return (
    <div className={cn("shot-production-workspace", isFocusMode && "is-focus-mode")}>
      <div className="shot-production-toolbar">
        <div>
          <strong>{isFocusMode ? `镜头 ${String(focusedItem!.index + 1).padStart(2, "0")}` : kind === "frames" ? "镜头画面" : "镜头视频"}</strong>
          <span>
            {isFocusMode
              ? focusedItem!.statusLabel
              : `${completedCount}/${items.length} 已就绪，优先显示需处理镜头`}
          </span>
        </div>
        {isFocusMode ? (
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            onClick={() =>
              setFocusListState((current) => {
                const shotId = focusedItem?.storyboard.id ?? null;
                return {
                  shotId,
                  open: current.shotId === shotId ? !current.open : true,
                };
              })
            }
          >
            {focusListOpen ? "收起镜头列表" : "查看本集镜头"}
          </Button>
        ) : selectedIds.size > 0 ? (
          <span className="shot-selection-count">已选 {selectedIds.size} 个</span>
        ) : null}
      </div>

      {!isFocusMode && canBatchGenerate ? (
        <div className="shot-batch-bar" role="status">
          <span>已选择 {selectedItems.length} 个缺失镜头</span>
          <Button
            size="sm"
            className="panel-btn panel-btn-primary"
            disabled={isBatchSubmitting}
            onClick={() => void batchGenerate()}
          >
            {isBatchSubmitting ? <Loader2 size={12} className="animate-spin" /> : null}
            {kind === "frames" ? "生成缺失首帧" : "生成视频"}
          </Button>
        </div>
      ) : null}

      {!isFocusMode && selectedIds.size > 1 && !canBatchGenerate ? (
        <div className="shot-selection-hint" role="status">
          批量操作仅适用于多个同类、待生成的镜头。
        </div>
      ) : null}

      {!isFocusMode && isContinuityProduction ? (
        <section className="continuity-ready" aria-label="连续视频生产入口">
          <GitBranch size={16} />
          <span>本集已启用镜头交接。请先检查连续性，再按交接顺序生成。</span>
          <Button size="sm" variant="ghost" className="panel-btn ml-auto" onClick={onOpenContinuity}>
            检查连续性
          </Button>
        </section>
      ) : null}

      <div className="shot-production-layout">
        {!isFocusMode || focusListOpen ? <div className="shot-production-list" aria-label={kind === "frames" ? "镜头画面列表" : "镜头视频列表"}>
          {items.map((item) => (
            <article
              key={item.storyboard.id}
              className={cn(
                "shot-production-card",
                `is-${item.status}`,
                selectedShotId === item.storyboard.id && "is-active",
              )}
            >
              <label className="shot-selection-control" onClick={(event) => event.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedIds.has(item.storyboard.id)}
                  onChange={() => toggleSelection(item.storyboard.id)}
                  aria-label={`选择镜头 ${item.index + 1}`}
                />
              </label>
              <button type="button" className="shot-production-card-main" onClick={() => focusItem(item)}>
                <ShotProductionThumbnail item={item} kind={kind} />
                <span className="shot-production-card-copy">
                  <span className="shot-production-card-title">镜头 {String(item.index + 1).padStart(2, "0")}</span>
                  <span className="shot-production-card-desc">{item.storyboard.description || item.storyboard.action || "未填写镜头说明"}</span>
                </span>
                <ShotProductionStatus status={item.status} label={item.statusLabel} />
              </button>
            </article>
          ))}
        </div> : null}

        <aside className="shot-production-inspector" aria-label="镜头检查器">
          {selectedItem ? (
            <ShotProductionInspector
              item={selectedItem}
              kind={kind}
              dramaId={wb.drama?.id}
              episodeId={wb.episode?.id}
              episodeNumber={canvasEpisodeNumber}
              isContinuityProduction={isContinuityProduction}
              onOpenContinuity={onOpenContinuity}
              onOpenGrid={onOpenGrid}
              onClose={() => {
                setDismissedShotId(selectedItem.storyboard.id);
                setSelectedShotId(null);
                onFocusShot?.(null);
              }}
              onGenerate={() =>
                kind === "frames"
                  ? void generateFrames(selectedItem)
                  : void generateVideo(selectedItem)
              }
            />
          ) : (
            <div className="shot-inspector-empty">选择一个镜头查看详情</div>
          )}
        </aside>
      </div>
    </div>
  );
}

function ShotProductionThumbnail({ item, kind }: { item: ShotProductionItem; kind: ShotProductionKind }) {
  if (kind === "video" && item.video) {
    return <video src={staticUrl(item.video)} muted playsInline preload="metadata" />;
  }
  const preview = item.firstFrame || item.lastFrame;
  return preview ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={staticUrl(preview)} alt="" />
  ) : kind === "frames" ? (
    <ImageIcon size={16} aria-hidden="true" />
  ) : (
    <Video size={16} aria-hidden="true" />
  );
}

function ShotProductionStatus({ status, label }: { status: ShotProductionStatus; label: string }) {
  const Icon = status === "rework" ? CircleAlert : status === "pending" ? Clock3 : CheckCircle2;
  return <span className={cn("shot-production-status", `is-${status}`)}><Icon size={12} aria-hidden="true" />{label}</span>;
}

function ShotProductionInspector({
  item,
  kind,
  dramaId,
  episodeId,
  episodeNumber,
  isContinuityProduction,
  onOpenContinuity,
  onOpenGrid,
  onClose,
  onGenerate,
}: {
  item: ShotProductionItem;
  kind: ShotProductionKind;
  dramaId?: number;
  episodeId?: number;
  episodeNumber?: number;
  isContinuityProduction: boolean;
  onOpenContinuity?: () => void;
  onOpenGrid?: (sb: Storyboard) => void;
  onClose: () => void;
  onGenerate: () => void;
}) {
  const { storyboard } = item;
  const running = item.status === "pending";
  const primaryLabel =
    item.status === "rework"
      ? "重新生成"
      : item.status === "confirmed"
        ? "重新生成"
        : "开始生成";
  const canvasHref = dramaId
    ? `/drama/${dramaId}/canvas?episode=${episodeId ?? ""}&episodeNumber=${episodeNumber ?? ""}&stage=${kind === "frames" ? "assets" : "video"}&shot=${storyboard.id}&origin=episode-workbench`
    : null;

  return (
    <div className="shot-inspector-content">
      <div className="shot-inspector-header">
        <div>
          <span>镜头 {String(item.index + 1).padStart(2, "0")}</span>
          <ShotProductionStatus status={item.status} label={item.statusLabel} />
        </div>
        <button type="button" className="shot-inspector-close" onClick={onClose} aria-label="关闭镜头检查器">
          <X size={16} />
        </button>
      </div>
      <ShotInspectorPreview item={item} kind={kind} />
      <p className="shot-inspector-description">{storyboard.description || storyboard.action || "尚未填写镜头说明。"}</p>
      <dl className="shot-inspector-details">
        <div><dt>来源</dt><dd>{[storyboard.location, storyboard.time, storyboard.shot_type].filter(Boolean).join(" · ") || "本集分镜"}</dd></div>
        <div><dt>关联</dt><dd>{storyboard.characters?.map((character) => character.name).filter(Boolean).join("、") || "未关联角色"}</dd></div>
        <div><dt>版本</dt><dd>{storyboard.updated_at ? new Date(storyboard.updated_at).toLocaleString("zh-CN", { hour12: false }) : "当前版本"}</dd></div>
        <div><dt>任务</dt><dd>{running ? "正在生成" : item.status === "rework" ? "上次生成未完成，请重新处理" : item.status === "confirmed" ? "当前产物已就绪" : "尚未提交"}</dd></div>
      </dl>
      <div className="shot-inspector-actions">
        {isContinuityProduction ? (
          <Button size="sm" className="panel-btn panel-btn-primary" onClick={onOpenContinuity}>检查连续性</Button>
        ) : (
          <Button size="sm" className="panel-btn panel-btn-primary" disabled={running} onClick={onGenerate}>
            {running ? <Loader2 size={12} className="animate-spin" /> : item.status === "rework" ? <RefreshCw size={12} /> : null}
            {running ? "生成中" : primaryLabel}
          </Button>
        )}
        {kind === "frames" && onOpenGrid ? <Button size="sm" variant="ghost" className="panel-btn" onClick={() => onOpenGrid(storyboard)}>制作画面</Button> : null}
        {canvasHref ? <Link className="shot-inspector-link" href={canvasHref}>在画布中打开</Link> : null}
      </div>
      <p className="shot-inspector-note">媒体确认与需重做标记在项目素材中统一处理，避免镜头页与素材页出现两套审核状态。</p>
    </div>
  );
}

function ShotInspectorPreview({ item, kind }: { item: ShotProductionItem; kind: ShotProductionKind }) {
  if (kind === "video") {
    return item.video ? <video className="shot-inspector-preview" src={staticUrl(item.video)} controls playsInline preload="metadata" /> : <div className="shot-inspector-preview is-empty"><Video size={24} /></div>;
  }
  return (
    <div className="shot-inspector-frame-preview">
      <InspectorImage src={item.firstFrame} label="首帧" />
      <InspectorImage src={item.lastFrame} label="尾帧" />
    </div>
  );
}

function InspectorImage({ src, label }: { src?: string | null; label: string }) {
  return (
    <figure>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={staticUrl(src)} alt={label} />
      ) : <div><ImageIcon size={20} /></div>}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

// ——————————————————————————————————————————————
// Continuity Tab
// ——————————————————————————————————————————————
function dialogueTakeStatusLabel(status: string) {
  const labels: Record<string, string> = {
    planned: "等待生成",
    queued: "等待生成",
    generating: "正在生成",
    alignment_review_required: "对白时间需要确认",
    cue_review_required: "对白时间需要确认",
    approved_for_mix: "已确认可合成",
    stale: "需要重新确认",
    failed: "生成失败",
    canceled: "已取消",
  };
  return labels[status] || status;
}

function editRevisionStatusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "待确认",
    approved: "已确认，等待渲染",
    rendering: "正在渲染",
    completed: "已完成",
    failed: "渲染失败",
    stale: "需要重新确认",
  };
  return labels[status] || status;
}

function formatDurationMs(value: number | null) {
  if (value == null || !Number.isFinite(value)) return "时长待确认";
  const seconds = value / 1_000;
  return seconds < 60
    ? `${seconds.toFixed(seconds >= 10 ? 1 : 2)} 秒`
    : `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
}

function readCueDraftNumber(
  value: string | number | undefined,
  fallback: number | null,
) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function listOrEmpty<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function ContinuityTab() {
  const wb = useWorkbench();
  const episodeId = wb.episode?.id;
  const [continuity, setContinuity] = useState<EpisodeContinuityPayload | null>(
    null,
  );
  const [preflight, setPreflight] = useState<EpisodeContinuityPreflight | null>(
    null,
  );
  const [run, setRun] = useState<EpisodeContinuityRun | null>(null);
  const [dialoguePreview, setDialoguePreview] =
    useState<EpisodeDialogueTakePreview | null>(null);
  const [dialogueTakes, setDialogueTakes] = useState<EpisodeDialogueTake[]>(
    [],
  );
  const [editPreview, setEditPreview] =
    useState<EpisodeEditRevisionPreview | null>(null);
  const [editRevisions, setEditRevisions] = useState<EpisodeEditRevision[]>(
    [],
  );
  const [audioPolicies, setAudioPolicies] = useState<Record<string, string>>(
    {},
  );
  const [cueDrafts, setCueDrafts] = useState<
    Record<
      number,
      Partial<{
        take_in_ms: string | number;
        take_out_ms: string | number;
        timeline_in_ms: string | number;
      }>
    >
  >({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [m3Action, setM3Action] = useState<string | null>(null);
  const [m3LoadError, setM3LoadError] = useState<string | null>(null);
  const [reviewingBoundaryId, setReviewingBoundaryId] = useState<number | null>(
    null,
  );
  const [editingBoundary, setEditingBoundary] =
    useState<EpisodeContinuityBoundary | null>(null);
  const [actionHandoffDraft, setActionHandoffDraft] = useState("");
  const activeRunId = run?.id;
  const activeRunStatus = run?.status;

  const refreshM3 = useCallback(async () => {
    if (!episodeId) return;
    const [nextTakes, nextRevisions] = await Promise.all([
      episodeContinuityAPI.getDialogueTakes(episodeId),
      episodeContinuityAPI.getEditRevisions(episodeId),
    ]);
    setDialogueTakes(listOrEmpty(nextTakes.takes));
    setEditRevisions(listOrEmpty(nextRevisions.revisions));
    setM3LoadError(null);
  }, [episodeId]);

  const refresh = useCallback(async () => {
    if (!episodeId) return;
    setLoading(true);
    try {
      const [nextContinuity, nextPreflight, nextRun] = await Promise.all([
        episodeContinuityAPI.get(episodeId),
        episodeContinuityAPI.preflight(episodeId),
        episodeContinuityAPI.getLatestRun(episodeId),
      ]);
      setContinuity(nextContinuity);
      setPreflight(nextPreflight);
      setRun(nextRun);
      try {
        await refreshM3();
      } catch (error) {
        setM3LoadError(getAiErrorCopy(error));
      }
    } catch (error) {
      toast.error("无法读取镜头连续性", { description: getAiErrorCopy(error) });
    } finally {
      setLoading(false);
    }
  }, [episodeId, refreshM3]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (
      !episodeId ||
      !activeRunId ||
      !activeRunStatus ||
      !["queued", "running"].includes(activeRunStatus)
    )
      return;
    const timer = window.setInterval(() => {
      void episodeContinuityAPI
        .getRun(episodeId, activeRunId)
        .then((nextRun) => {
          setRun(nextRun);
          if (!["queued", "running"].includes(nextRun.status)) {
            void Promise.all([
              refresh(),
              episodeAPI.storyboards(episodeId).then((storyboards) => {
                useWorkbench.setState({ storyboards: storyboards || [] });
              }),
            ]);
          }
        })
        .catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [activeRunId, activeRunStatus, episodeId, refresh]);

  useEffect(() => {
    if (!episodeId) return;
    const hasActiveDialogue = dialogueTakes.some((take) =>
      ["planned", "queued", "generating"].includes(take.status),
    );
    const hasActiveRender = editRevisions.some(
      (revision) => revision.status === "rendering",
    );
    if (!hasActiveDialogue && !hasActiveRender) return;
    const timer = window.setInterval(() => {
      void refreshM3().catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [dialogueTakes, editRevisions, episodeId, refreshM3]);

  const preview = async () => {
    if (!episodeId) return;
    setSubmitting(true);
    try {
      const next = await episodeContinuityAPI.previewRun(episodeId);
      setPreflight(next);
      toast.success(next.ready ? "连续性检查通过" : "请先处理连续性问题");
    } catch (error) {
      toast.error("连续性检查失败", { description: getAiErrorCopy(error) });
    } finally {
      setSubmitting(false);
    }
  };

  const createRun = async () => {
    if (!episodeId) return;
    setSubmitting(true);
    try {
      const created = await episodeContinuityAPI.createRun(episodeId);
      setRun(created.run);
      await refresh();
      toast.success("已开始生成本集连续视频");
    } catch (error) {
      toast.error("无法开始连续视频生成", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRun = async () => {
    if (!episodeId || !run) return;
    setSubmitting(true);
    try {
      const canceled = await episodeContinuityAPI.cancelRun(episodeId, run.id);
      setRun(canceled);
      toast.success("已停止后续连续镜头生成");
    } catch (error) {
      toast.error("取消连续视频生成失败", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const retryRun = async () => {
    if (!episodeId || !run) return;
    setSubmitting(true);
    try {
      const retried = await episodeContinuityAPI.retryRun(episodeId, run.id);
      setRun(retried);
      await refresh();
      toast.success("已从失败镜头继续生成");
    } catch (error) {
      toast.error("无法重试失败镜头", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setSubmitting(false);
    }
  };

  const reviewBoundary = async (
    boundaryId: number,
    decision: "approve" | "rework",
  ) => {
    if (!episodeId) return;
    setReviewingBoundaryId(boundaryId);
    try {
      const next = await episodeContinuityAPI.reviewBoundary(
        episodeId,
        boundaryId,
        { decision },
      );
      setContinuity(next);
      toast.success(
        decision === "approve" ? "已通过这一处交接" : "已标记为需要重做",
      );
    } catch (error) {
      toast.error("更新交接审核失败", { description: getAiErrorCopy(error) });
    } finally {
      setReviewingBoundaryId(null);
    }
  };

  const toggleBoundaryRelation = async (
    boundary: EpisodeContinuityBoundary,
  ) => {
    if (!episodeId) return;
    const nextRelation =
      boundary.relation_type === "continuous"
        ? "intentional_cut"
        : "continuous";
    const nextTransition = [
      "hard_cut",
      "match_cut",
      "dissolve",
      "fade",
    ].includes(boundary.transition_type)
      ? (boundary.transition_type as
          | "hard_cut"
          | "match_cut"
          | "dissolve"
          | "fade")
      : "hard_cut";
    setReviewingBoundaryId(boundary.id);
    try {
      const next = await episodeContinuityAPI.updateBoundary(
        episodeId,
        boundary.id,
        {
          relation_type: nextRelation,
          transition_type:
            nextRelation === "intentional_cut"
              ? "hard_cut"
              : nextTransition,
        },
      );
      setContinuity(next);
      await refresh();
      toast.success(
        nextRelation === "continuous"
          ? "已改为连续承接，请重新检查生产条件"
          : "已改为有意跳转，请重新检查生产条件",
      );
    } catch (error) {
      toast.error("无法更新镜头交接关系", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setReviewingBoundaryId(null);
    }
  };

  const openHandoffEditor = (boundary: EpisodeContinuityBoundary) => {
    setEditingBoundary(boundary);
    setActionHandoffDraft(
      String(boundary.handoff?.action_handoff || "").trim(),
    );
  };

  const closeHandoffEditor = (open: boolean) => {
    if (open || reviewingBoundaryId === editingBoundary?.id) return;
    setEditingBoundary(null);
    setActionHandoffDraft("");
  };

  const saveActionHandoff = async () => {
    if (!episodeId || !editingBoundary || isRunActive) return;
    const actionHandoff = actionHandoffDraft.trim();
    if (!actionHandoff) {
      toast.error(
        editingBoundary.relation_type === "continuous"
          ? "请补充连续镜头的动作交接说明"
          : "请补充有意跳转的叙事或剪辑意图",
      );
      return;
    }

    setReviewingBoundaryId(editingBoundary.id);
    try {
      const next = await episodeContinuityAPI.updateBoundary(
        episodeId,
        editingBoundary.id,
        {
          handoff: {
            ...editingBoundary.handoff,
            action_handoff: actionHandoff,
          },
        },
      );
      setContinuity(next);
      setEditingBoundary(null);
      setActionHandoffDraft("");
      await refresh();
      toast.success("交接说明已保存，请重新检查生产条件");
    } catch (error) {
      toast.error("无法保存交接说明", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setReviewingBoundaryId(null);
    }
  };

  const previewDialogue = async () => {
    if (!episodeId) return;
    setM3Action("preview-dialogue");
    try {
      const next = await episodeContinuityAPI.previewDialogueTakes(episodeId);
      setDialoguePreview(next);
      toast.success(
        next.ready ? "已生成对白表演计划" : "请先处理对白表演条件",
      );
    } catch (error) {
      toast.error("无法预览对白表演", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setM3Action(null);
    }
  };

  const createDialogue = async () => {
    if (!episodeId) return;
    setM3Action("create-dialogue");
    try {
      const created = await episodeContinuityAPI.createDialogueTakes(episodeId);
      await refreshM3();
      toast.success(
        `已开始生成 ${listOrEmpty(created.take_ids).length} 段对白表演`,
      );
    } catch (error) {
      toast.error("无法生成对白表演", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setM3Action(null);
    }
  };

  const regenerateDialogue = async (take: EpisodeDialogueTake) => {
    if (!episodeId) return;
    setM3Action(`regenerate-${take.id}`);
    try {
      await episodeContinuityAPI.regenerateDialogueTake(episodeId, take.id);
      await refreshM3();
      toast.success(`已重新生成“${take.speaker_name}”的对白表演`);
    } catch (error) {
      toast.error("无法重新生成对白表演", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setM3Action(null);
    }
  };

  const setCueDraft = (
    cue: EpisodeDialogueCue,
    field: "take_in_ms" | "take_out_ms" | "timeline_in_ms",
    value: string,
  ) => {
    setCueDrafts((current) => ({
      ...current,
      [cue.id]: {
        ...current[cue.id],
        [field]: value,
      },
    }));
  };

  const approveCue = async (
    take: EpisodeDialogueTake,
    cue: EpisodeDialogueCue,
  ) => {
    if (!episodeId) return;
    const draft = cueDrafts[cue.id];
    const takeInMs = readCueDraftNumber(draft?.take_in_ms, cue.take_in_ms);
    const takeOutMs = readCueDraftNumber(draft?.take_out_ms, cue.take_out_ms);
    const timelineInMs = readCueDraftNumber(
      draft?.timeline_in_ms,
      cue.timeline_in_ms,
    );
    if (
      takeInMs == null ||
      takeOutMs == null ||
      timelineInMs == null ||
      takeOutMs <= takeInMs
    ) {
      toast.error("请填写有效的对白时间");
      return;
    }
    setM3Action(`cue-${cue.id}`);
    try {
      const next = await episodeContinuityAPI.updateDialogueCue(
        episodeId,
        cue.id,
        {
          take_in_ms: takeInMs,
          take_out_ms: takeOutMs,
          timeline_in_ms: timelineInMs,
          status: "approved",
        },
      );
      setDialogueTakes(next.takes);
      setCueDrafts((current) => {
        const { [cue.id]: _, ...rest } = current;
        return rest;
      });
      toast.success(`已确认“${take.speaker_name}”的对白时间`);
    } catch (error) {
      toast.error("无法确认对白时间", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setM3Action(null);
    }
  };

  const previewEdit = async () => {
    if (!episodeId) return;
    setM3Action("preview-edit");
    try {
      const next = await episodeContinuityAPI.previewEditRevision(episodeId, {
        audio_policies: audioPolicies,
      });
      setEditPreview(next);
      setAudioPolicies((current) =>
        listOrEmpty(next.timeline?.clips).reduce<Record<string, string>>(
          (result, clip) => ({
            ...result,
            [String(clip.storyboard_id)]:
              current[String(clip.storyboard_id)] || clip.audio_policy,
          }),
          {},
        ),
      );
      toast.success(next.ready ? "剪辑方案已就绪" : "请先处理剪辑方案中的问题");
    } catch (error) {
      toast.error("无法检查剪辑方案", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setM3Action(null);
    }
  };

  const createEdit = async () => {
    if (!episodeId) return;
    setM3Action("create-edit");
    try {
      const created = await episodeContinuityAPI.createEditRevision(episodeId, {
        audio_policies: audioPolicies,
      });
      setEditRevisions((current) => [
        created,
        ...current.filter((revision) => revision.id !== created.id),
      ]);
      setEditPreview(null);
      toast.success("已创建剪辑版本，等待确认");
    } catch (error) {
      toast.error("无法创建剪辑版本", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setM3Action(null);
    }
  };

  const approveEdit = async (revision: EpisodeEditRevision) => {
    if (!episodeId) return;
    setM3Action(`approve-edit-${revision.id}`);
    try {
      const next = await episodeContinuityAPI.approveEditRevision(
        episodeId,
        revision.id,
      );
      setEditRevisions((current) =>
        current.map((item) => (item.id === next.id ? next : item)),
      );
      toast.success("剪辑版本已确认");
    } catch (error) {
      toast.error("无法确认剪辑版本", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setM3Action(null);
    }
  };

  const renderEdit = async (revision: EpisodeEditRevision) => {
    if (!episodeId) return;
    setM3Action(`render-edit-${revision.id}`);
    try {
      await episodeContinuityAPI.renderEditRevision(episodeId, revision.id);
      await refreshM3();
      toast.success("已开始渲染这一版成片");
    } catch (error) {
      toast.error("无法渲染剪辑版本", {
        description: getAiErrorCopy(error),
      });
    } finally {
      setM3Action(null);
    }
  };

  const storyboardById = useMemo(
    () =>
      new Map(wb.storyboards.map((storyboard) => [storyboard.id, storyboard])),
    [wb.storyboards],
  );
  const itemByStoryboardId = useMemo(
    () => new Map((run?.items || []).map((item) => [item.storyboard_id, item])),
    [run?.items],
  );
  const boundaries = listOrEmpty(continuity?.boundaries);
  const preflightBlocks = listOrEmpty(preflight?.blocks);
  const runItems = listOrEmpty(run?.items);
  const dialoguePreviewBlocks = listOrEmpty(dialoguePreview?.blocks);
  const dialoguePreviewTakes = listOrEmpty(dialoguePreview?.takes);
  const editPreviewClips = listOrEmpty(editPreview?.timeline?.clips);
  const editPreviewDialogueCues = listOrEmpty(
    editPreview?.timeline?.dialogue_cues,
  );
  const isRunActive = Boolean(
    run && ["queued", "running"].includes(run.status),
  );
  const completedItems = runItems.filter(
    (item) => item.status === "completed",
  ).length;
  const reviewRequiredCount = boundaries.filter(
    (boundary) => boundary.status === "review_required",
  ).length;

  if (!episodeId) return null;

  return (
    <div className="prod-content continuity-workspace">
      <div className="prod-section-bar">
        <div className="continuity-section-heading">
          <GitBranch size={15} />
          <span>镜头连续性</span>
          {continuity ? (
            <small>
              {continuity.expected_boundary_count} 处交接 ·{" "}
              {
                boundaries.filter(
                  (boundary) => boundary.relation_type === "continuous",
                ).length
              }{" "}
              处连续承接
            </small>
          ) : null}
        </div>
        <div className="ml-auto continuity-toolbar-actions">
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn"
            disabled={submitting || loading}
            onClick={() => void preview()}
          >
            {submitting ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <RefreshCw size={11} />
            )}
            检查连续性
          </Button>
          {isRunActive ? (
            <Button
              size="sm"
              variant="ghost"
              className="panel-btn"
              disabled={submitting}
              onClick={() => void cancelRun()}
            >
              <X size={11} />
              停止后续生成
            </Button>
          ) : run?.status === "failed" ? (
            <Button
              size="sm"
              variant="ghost"
              className="panel-btn panel-btn-primary"
              disabled={submitting}
              onClick={() => void retryRun()}
            >
              {submitting ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              重试失败镜头
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="panel-btn panel-btn-primary"
              disabled={!preflight?.ready || submitting}
              onClick={() => void createRun()}
            >
              {submitting ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Video size={11} />
              )}
              生成本集连续视频
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="step-loading">
          <Loader2 size={22} className="animate-spin text-accent" />
          <span className="loading-text">正在读取连续性方案</span>
        </div>
      ) : (
        <div className="continuity-body">
          {preflightBlocks.length ? (
            <section
              className="continuity-blocks"
              aria-label="需要处理的连续性问题"
            >
              <div className="continuity-alert-head">
                <CircleAlert size={15} />
                <strong>生成前需要处理</strong>
              </div>
              <ul>
                {preflightBlocks.map((item, index) => (
                  <li
                    key={`${item.boundary_id || "episode"}-${item.code}-${index}`}
                  >
                    {item.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <section className="continuity-ready">
              <CheckCircle2 size={16} />
              <span>
                连续性条件已就绪。确认后，连续镜头会等待上一镜的真实尾帧；有意跳转的镜头可独立生成。
              </span>
            </section>
          )}

          {run ? (
            <section
              className={cn("continuity-run-status", `is-${run.status}`)}
              aria-live="polite"
            >
              <div>
                <span className="continuity-run-kicker">本次连续视频生产</span>
                <strong>
                  {run.status === "completed"
                    ? "视频生成完成，等待逐处审核"
                    : run.status === "failed" || run.status === "blocked"
                      ? "本次生成需要处理"
                      : run.status === "canceled"
                        ? "已停止后续生成"
                        : "正在按镜头交接关系生成"}
                </strong>
                <small>
                  {completedItems}/{runItems.length} 个镜头视频已完成
                  {reviewRequiredCount > 0
                    ? ` · ${reviewRequiredCount} 处交接等待审核`
                    : ""}
                </small>
              </div>
              <Clock3 size={18} />
            </section>
          ) : null}

          <section
            className="continuity-boundary-list"
            aria-label="镜头交接列表"
          >
            {boundaries.map((boundary) => {
              const from = storyboardById.get(boundary.from_storyboard_id);
              const to = storyboardById.get(boundary.to_storyboard_id);
              const sourceItem = itemByStoryboardId.get(
                boundary.from_storyboard_id,
              );
              const destinationItem = itemByStoryboardId.get(
                boundary.to_storyboard_id,
              );
              const tailUrl = staticUrl(sourceItem?.actual_tail_frame_url);
              const firstFrameUrl = staticUrl(
                destinationItem?.actual_first_frame_url,
              );
              const isReviewing = reviewingBoundaryId === boundary.id;
              const canReview =
                boundary.status === "review_required" &&
                sourceItem?.status === "completed" &&
                destinationItem?.status === "completed" &&
                Boolean(tailUrl) &&
                Boolean(firstFrameUrl);
              const actionText = String(
                boundary.handoff?.action_handoff || "",
              ).trim();

              return (
                <article key={boundary.id} className="continuity-boundary-row">
                  <div className="continuity-boundary-sequence">
                    <span>镜头 {boundary.from_storyboard_number ?? "—"}</span>
                    <GitBranch size={14} />
                    <span>镜头 {boundary.to_storyboard_number ?? "—"}</span>
                  </div>
                  <div className="continuity-boundary-copy">
                    <div className="continuity-boundary-title">
                      <strong>
                        {boundary.relation_type === "continuous"
                          ? "连续承接"
                          : "有意跳转"}
                      </strong>
                      <span
                        className={cn(
                          "continuity-status",
                          `is-${boundary.status}`,
                        )}
                      >
                        {boundary.status === "approved"
                          ? "已通过"
                          : boundary.status === "review_required"
                            ? "等待审核"
                            : boundary.status === "rework_required"
                              ? "需要重做"
                              : boundary.status === "blocked"
                                ? "需要处理"
                                : "已就绪"}
                      </span>
                    </div>
                    <p>{actionText || "尚未补充具体交接说明。"}</p>
                    <small>
                      {from?.title || "上一镜"} → {to?.title || "下一镜"}
                      {destinationItem?.status === "waiting_dependency"
                        ? " · 等待上一镜尾帧"
                        : ""}
                    </small>
                  </div>
                  <div className="continuity-boundary-media">
                    <figure>
                      {tailUrl ? (
                        <img src={tailUrl} alt="上一镜真实尾帧" />
                      ) : (
                        <span>尾帧待就绪</span>
                      )}
                      <figcaption>上一镜真实尾帧</figcaption>
                    </figure>
                    <figure>
                      {firstFrameUrl ? (
                        <img src={firstFrameUrl} alt="下一镜实际首帧" />
                      ) : (
                        <span>首帧待提取</span>
                      )}
                      <figcaption>下一镜实际首帧</figcaption>
                    </figure>
                  </div>
                  <div className="continuity-boundary-actions">
                    <Button
                      size="xs"
                      variant="ghost"
                      className="panel-btn"
                      disabled={isReviewing || isRunActive}
                      onClick={() => openHandoffEditor(boundary)}
                    >
                      <PencilLine size={10} />
                      编辑交接
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="panel-btn"
                      disabled={isReviewing || isRunActive}
                      onClick={() => void toggleBoundaryRelation(boundary)}
                    >
                      {boundary.relation_type === "continuous"
                        ? "改为跳转"
                        : "改为连续"}
                    </Button>
                    {canReview ? (
                      <>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="panel-btn"
                          disabled={isReviewing}
                          onClick={() =>
                            void reviewBoundary(boundary.id, "approve")
                          }
                        >
                          {isReviewing ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <CheckCircle2 size={10} />
                          )}
                          通过
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          className="panel-btn"
                          disabled={isReviewing}
                          onClick={() =>
                            void reviewBoundary(boundary.id, "rework")
                          }
                        >
                          需要重做
                        </Button>
                      </>
                    ) : (
                      <span className="continuity-action-hint">
                        {boundary.status === "approved"
                          ? "已确认"
                          : "生成后可审核"}
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </section>

          <Dialog
            open={Boolean(editingBoundary)}
            onOpenChange={closeHandoffEditor}
          >
            <DialogContent variant="form" aria-describedby={undefined}>
              <DialogHeaderBar variant="form">
                <DialogTitle>编辑镜头交接</DialogTitle>
                <DialogDescription className="mt-2 leading-6">
                  镜头 {editingBoundary?.from_storyboard_number ?? "—"} 到镜头{" "}
                  {editingBoundary?.to_storyboard_number ?? "—"} 的
                  {editingBoundary?.relation_type === "continuous"
                    ? "动作承接说明。"
                    : "有意跳转说明。"}
                  保存后需要重新检查生产条件。
                </DialogDescription>
              </DialogHeaderBar>
              <DialogMain variant="form">
                <label
                  className="grid gap-2 text-sm font-medium text-text-1"
                  htmlFor="continuity-action-handoff"
                >
                  {editingBoundary?.relation_type === "continuous"
                    ? "动作交接"
                    : "跳转意图"}
                  <span className="text-xs font-normal leading-5 text-text-3">
                    {editingBoundary?.relation_type === "continuous"
                      ? "描述上一镜如何引出下一镜。连续承接必须填写。"
                      : "说明为什么在这里切换时间、空间、视角或叙事节奏。"}
                  </span>
                </label>
                <Textarea
                  id="continuity-action-handoff"
                  value={actionHandoffDraft}
                  rows={6}
                  disabled={
                    reviewingBoundaryId === editingBoundary?.id || isRunActive
                  }
                  onChange={(event) => setActionHandoffDraft(event.target.value)}
                  placeholder={
                    editingBoundary?.relation_type === "continuous"
                      ? "例如：上一镜中她握着钥匙回头，下一镜从同一回头动作接入。"
                      : "例如：切到三年前的雨夜，以硬切揭示这把钥匙的来历。"
                  }
                />
              </DialogMain>
              <DialogActions variant="form">
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    reviewingBoundaryId === editingBoundary?.id || isRunActive
                  }
                  onClick={() => closeHandoffEditor(false)}
                >
                  取消
                </Button>
                <Button
                  type="button"
                  disabled={
                    reviewingBoundaryId === editingBoundary?.id ||
                    isRunActive ||
                    !actionHandoffDraft.trim()
                  }
                  onClick={() => void saveActionHandoff()}
                >
                  {reviewingBoundaryId === editingBoundary?.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}
                  保存交接
                </Button>
              </DialogActions>
            </DialogContent>
          </Dialog>

          {m3LoadError ? (
            <section
              className="continuity-blocks"
              aria-label="声音制作状态需要刷新"
            >
              <div className="continuity-alert-head">
                <CircleAlert size={15} />
                <strong>声音制作状态需要刷新</strong>
              </div>
              <ul>
                <li>{m3LoadError}</li>
              </ul>
            </section>
          ) : null}

          <section
            className="continuity-production-section"
            aria-label="连续对白表演"
          >
            <div className="continuity-production-section-head">
              <div className="continuity-production-section-title">
                <Mic2 size={15} />
                <div>
                  <strong>连续对白</strong>
                  <small>
                    {dialogueTakes.length
                      ? `${dialogueTakes.length} 段表演`
                      : "等待生成"}
                  </small>
                </div>
              </div>
              <div className="continuity-toolbar-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  className="panel-btn"
                  disabled={m3Action !== null}
                  onClick={() => void previewDialogue()}
                >
                  {m3Action === "preview-dialogue" ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <RefreshCw size={11} />
                  )}
                  预览对白表演
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="panel-btn panel-btn-primary"
                  disabled={
                    m3Action !== null ||
                    !dialoguePreview?.ready ||
                    dialogueTakes.length > 0
                  }
                  onClick={() => void createDialogue()}
                >
                  {m3Action === "create-dialogue" ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Mic2 size={11} />
                  )}
                  生成对白表演
                </Button>
              </div>
            </div>

            {dialoguePreviewBlocks.length ? (
              <div className="continuity-inline-blocks">
                {dialoguePreviewBlocks.map((block, index) => (
                  <span
                    key={`${block.code}-${block.storyboard_id || index}`}
                    className="continuity-inline-block"
                  >
                    {block.message}
                  </span>
                ))}
              </div>
            ) : null}

            {dialoguePreviewTakes.length ? (
              <div className="dialogue-plan-list" aria-label="对白表演计划">
                {dialoguePreviewTakes.map((take) => {
                  const takeCues = listOrEmpty(take.cues);
                  return (
                    <div key={take.plan_index} className="dialogue-plan-row">
                      <div>
                        <strong>{take.speaker_name}</strong>
                        <small>
                          {takeCues.length} 个镜头片段 ·{" "}
                          {takeCues
                            .map((cue) => {
                              const storyboard = storyboardById.get(
                                cue.storyboard_id,
                              );
                              return `镜头 ${
                                storyboard?.storyboard_number ??
                                cue.storyboard_id
                              }`;
                            })
                            .join(" / ")}
                        </small>
                      </div>
                      <p>{take.text}</p>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {dialogueTakes.length ? (
              <div className="dialogue-take-list">
                {dialogueTakes.map((take) => {
                  const isTakeAction =
                    m3Action === `regenerate-${take.id}`;
                  const takeCues = listOrEmpty(take.cues);
                  return (
                    <article key={take.id} className="dialogue-take-row">
                      <div className="dialogue-take-main">
                        <div className="dialogue-take-title">
                          <strong>{take.speaker_name}</strong>
                          <span
                            className={cn(
                              "continuity-status",
                              `is-${take.status}`,
                            )}
                          >
                            {dialogueTakeStatusLabel(take.status)}
                          </span>
                          <small>{formatDurationMs(take.duration_ms)}</small>
                        </div>
                        <p>{take.text}</p>
                        {take.failure_detail ? (
                          <small className="continuity-failure-copy">
                            {take.failure_detail}
                          </small>
                        ) : null}
                        {take.audio_url ? (
                          <audio
                            className="dialogue-take-player"
                            controls
                            preload="metadata"
                            src={staticUrl(take.audio_url)}
                          />
                        ) : null}
                      </div>
                      <div className="dialogue-take-actions">
                        <Button
                          size="xs"
                          variant="ghost"
                          className="panel-btn"
                          disabled={m3Action !== null}
                          onClick={() => void regenerateDialogue(take)}
                        >
                          {isTakeAction ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <RefreshCw size={10} />
                          )}
                          重生成
                        </Button>
                      </div>
                      {takeCues.length ? (
                        <div className="dialogue-cue-list">
                          {takeCues.map((cue) => {
                            const storyboard = storyboardById.get(
                              cue.storyboard_id,
                            );
                            const cueAction = m3Action === `cue-${cue.id}`;
                            return (
                              <div key={cue.id} className="dialogue-cue-row">
                                <div className="dialogue-cue-label">
                                  <strong>
                                    镜头{" "}
                                    {storyboard?.storyboard_number ??
                                      cue.storyboard_id}
                                  </strong>
                                  <small>
                                    {cue.cue_mode ===
                                    "continue_from_previous"
                                      ? "跨镜头续说"
                                      : cue.cue_mode === "lead_into_next"
                                        ? "提前入声"
                                        : cue.cue_mode === "overlap"
                                          ? "抢话"
                                          : "镜头内"}
                                  </small>
                                </div>
                                <label>
                                  <span>取音</span>
                                  <input
                                    type="number"
                                    min="0"
                                    inputMode="numeric"
                                    value={
                                      cueDrafts[cue.id]?.take_in_ms ??
                                      cue.take_in_ms ??
                                      ""
                                    }
                                    onChange={(event) =>
                                      setCueDraft(
                                        cue,
                                        "take_in_ms",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  <span>止音</span>
                                  <input
                                    type="number"
                                    min="0"
                                    inputMode="numeric"
                                    value={
                                      cueDrafts[cue.id]?.take_out_ms ??
                                      cue.take_out_ms ??
                                      ""
                                    }
                                    onChange={(event) =>
                                      setCueDraft(
                                        cue,
                                        "take_out_ms",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <label>
                                  <span>进入</span>
                                  <input
                                    type="number"
                                    min="0"
                                    inputMode="numeric"
                                    value={
                                      cueDrafts[cue.id]?.timeline_in_ms ??
                                      cue.timeline_in_ms ??
                                      ""
                                    }
                                    onChange={(event) =>
                                      setCueDraft(
                                        cue,
                                        "timeline_in_ms",
                                        event.target.value,
                                      )
                                    }
                                  />
                                </label>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  className="panel-btn"
                                  disabled={
                                    m3Action !== null ||
                                    take.duration_ms == null
                                  }
                                  onClick={() => void approveCue(take, cue)}
                                >
                                  {cueAction ? (
                                    <Loader2
                                      size={10}
                                      className="animate-spin"
                                    />
                                  ) : (
                                    <CheckCircle2 size={10} />
                                  )}
                                  确认时间
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section
            className="continuity-production-section"
            aria-label="单集剪辑版本"
          >
            <div className="continuity-production-section-head">
              <div className="continuity-production-section-title">
                <Layers size={15} />
                <div>
                  <strong>单集剪辑</strong>
                  <small>
                    {editRevisions.length
                      ? `${editRevisions.length} 个版本`
                      : "等待创建"}
                  </small>
                </div>
              </div>
              <div className="continuity-toolbar-actions">
                <Button
                  size="sm"
                  variant="ghost"
                  className="panel-btn"
                  disabled={m3Action !== null}
                  onClick={() => void previewEdit()}
                >
                  {m3Action === "preview-edit" ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <RefreshCw size={11} />
                  )}
                  检查剪辑方案
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="panel-btn panel-btn-primary"
                  disabled={m3Action !== null || !editPreview?.ready}
                  onClick={() => void createEdit()}
                >
                  {m3Action === "create-edit" ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Layers size={11} />
                  )}
                  创建剪辑版本
                </Button>
              </div>
            </div>

            {listOrEmpty(editPreview?.blocks).length ? (
              <div className="continuity-inline-blocks">
                {listOrEmpty(editPreview?.blocks).map((block, index) => (
                  <span
                    key={`${block.code}-${block.boundary_id || block.take_id || index}`}
                    className="continuity-inline-block"
                  >
                    {block.message}
                  </span>
                ))}
              </div>
            ) : null}

            {editPreview ? (
              <div className="edit-plan-preview">
                <div className="edit-plan-summary">
                  <span>
                    {editPreviewClips.length} 个镜头视频
                  </span>
                  <span>
                    {editPreviewDialogueCues.length} 段权威对白
                  </span>
                </div>
                <div className="edit-audio-policy-list">
                  {editPreviewClips.map((clip) => {
                    const storyboard = storyboardById.get(clip.storyboard_id);
                    return (
                      <label key={clip.storyboard_id}>
                        <span>
                          镜头{" "}
                          {storyboard?.storyboard_number ??
                            clip.storyboard_number}
                        </span>
                        <select
                          value={
                            audioPolicies[String(clip.storyboard_id)] ||
                            clip.audio_policy
                          }
                          onChange={(event) => {
                            setAudioPolicies((current) => ({
                              ...current,
                              [String(clip.storyboard_id)]:
                                event.target.value,
                            }));
                            setEditPreview(null);
                          }}
                        >
                          <option value="mute">静音原始音轨</option>
                          <option value="verified_ambience">
                            保留已确认氛围
                          </option>
                          <option value="sfx_only">仅保留音效</option>
                          <option value="music_only">仅保留音乐</option>
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {editRevisions.length ? (
              <div className="edit-revision-list">
                {editRevisions.map((revision) => {
                  const isApproveAction =
                    m3Action === `approve-edit-${revision.id}`;
                  const isRenderAction =
                    m3Action === `render-edit-${revision.id}`;
                  const revisionClips = listOrEmpty(revision.timeline?.clips);
                  const revisionDialogueCues = listOrEmpty(
                    revision.timeline?.dialogue_cues,
                  );
                  return (
                    <article key={revision.id} className="edit-revision-row">
                      <div className="edit-revision-copy">
                        <div className="dialogue-take-title">
                          <strong>版本 #{revision.id}</strong>
                          <span
                            className={cn(
                              "continuity-status",
                              `is-${revision.status}`,
                            )}
                          >
                            {editRevisionStatusLabel(revision.status)}
                          </span>
                        </div>
                        <small>
                          {revisionClips.length} 个镜头 ·{" "}
                          {revisionDialogueCues.length} 段对白
                        </small>
                        {revision.failure_detail ? (
                          <small className="continuity-failure-copy">
                            {revision.failure_detail}
                          </small>
                        ) : null}
                        {revision.merged_video_url ? (
                          <video
                            className="edit-revision-video"
                            controls
                            preload="metadata"
                            src={staticUrl(revision.merged_video_url)}
                          />
                        ) : null}
                      </div>
                      <div className="dialogue-take-actions">
                        {["draft", "stale"].includes(revision.status) ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="panel-btn"
                            disabled={m3Action !== null}
                            onClick={() => void approveEdit(revision)}
                          >
                            {isApproveAction ? (
                              <Loader2
                                size={10}
                                className="animate-spin"
                              />
                            ) : (
                              <CheckCircle2 size={10} />
                            )}
                            确认版本
                          </Button>
                        ) : null}
                        {revision.status === "approved" ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="panel-btn panel-btn-primary"
                            disabled={m3Action !== null}
                            onClick={() => void renderEdit(revision)}
                          >
                            {isRenderAction ? (
                              <Loader2
                                size={10}
                                className="animate-spin"
                              />
                            ) : (
                              <Video size={10} />
                            )}
                            渲染成片
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}

// ——————————————————————————————————————————————
// Videos Tab
// ——————————————————————————————————————————————
function VideosTab({
  focusedShotId,
  onFocusShot,
  canvasEpisodeNumber,
}: {
  focusedShotId?: number | null;
  onFocusShot?: (shotId: number | null) => void;
  canvasEpisodeNumber?: number;
}) {
  const wb = useWorkbench();
  const openContinuity = () => wb.goSubStep("prod-continuity");
  const effectiveProductionMode = useEpisodeProductionMode(
    wb.episode?.id,
    wb.storyboards.map((storyboard) => storyboard.id).join(","),
  );
  const isContinuityProduction = effectiveProductionMode === "continuity";

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <ConfigBadge label="视频配置" value={wb.lockedVideoConfigLabel} compact />
        {effectiveProductionMode === "checking" ? (
          <span className="char-count">正在确认生产方式...</span>
        ) : null}
      </div>
      {effectiveProductionMode === "checking" ? null : (
        <ShotProductionWorkspace
          kind="video"
          focusedShotId={focusedShotId}
          onFocusShot={onFocusShot}
          canvasEpisodeNumber={canvasEpisodeNumber}
          isContinuityProduction={isContinuityProduction}
          onOpenContinuity={openContinuity}
        />
      )}
    </div>
  );
}

// ——————————————————————————————————————————————
// Compose Tab
// ——————————————————————————————————————————————
function ComposeTab() {
  const wb = useWorkbench();
  const composedCount = wb.storyboards.filter(
    (s) => s.composed_video_url,
  ).length;
  const isBatchComposing = wb.running && wb.runningType === "compose_all";
  const productionMode = useEpisodeProductionMode(
    wb.episode?.id,
    wb.storyboards.map((storyboard) => storyboard.id).join(","),
  );
  const isContinuityProduction = productionMode === "continuity";
  const openContinuity = () => wb.goSubStep("prod-continuity");

  const handleBatchCompose = async () => {
    await wb.batchCompose();
  };

  return (
    <div className="prod-content">
      <div className="prod-section-bar">
        <span className="char-count">
          {composedCount}/{wb.storyboards.length} 已合成
        </span>
        <div className="ml-auto">
          {isContinuityProduction ? (
            <Button
              size="sm"
              variant="ghost"
              className="panel-btn"
              onClick={openContinuity}
            >
              <GitBranch size={12} />
              前往剪辑版本
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="panel-btn"
              onClick={handleBatchCompose}
              disabled={
                isBatchComposing || productionMode === "checking"
              }
            >
              {isBatchComposing ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Clapperboard size={11} />
              )}
              {productionMode === "checking"
                ? "确认生产方式..."
                : isBatchComposing
                  ? "合成中..."
                  : "批量合成"}
            </Button>
          )}
        </div>
      </div>

      {isContinuityProduction ? (
        <section className="continuity-ready" aria-label="连续成片入口">
          <GitBranch size={16} />
          <span>
            当前分镜的成片由已确认剪辑版本渲染。请完成边界审核、确认剪辑版本后再渲染。
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="panel-btn ml-auto"
            onClick={openContinuity}
          >
            前往连续性
          </Button>
        </section>
      ) : null}

      <div className="prod-grid">
        {wb.storyboards.map((sb, i) => {
          const task = wb.entityTasks[`shot-compose:${sb.id}`];
          const hasComposedVideo = !!sb.composed_video_url;
          const currentTask = hasComposedVideo ? null : task;
          const isLocalPending = wb.pendingComposes.has(sb.id);
          const isServerPending =
            !hasComposedVideo &&
            (sb.status === "compose_queued" ||
              sb.status === "compose_processing");
          const isPending =
            !hasComposedVideo &&
            (isLocalPending ||
              isServerPending ||
              isActiveWorkbenchTask(currentTask));
          const isFailed =
            !hasComposedVideo &&
            (isFailedWorkbenchTask(currentTask) ||
              sb.status === "compose_failed");
          return (
            <div key={sb.id} className="card prod-card">
              <div className="prod-info">
                <div className="flex items-center justify-between mb-2">
                  <span className="prod-meta-line">
                    #{String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={cn(
                      "asset-cover-badge",
                      isFailed
                        ? "is-error"
                        : hasComposedVideo
                          ? "is-ready"
                          : isPending
                            ? "is-pending"
                            : "",
                    )}
                  >
                    {isFailed
                      ? "合成失败"
                      : hasComposedVideo
                        ? "已合成"
                        : isPending
                          ? "合成中"
                          : "待合成"}
                  </span>
                </div>
                <div className="prod-desc line-clamp-2">
                  {sb.description || "—"}
                </div>
              </div>
              {isContinuityProduction ? (
                <Button
                  size="xs"
                  className="panel-btn prod-card-action"
                  onClick={openContinuity}
                >
                  前往剪辑版本
                </Button>
              ) : hasComposedVideo ? (
                <>
                  <video
                    src={staticUrl(sb.composed_video_url)}
                    poster={
                      staticUrl(
                        sb.first_frame_image ||
                          sb.composed_image ||
                          sb.last_frame_image,
                      ) || undefined
                    }
                    className="prod-video"
                    controls
                    playsInline
                    preload="none"
                  />
                  <Button
                    size="xs"
                    className="panel-btn prod-card-action"
                    disabled={isPending}
                    onClick={() =>
                      isFailed && task
                        ? wb.retryEntityTask(task.id)
                        : wb.composeShot(sb)
                    }
                  >
                    {isPending ? (
                      <>
                        <Loader2 size={10} className="animate-spin" /> 合成中
                      </>
                    ) : isFailed ? (
                      <>
                        <RefreshCw size={10} /> 重试合成
                      </>
                    ) : (
                      <>
                        <Clapperboard size={10} /> 重新合成
                      </>
                    )}
                  </Button>
                </>
              ) : (
                <Button
                  size="xs"
                  className="panel-btn panel-btn-primary prod-card-action"
                  disabled={isPending || !sb.video_url}
                  onClick={() =>
                    isFailed && task
                      ? wb.retryEntityTask(task.id)
                      : wb.composeShot(sb)
                  }
                >
                  {isPending ? (
                    <>
                      <Loader2 size={10} className="animate-spin" /> 合成中
                    </>
                  ) : isFailed ? (
                    <>
                      <RefreshCw size={10} /> 重试合成
                    </>
                  ) : (
                    <>
                      <Clapperboard size={10} /> 合成
                    </>
                  )}
                </Button>
              )}
              <EntityTaskNotice
                task={currentTask}
                label="镜头合成"
                onRetry={
                  isContinuityProduction ? undefined : wb.retryEntityTask
                }
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
