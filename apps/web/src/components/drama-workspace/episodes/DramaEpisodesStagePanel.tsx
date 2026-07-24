"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clapperboard,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { normalizeEpisodeBlueprintPayload } from "@/lib/drama-metadata";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { DramaWorkspacePayload } from "@/lib/api";
import type { SourceAnalysis } from "@/types/api";
import {
  AdaptationTargetFields,
  formatCount,
  getEpisodeStaleLabel,
  hasScript,
} from "../legacy/ai-first-workbench-parts";
import {
  getEpisodeWorkbenchHref,
  getProjectStageHref,
  type ProjectStage,
} from "./episode-route";
import { DramaAiTaskProgress } from "./DramaAiTaskProgress";
import { DramaStoryGraphStagePanel } from "./DramaStoryGraphStagePanel";
import type { DramaAiFirstController } from "./use-drama-ai-first-controller";

type DramaEpisodesStagePanelProps = {
  controller: DramaAiFirstController;
  dramaId: number;
  stage: ProjectStage;
  workspaceEpisodes: DramaWorkspacePayload["episodes"];
  scriptedEpisodeCount: number;
};

function EmptyStage({
  action,
  description,
  icon: Icon,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon: typeof BookOpen;
  title: string;
}) {
  return (
    <div className="drama-stage-empty">
      <Icon size={34} strokeWidth={1.7} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}

type SourceGlanceEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  description: string;
};

function firstText(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return "";
}

function formatGlanceGeneratedAt(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatGenerationMode(value: string | null | undefined) {
  if (value === "remote_agent") return "大模型 API";
  if (value === "local_rule_seed") return "本地规则";
  return "";
}

function normalizeSourceGlance(analysis: SourceAnalysis) {
  const protagonist = firstText(analysis.protagonist) || "主角";
  const nodes = new Map<string, { name: string; role: string }>();
  const edges: SourceGlanceEdge[] = [];
  nodes.set(protagonist, { name: protagonist, role: "主角" });
  if (analysis.antagonist)
    nodes.set(analysis.antagonist, { name: analysis.antagonist, role: "对手" });

  for (const [index, raw] of (analysis.relationship_map || []).entries()) {
    const subject = firstText(
      raw.subject,
      raw.source,
      raw.from,
      raw.character_a,
      raw.name_a,
    );
    const object = firstText(
      raw.object,
      raw.target,
      raw.to,
      raw.character_b,
      raw.name_b,
    );
    const singleCharacter = firstText(raw.character, raw.name, raw.entity);
    const label =
      firstText(
        raw.predicate,
        raw.relation,
        raw.relationship,
        raw.role,
        raw.type,
      ) || "关系待确认";
    const description = firstText(
      raw.description,
      raw.summary,
      raw.evidence,
      raw.note,
    );

    if (subject && object) {
      nodes.set(subject, {
        name: subject,
        role: subject === protagonist ? "主角" : "",
      });
      nodes.set(object, {
        name: object,
        role: object === analysis.antagonist ? "对手" : "",
      });
      edges.push({
        id: `${subject}-${object}-${index}`,
        source: subject,
        target: object,
        label,
        description,
      });
      continue;
    }

    if (singleCharacter) {
      nodes.set(singleCharacter, { name: singleCharacter, role: label });
      if (singleCharacter !== protagonist) {
        edges.push({
          id: `${protagonist}-${singleCharacter}-${index}`,
          source: protagonist,
          target: singleCharacter,
          label,
          description,
        });
      }
    }
  }

  if (
    analysis.antagonist &&
    !edges.some(
      (edge) =>
        edge.target === analysis.antagonist ||
        edge.source === analysis.antagonist,
    )
  ) {
    edges.push({
      id: `${protagonist}-${analysis.antagonist}-antagonist`,
      source: protagonist,
      target: analysis.antagonist,
      label: "核心对抗",
      description: analysis.core_conflict,
    });
  }

  return {
    nodes: Array.from(nodes.values()).slice(0, 8),
    edges: edges.slice(0, 8),
  };
}

function SourceGlanceMap({
  analysis,
  aspectRhythm,
  episodeDuration,
  targetEpisodeCount,
  visualStyle,
}: {
  analysis: SourceAnalysis;
  aspectRhythm: string;
  episodeDuration: string;
  targetEpisodeCount: number;
  visualStyle: string;
}) {
  const glance = normalizeSourceGlance(analysis);
  const analyzedTargetEpisodeCount =
    analysis.target_episode_count && analysis.target_episode_count > 0
      ? analysis.target_episode_count
      : targetEpisodeCount;
  const analyzedEpisodeDuration = analysis.episode_duration || episodeDuration;
  const supportingNodes = glance.nodes
    .filter((node) => node.name !== (analysis.protagonist || "主角"))
    .slice(0, 5);
  const generatedAt = formatGlanceGeneratedAt(analysis.generated_at);
  const generationMode = formatGenerationMode(analysis.generation_mode);
  const analysisMeta = [
    "源稿理解结果",
    generatedAt ? `完成于 ${generatedAt}` : "完成时间未记录",
    generationMode,
    analysis.ai_run_id ? `AI Run #${analysis.ai_run_id}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className="drama-source-glance">
      <div className="drama-source-glance-head">
        <div>
          <span className="drama-source-glance-kicker">理解结果</span>
          <h4>{analysis.theme || "源稿关系概览"}</h4>
          <p className="drama-source-glance-meta">{analysisMeta}</p>
        </div>
        <div className="drama-source-glance-plan">
          <strong>目标 {analyzedTargetEpisodeCount} 集</strong>
          <span>{analyzedEpisodeDuration}</span>
          <small>源稿理解建议</small>
        </div>
      </div>

      <div className="drama-source-glance-body">
        <div className="drama-source-glance-map" aria-label="源稿关系概览">
          <div className="drama-source-glance-center">
            <strong>{analysis.protagonist || "主角"}</strong>
            <span>{analysis.protagonist_goal || "目标待确认"}</span>
          </div>
          <div className="drama-source-glance-orbit">
            {supportingNodes.length ? (
              supportingNodes.map((node) => (
                <span key={node.name}>
                  <strong>{node.name}</strong>
                  <small>{node.role || "关系待确认"}</small>
                </span>
              ))
            ) : (
              <span>
                <strong>{analysis.antagonist || "关键关系"}</strong>
                <small>{analysis.core_conflict || "等待源稿理解补全"}</small>
              </span>
            )}
          </div>
        </div>

        <div className="drama-source-glance-copy">
          <p>{analysis.core_conflict}</p>
          <div className="drama-source-glance-tags">
            {(visualStyle ? [visualStyle] : [])
              .concat(aspectRhythm ? [aspectRhythm] : [])
              .slice(0, 2)
              .map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
          </div>
          <div className="drama-source-glance-edges">
            {glance.edges.length ? (
              glance.edges.slice(0, 4).map((edge) => (
                <div key={edge.id}>
                  <strong>
                    {edge.source} → {edge.target}
                  </strong>
                  <span>{edge.label}</span>
                  {edge.description ? <small>{edge.description}</small> : null}
                </div>
              ))
            ) : (
              <div>
                <strong>关系待补全</strong>
                <span>源稿理解已完成，但暂未返回可绘制关系边。</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function SourceLibraryPicker({
  controller,
  onImported,
}: Pick<DramaEpisodesStagePanelProps, "controller"> & {
  onImported?: () => void;
}) {
  const selected = controller.selectedWritingSource;

  return (
    <Dialog
      open={controller.sourcePickerOpen}
      onOpenChange={(open) => {
        if (!open) controller.closeWritingSourcePicker();
      }}
    >
      <DialogContent variant="workspace" size="wide">
        <DialogHeaderBar variant="workspace">
          <div className="flex items-start gap-3 pr-10">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-accent-bg text-accent">
              <BookOpen size={18} />
            </div>
            <div className="min-w-0">
              <DialogTitle>从小说模块选择</DialogTitle>
              <DialogDescription className="mt-1 leading-5">
                选择已有小说后，系统会导入完整正文作为当前项目的源稿。
              </DialogDescription>
            </div>
          </div>
        </DialogHeaderBar>

        <DialogMain variant="workspace" className="gap-4 overflow-hidden">
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">搜索小说</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
              <Input
                value={controller.writingSourceQuery}
                onChange={(event) =>
                  controller.setWritingSourceQuery(event.target.value)
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void controller.loadWritingSources(
                      controller.writingSourceQuery,
                    );
                  }
                }}
                placeholder="搜索小说标题或梗概"
                className="h-10 pl-9"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={controller.writingSourceLoading}
              onClick={() => {
                void controller.loadWritingSources(
                  controller.writingSourceQuery,
                );
              }}
            >
              {controller.writingSourceLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Search size={14} />
              )}
              搜索
            </Button>
          </div>

          {controller.writingSourceLoading ? (
            <div className="flex min-h-[250px] flex-1 items-center justify-center rounded-[var(--radius-xs)] bg-bg-2 text-text-3">
              <Loader2 size={26} className="animate-spin" />
            </div>
          ) : controller.writingSources.length === 0 ? (
            <div className="flex min-h-[250px] flex-1 flex-col items-center justify-center rounded-[var(--radius-xs)] border border-dashed border-border bg-bg-2 px-6 text-center">
              <BookOpen size={30} className="text-text-3" strokeWidth={1.7} />
              <h3 className="mt-3 text-base font-semibold text-text-0">
                暂无可选择的小说
              </h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-text-2">
                先在小说模块创建或完善一部小说，再回到这里导入为短剧源稿。
              </p>
              <Link
                href="/writing"
                className="mt-4 text-sm font-semibold text-accent-text underline-offset-4 hover:underline"
              >
                进入小说模块
              </Link>
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.6fr)]">
              <div className="min-h-0 overflow-y-auto rounded-[var(--radius-xs)] bg-bg-2 p-2">
                <div className="grid gap-2">
                  {controller.writingSources.map((item) => {
                    const importing =
                      controller.writingSourceImportingId === item.id;
                    const isSelected =
                      controller.selectedWritingSourceId === item.id;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          "flex min-h-[88px] w-full items-start gap-3 rounded-[var(--radius-xs)] border p-3 text-left transition-colors",
                          isSelected
                            ? "border-accent/35 bg-accent-bg text-text-0"
                            : "border-transparent bg-bg-0 text-text-1 hover:border-border hover:bg-bg-hover",
                        )}
                        disabled={controller.writingSourceImportingId != null}
                        onClick={() =>
                          controller.setSelectedWritingSourceId(item.id)
                        }
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-xs)] bg-bg-2 text-text-3">
                          {importing ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <FileText size={16} />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm font-semibold">
                            {item.title}
                          </strong>
                          <small className="mt-1 block line-clamp-2 text-xs leading-5 text-text-2">
                            {item.synopsis ||
                              "暂无梗概，导入时会读取完整 Markdown 正文。"}
                          </small>
                          <small className="mt-2 block text-xs text-text-3">
                            {item.document_count} 个文档 · 更新于{" "}
                            {item.updated_at
                              ? new Date(item.updated_at).toLocaleDateString()
                              : "未知"}
                          </small>
                        </span>
                        {isSelected ? (
                          <CheckCircle2
                            size={16}
                            className="shrink-0 text-accent"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="flex min-h-[220px] flex-col rounded-[var(--radius-xs)] border border-border bg-bg-0 p-4">
                {selected ? (
                  <>
                    <span className="text-xs font-semibold text-text-3">
                      已选择小说
                    </span>
                    <strong className="mt-2 line-clamp-2 text-base font-semibold text-text-0">
                      {selected.title}
                    </strong>
                    <p className="mt-3 line-clamp-4 text-sm leading-6 text-text-2">
                      {selected.synopsis ||
                        "暂无梗概，导入时会读取作品导出的完整 Markdown 正文。"}
                    </p>
                    <span className="mt-auto pt-4 text-xs text-text-3">
                      {selected.document_count} 个文档
                    </span>
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <FileText
                      size={28}
                      className="text-text-3"
                      strokeWidth={1.6}
                    />
                    <strong className="mt-3 text-sm text-text-0">
                      选择一部小说
                    </strong>
                    <p className="mt-2 text-xs leading-5 text-text-2">
                      选择后确认正文来源，再导入当前短剧项目。
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogMain>

        <DialogActions variant="workspace">
          <Button
            type="button"
            variant="outline"
            disabled={controller.writingSourceImportingId != null}
            onClick={controller.closeWritingSourcePicker}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={!selected || controller.writingSourceImportingId != null}
            onClick={() => {
              void (async () => {
                const result = await controller.importSelectedWritingSource();
                if (result === "saved") onImported?.();
                if (result === "confirmation_required")
                  controller.suspendWritingSourcePickerForReplacement();
              })();
            }}
          >
            {controller.writingSourceImportingId != null ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <CheckCircle2 size={14} />
            )}
            导入源稿
          </Button>
        </DialogActions>
      </DialogContent>
    </Dialog>
  );
}

function SourceReplacementConfirmDialog({
  controller,
  onConfirmed,
}: Pick<DramaEpisodesStagePanelProps, "controller"> & {
  onConfirmed?: () => void;
}) {
  return (
    <ConfirmDialog
      open={controller.sourceReplacementConfirmationOpen}
      onOpenChange={(open) => {
        if (!open && !controller.sourceSaving)
          controller.cancelSourceReplacement();
      }}
      title="确认替换当前源稿"
      description="替换后，现有分集规划、剧本正文、故事地图和分镜都会标记为需重新规划或复核；已编辑内容不会自动删除。"
      confirmLabel="确认替换源稿"
      loading={controller.sourceSaving}
      onConfirm={() => {
        void (async () => {
          const saved = await controller.confirmSourceReplacement();
          if (saved) onConfirmed?.();
        })();
      }}
    />
  );
}

function SourceStage({
  controller,
}: Pick<DramaEpisodesStagePanelProps, "controller">) {
  const [editing, setEditing] = useState(!controller.novelSource);

  if (editing || !controller.novelSource) {
    return (
      <section className="drama-stage-section">
        <div className="drama-stage-section-head">
          <div>
            <span>步骤 1/5 · 源稿理解</span>
            <h3>导入可改编的小说原稿</h3>
            <p>保存后会留在本页理解源稿；理解完成后，由你确认进入分集规划。</p>
          </div>
          <div className="drama-stage-head-actions">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={controller.readOnly}
              onClick={controller.openWritingSourcePicker}
            >
              <BookOpen size={14} />
              从小说模块选择
            </Button>
            {controller.novelSource ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(false)}
              >
                返回摘要
              </Button>
            ) : null}
          </div>
        </div>

        <div className="drama-source-form">
          <label>
            <span>原稿名称</span>
            <Input
              value={controller.sourceTitleDraft}
              onChange={(event) =>
                controller.setSourceTitleDraft(event.target.value)
              }
              placeholder="例如：重生后我..."
            />
          </label>
          <label>
            <span>小说正文</span>
            <Textarea
              value={controller.sourceContentDraft}
              onChange={(event) =>
                controller.setSourceContentDraft(event.target.value)
              }
              placeholder="粘贴完整小说正文，或先从小说模块整理后再导入。"
              className="drama-source-textarea"
            />
          </label>
          <div className="drama-source-form-footer">
            <p>
              当前 {formatCount(controller.sourceDraftWordCount)} 字 /{" "}
              {controller.sourceDraftChapterCount || 0} 章
              {!controller.sourceDialogHealth.ok &&
              controller.sourceContentDraft.trim()
                ? `，${controller.sourceDialogHealth.message}`
                : ""}
            </p>
            <Button
              type="button"
              disabled={
                controller.readOnly ||
                controller.sourceSaving ||
                !controller.sourceContentDraft.trim()
              }
              onClick={() => {
                void (async () => {
                  const saved = await controller.saveNovelSource();
                  if (saved) setEditing(false);
                })();
              }}
            >
              {controller.sourceSaving ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <BookOpen size={15} />
              )}
              {controller.sourceSaving ? "正在保存源稿" : "保存源稿"}
            </Button>
          </div>
        </div>
        <SourceLibraryPicker
          controller={controller}
          onImported={() => setEditing(false)}
        />
        <SourceReplacementConfirmDialog
          controller={controller}
          onConfirmed={() => setEditing(false)}
        />
      </section>
    );
  }

  const source = controller.novelSource;
  const sourceAnalysisReady = controller.sourceAnalysisReady;
  const sourceAnalysisRetryable = controller.sourceAnalysisTaskFailed;
  const sourceActionTitle = sourceAnalysisReady
    ? "下一步：分集规划"
    : sourceAnalysisRetryable
      ? "源稿理解失败"
      : "理解源稿";
  const sourceActionDescription = sourceAnalysisReady
    ? "源稿理解已完成。进入下一步后，可确认改编配置并手动生成分集蓝图。"
    : sourceAnalysisRetryable
      ? "原稿已保留。请重试理解，成功后再由你确认进入分集规划。"
      : "先完成源稿理解；理解结果就绪后，才可进入分集规划。";
  const sourceActionLabel = controller.sourceAnalysisTaskActive
    ? "理解中"
    : controller.planGenerating
      ? "启动理解中"
      : sourceAnalysisReady
        ? "开始分集规划"
        : sourceAnalysisRetryable
          ? "重试理解"
          : "开始理解源稿";

  return (
    <section className="drama-stage-section">
      <div className="drama-stage-section-head">
        <div>
          <span>步骤 1/5 · 源稿理解</span>
          <h3>{source.title || controller.drama?.title || "小说原稿"}</h3>
          <p>已保存的原稿会作为改编配置、分集蓝图与正文生成的上游依据。</p>
        </div>
        {!controller.readOnly ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
          >
            <RefreshCw size={14} />
            重新导入
          </Button>
        ) : null}
      </div>

      <div className="drama-source-summary">
        <div>
          <strong>{formatCount(source.word_count)} 字</strong>
          <span>{source.chapter_count || 1} 章</span>
        </div>
        <p>{source.summary || source.content.slice(0, 420)}</p>
      </div>

      {controller.hasSourceIssue ? (
        <div className="drama-stage-notice is-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>原稿需要修复</strong>
            <p>{controller.novelSourceHealth.message}</p>
          </div>
        </div>
      ) : null}

      <DramaAiTaskProgress
        controller={controller}
        task={controller.sourceAnalysisTask}
        active={controller.sourceAnalysisTaskActive}
        failed={controller.sourceAnalysisTaskFailed}
        label={
          controller.sourceAnalysisTaskActive
            ? controller.formatSourceAnalysisPhase(
                controller.sourceAnalysisTask?.result_summary,
              )
            : "源稿理解"
        }
        progress={controller.sourceAnalysisTaskProgress}
        detail={controller.formatRuntimeTaskDetail(
          controller.sourceAnalysisTask?.result_summary,
          controller.sourceChunkStats.total > 0
            ? `${controller.sourceChunkStats.ready}/${controller.sourceChunkStats.total} 个分块已完成${controller.sourceChunkStats.running ? `，${controller.sourceChunkStats.running} 个进行中` : ""}${controller.sourceChunkStats.failed ? `，${controller.sourceChunkStats.failed} 个失败` : ""}。`
            : String(
                  controller.sourceAnalysisTask?.result_summary?.phase || "",
                ) === "agent_runtime_queued"
              ? "源稿理解已提交，正在等待可用的 AI 运行槽。"
              : "AI 正在读取并理解源稿，页面会自动刷新进度。",
        )}
        cancelLabel="源稿理解任务"
        retryLabel="重试理解"
      />

      {controller.sourceAnalysis ? (
        <SourceGlanceMap
          analysis={controller.sourceAnalysis}
          aspectRhythm={controller.planAspectRhythm}
          episodeDuration={controller.planEpisodeDuration}
          targetEpisodeCount={controller.planTargetEpisodes}
          visualStyle={controller.planVisualStyle}
        />
      ) : null}

      <div className="drama-stage-action-row">
        <div>
          <strong>{sourceActionTitle}</strong>
          <p>{sourceActionDescription}</p>
        </div>
        <Button
          type="button"
          disabled={
            controller.readOnly ||
            !controller.hasUsableNovelSource ||
            controller.planBusy
          }
          onClick={() => {
            if (sourceAnalysisReady) {
              controller.openScriptPlanning();
              return;
            }
            void controller.startSourceAnalysis();
          }}
        >
          {controller.planBusy ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Wand2 size={15} />
          )}
          {sourceActionLabel}
        </Button>
      </div>

      <SourceReplacementConfirmDialog controller={controller} />
    </section>
  );
}

function PlanStage({
  controller,
  dramaId,
}: Pick<DramaEpisodesStagePanelProps, "controller" | "dramaId">) {
  const [confirmReplaceOpen, setConfirmReplaceOpen] = useState(false);
  const plannedEpisodeCount = controller.planTargetEpisodes;
  const configurationNeedsDecision =
    controller.targetSettingsDirty && controller.blueprintEpisodes.length > 0;
  const allBlueprintsReady =
    !configurationNeedsDecision &&
    controller.blueprintEpisodes.length >= plannedEpisodeCount;
  const hasExistingScripts = controller.scriptReadyEpisodes.length > 0;

  function requestBlueprintGeneration() {
    if (hasExistingScripts) {
      setConfirmReplaceOpen(true);
      return;
    }
    void controller.createEpisodesFromPlan();
  }

  return (
    <section className="drama-stage-section">
      <div className="drama-stage-section-head">
        <div>
          <span>步骤 2/5 · 分集规划</span>
          <h3>确认改编配置，生成全剧分集蓝图</h3>
          <p>本步只决定每一集讲什么；剧本正文会在下一步由你选择范围后生成。</p>
        </div>
        <span className="drama-stage-count">
          {controller.blueprintEpisodes.length}/{plannedEpisodeCount} 集蓝图
        </span>
      </div>

      {controller.sourceAnalysis ? (
        <section className="drama-plan-input-summary" aria-label="源稿理解建议">
          <div>
            <span>本步输入 · 源稿理解建议</span>
            <strong>源稿理解建议</strong>
          </div>
          <dl>
            <div>
              <dt>主题</dt>
              <dd>{controller.sourceAnalysis.theme || "待补全"}</dd>
            </div>
            <div>
              <dt>核心冲突</dt>
              <dd>{controller.sourceAnalysis.core_conflict || "待补全"}</dd>
            </div>
            <div>
              <dt>推荐集数</dt>
              <dd>
                {controller.sourceAnalysis.target_episode_count ||
                  controller.planTargetEpisodes}{" "}
                集
              </dd>
            </div>
            <div>
              <dt>推荐单集时长</dt>
              <dd>
                {controller.sourceAnalysis.episode_duration ||
                  controller.planEpisodeDuration}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <div className="drama-plan-config-head">
        <div>
          <span>可编辑 · 项目配置</span>
          <p>修改集数、时长、风格或节奏后，需要明确保留旧蓝图或重新规划。</p>
        </div>
        {controller.blueprintBusy ? <span>本次规划配置已锁定</span> : null}
      </div>

      <AdaptationTargetFields
        disabled={controller.blueprintBusy}
        gridClassName="sm:grid-cols-2 xl:grid-cols-4"
        targetEpisodeCount={controller.planTargetEpisodes}
        onTargetEpisodeCountChange={controller.setPlanTargetEpisodes}
        episodeDuration={controller.planEpisodeDuration}
        onEpisodeDurationChange={controller.setPlanEpisodeDuration}
        visualStyle={controller.planVisualStyle}
        onVisualStyleChange={controller.setPlanVisualStyle}
        aspectRhythm={controller.planAspectRhythm}
        onAspectRhythmChange={controller.setPlanAspectRhythm}
      />

      <DramaAiTaskProgress
        controller={controller}
        task={controller.blueprintTask}
        active={controller.blueprintTaskActive}
        failed={controller.blueprintTaskFailed}
        label={
          controller.blueprintTaskActive
            ? controller.formatBlueprintPhase(
                controller.blueprintTask?.result_summary,
              )
            : "分集规划"
        }
        progress={controller.blueprintTaskProgress}
        detail={controller.formatBlueprintDetail(
          controller.blueprintTask?.result_summary,
        )}
        cancelLabel="分集蓝图任务"
        retryLabel="重试规划"
      />

      {configurationNeedsDecision ? (
        <div className="drama-stage-notice is-warning">
          <AlertTriangle size={16} />
          <div>
            <strong>改编配置已变更</strong>
            <p>
              当前 {controller.blueprintEpisodes.length}{" "}
              集蓝图仍按已保存配置生成。请保留旧蓝图继续正文，或按新配置重新生成。
            </p>
          </div>
        </div>
      ) : null}

      {!controller.blueprintEpisodes.length ? (
        <EmptyStage
          icon={FileText}
          title="准备生成全剧分集规划"
          description="系统会按当前集数、时长、视觉与节奏配置，生成每集标题、核心事件、钩子和悬念。"
          action={
            <Button
              type="button"
              disabled={
                controller.readOnly ||
                controller.blueprintBusy ||
                controller.planBusy ||
                !controller.hasUsableNovelSource
              }
              onClick={requestBlueprintGeneration}
            >
              {controller.blueprintBusy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <CheckCircle2 size={15} />
              )}
              {controller.blueprintBusy
                ? "规划中"
                : `生成 ${plannedEpisodeCount} 集分集规划`}
            </Button>
          }
        />
      ) : (
        <>
          <div className="drama-stage-action-row">
            <div>
              <strong>
                {configurationNeedsDecision
                  ? "改编配置等待确认"
                  : allBlueprintsReady
                    ? "分集规划已完成"
                    : `还差 ${Math.max(0, plannedEpisodeCount - controller.blueprintEpisodes.length)} 集蓝图`}
              </strong>
              <p>
                {configurationNeedsDecision
                  ? "配置未保存到项目，也不会静默覆盖现有蓝图。"
                  : allBlueprintsReady
                    ? "检查每集标题、核心事件和结尾钩子后，再显式进入剧本正文。"
                    : "当前规划未覆盖目标集数，重新生成会按当前配置补齐全剧蓝图。"}
              </p>
            </div>
            {configurationNeedsDecision ? (
              <div className="drama-stage-action-row-buttons">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={controller.readOnly || controller.blueprintBusy}
                  onClick={controller.proceedWithExistingBlueprints}
                >
                  保留旧蓝图并进入剧本正文
                </Button>
                <Button
                  type="button"
                  disabled={controller.readOnly || controller.blueprintBusy}
                  onClick={requestBlueprintGeneration}
                >
                  {controller.blueprintBusy ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {controller.blueprintBusy
                    ? "规划中"
                    : `重新生成 ${plannedEpisodeCount} 集分集规划`}
                </Button>
              </div>
            ) : allBlueprintsReady ? (
              <div className="drama-stage-action-row-buttons">
                <Button
                  type="button"
                  variant="outline"
                  disabled={controller.readOnly || controller.blueprintBusy}
                  onClick={requestBlueprintGeneration}
                >
                  <RefreshCw size={15} />
                  重新生成分集规划
                </Button>
                <Button asChild type="button">
                  <Link href={getProjectStageHref(dramaId, "script")}>
                    开始生成剧本正文
                  </Link>
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                disabled={controller.readOnly || controller.blueprintBusy}
                onClick={requestBlueprintGeneration}
              >
                {controller.blueprintBusy ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                {controller.blueprintBusy
                  ? "规划中"
                  : `重新生成 ${plannedEpisodeCount} 集分集规划`}
              </Button>
            )}
          </div>

          <div className="drama-stage-episode-list">
            {controller.plannedEpisodes.map((episode) => {
              const blueprint = normalizeEpisodeBlueprintPayload(
                episode.blueprint_payload,
              );
              if (!blueprint) return null;
              return (
                <article key={episode.id} className="drama-stage-episode-row">
                  <div className="drama-stage-episode-number">
                    第 {episode.episode_number} 集
                  </div>
                  <div className="drama-stage-episode-copy">
                    <strong>
                      {episode.title || `第 ${episode.episode_number} 集`}
                    </strong>
                    <p>核心事件：{blueprint.summary || "待补全"}</p>
                    <div className="drama-stage-episode-facts">
                      <span>
                        开场钩子：{blueprint.opening_hook || "待补全"}
                      </span>
                      <span>结尾悬念：{blueprint.ending_hook || "待补全"}</span>
                    </div>
                  </div>
                  <div className="drama-stage-episode-meta">
                    <span className="is-ready">蓝图已就绪</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={
                        controller.readOnly ||
                        controller.blueprintRegeneratingEpisodeId !== null
                      }
                      onClick={() => {
                        void controller.regenerateEpisodeBlueprint(episode);
                      }}
                    >
                      {controller.blueprintRegeneratingEpisodeId ===
                      episode.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      重规划
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}

      <Dialog open={confirmReplaceOpen} onOpenChange={setConfirmReplaceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeaderBar>
            <DialogTitle>重新规划会使已有剧本失效</DialogTitle>
            <DialogDescription>
              新蓝图会覆盖未锁定的规划内容，已有剧本将标记为需要重写，故事地图与相关分镜也需要复核。
            </DialogDescription>
          </DialogHeaderBar>
          <DialogMain />
          <DialogActions>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmReplaceOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              onClick={() => {
                setConfirmReplaceOpen(false);
                void controller.createEpisodesFromPlan({
                  replaceWithoutScript: true,
                });
              }}
            >
              确认重新规划
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function ScriptStage({
  controller,
  dramaId,
}: Pick<DramaEpisodesStagePanelProps, "controller" | "dramaId">) {
  const [scope, setScope] = useState<"pilot" | "next" | "all">("pilot");
  const plannedEpisodeCount = controller.planTargetEpisodes;
  const currentScriptCount = controller.currentScriptReadyEpisodes.length;
  const scriptsComplete = currentScriptCount >= plannedEpisodeCount;
  const pilotEpisodes = controller.pilotPendingEpisodes.filter(
    (episode) => episode.episode_number <= 3,
  );
  const nextBatchEpisodes = controller.pilotPendingEpisodes.slice(0, 3);
  const effectiveScope =
    scope === "pilot" && !pilotEpisodes.length ? "next" : scope;
  const selectedEpisodes =
    effectiveScope === "all"
      ? controller.pilotPendingEpisodes
      : effectiveScope === "pilot"
        ? pilotEpisodes
        : nextBatchEpisodes;
  const scopeLabel =
    effectiveScope === "all"
      ? `生成剩余 ${selectedEpisodes.length} 集剧本`
      : effectiveScope === "pilot"
        ? `生成前 ${selectedEpisodes.length} 集剧本`
        : `生成下一批 ${selectedEpisodes.length} 集剧本`;

  return (
    <section className="drama-stage-section">
      <div className="drama-stage-section-head">
        <div>
          <span>步骤 3/5 · 剧本正文</span>
          <h3>按分集蓝图生成可编辑的逐集剧本</h3>
          <p>
            先用试播范围审阅风格，再分批或一次性补齐全剧；任务完成后始终停留在本页。
          </p>
        </div>
        <span className="drama-stage-count">
          {currentScriptCount}/{plannedEpisodeCount} 集正文
        </span>
      </div>

      <div className="drama-script-input-summary">
        <strong>本步输入</strong>
        <span>
          {controller.blueprintEpisodes.length}/{plannedEpisodeCount}{" "}
          集蓝图已完成
        </span>
        <p>剧本正文只会基于当前分集蓝图生成；可先试播，再继续补齐后续集数。</p>
      </div>

      <DramaAiTaskProgress
        controller={controller}
        task={controller.pilotScriptTask}
        active={controller.pilotScriptTaskActive}
        failed={controller.pilotScriptTaskFailed}
        label={
          controller.pilotScriptTaskActive
            ? controller.formatPilotScriptPhase(
                controller.pilotScriptTask?.result_summary,
              )
            : "剧本正文"
        }
        progress={controller.pilotScriptTaskProgress}
        detail={controller.formatPilotScriptDetail(
          controller.pilotScriptTask?.result_summary,
        )}
        cancelLabel="剧本正文任务"
        retryLabel="重试正文"
      />

      {scriptsComplete ? (
        <div className="drama-stage-action-row">
          <div>
            <strong>全剧剧本正文已完成</strong>
            <p>
              全部 {plannedEpisodeCount}{" "}
              集正文均为当前版本，可以显式构建正式故事地图。
            </p>
          </div>
          <Button asChild type="button">
            <Link href={getProjectStageHref(dramaId, "graph")}>
              构建故事地图
            </Link>
          </Button>
        </div>
      ) : (
        <div className="drama-stage-action-row">
          <div>
            <strong>
              {controller.pilotPendingEpisodes.length
                ? `还有 ${plannedEpisodeCount - currentScriptCount} 集正文待完成`
                : "有剧本生成失败或需要重写"}
            </strong>
            <p>
              {controller.pilotPendingEpisodes.length
                ? "选择本次范围后开始生成；完成后可继续审阅，或选择下一批。"
                : "请在下方对应剧集重试或重写，全部正文恢复为当前版本后才能构建故事地图。"}
            </p>
          </div>
          {controller.pilotPendingEpisodes.length ? (
            <Button
              type="button"
              disabled={
                controller.readOnly ||
                controller.pilotScriptBusy ||
                !selectedEpisodes.length
              }
              onClick={() => {
                void controller.generatePilotScripts({
                  episodeIds: selectedEpisodes.map((episode) => episode.id),
                  limit: selectedEpisodes.length,
                });
              }}
            >
              {controller.pilotScriptBusy ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Wand2 size={15} />
              )}
              {controller.pilotScriptBusy ? "生成中" : scopeLabel}
            </Button>
          ) : null}
        </div>
      )}

      {!scriptsComplete ? (
        <div
          className="drama-story-graph-segmented"
          role="tablist"
          aria-label="剧本生成范围"
        >
          {(
            [
              ["pilot", "前 3 集试播"],
              ["next", "下一批"],
              ["all", "全部剩余"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={effectiveScope === key}
              data-active={effectiveScope === key || undefined}
              disabled={key === "pilot" && !pilotEpisodes.length}
              onClick={() => setScope(key)}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="drama-stage-episode-list">
        {controller.plannedEpisodes.map((episode) => {
          const blueprint = normalizeEpisodeBlueprintPayload(
            episode.blueprint_payload,
          );
          const staleLabel = getEpisodeStaleLabel(episode);
          const canGenerate = Boolean(
            blueprint && (!hasScript(episode) || staleLabel),
          );
          return (
            <article key={episode.id} className="drama-stage-episode-row">
              <div className="drama-stage-episode-number">
                第 {episode.episode_number} 集
              </div>
              <div className="drama-stage-episode-copy">
                <strong>
                  {episode.title || `第 ${episode.episode_number} 集`}
                </strong>
                <p>
                  {staleLabel
                    ? "上游内容已更新，需要重写正文。"
                    : hasScript(episode)
                      ? "正文已生成，可打开单集审阅与编辑。"
                      : blueprint
                        ? "蓝图已就绪，等待生成正文。"
                        : "请先回到分集规划补齐蓝图。"}
                </p>
              </div>
              <div className="drama-stage-episode-meta">
                <span
                  className={cn(
                    hasScript(episode) && !staleLabel && "is-ready",
                  )}
                >
                  {staleLabel ||
                    (hasScript(episode)
                      ? "正文已生成"
                      : episode.failure_reason
                        ? "生成失败"
                        : "待生成")}
                </span>
                {canGenerate ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={
                      controller.readOnly ||
                      controller.scriptGeneratingEpisodeId !== null
                    }
                    onClick={() => {
                      void controller.generateEpisodeScript(
                        episode,
                        Boolean(staleLabel),
                      );
                    }}
                  >
                    {controller.scriptGeneratingEpisodeId === episode.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Wand2 size={14} />
                    )}
                    {staleLabel
                      ? "重写"
                      : episode.failure_reason
                        ? "重试"
                        : "生成"}
                  </Button>
                ) : null}
                <Button asChild type="button" variant="outline" size="sm">
                  <Link
                    href={getEpisodeWorkbenchHref(
                      dramaId,
                      episode.episode_number,
                      hasScript(episode) ? "script-rewrite" : "script-raw",
                    )}
                  >
                    打开
                  </Link>
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function StoryboardStage({
  controller,
  dramaId,
  workspaceEpisodes,
}: Pick<
  DramaEpisodesStagePanelProps,
  "controller" | "dramaId" | "workspaceEpisodes"
>) {
  const storyboardByEpisode = new Map(
    workspaceEpisodes.map((episode) => [episode.id, episode.storyboard_count]),
  );
  const storyboardReviewStatusByEpisode = new Map(
    workspaceEpisodes.map((episode) => [episode.id, episode.review_status]),
  );
  const plannedWorkspaceEpisodes = workspaceEpisodes.filter((episode) =>
    controller.plannedEpisodes.some(
      (plannedEpisode) => plannedEpisode.id === episode.id,
    ),
  );
  const totalStoryboards = plannedWorkspaceEpisodes.reduce(
    (sum, episode) => sum + episode.storyboard_count,
    0,
  );
  const needsStoryboardReview = (
    episode: (typeof controller.plannedEpisodes)[number],
  ) => {
    const count = storyboardByEpisode.get(episode.id) ?? 0;
    return (
      count > 0 &&
      (Boolean(getEpisodeStaleLabel(episode)) ||
        storyboardReviewStatusByEpisode.get(episode.id) ===
          "storyboard_review_required" ||
        episode.review_status === "storyboard_review_required")
    );
  };
  const storyboardCompleteEpisodes = controller.plannedEpisodes.filter(
    (episode) =>
      (storyboardByEpisode.get(episode.id) ?? 0) > 0 &&
      !needsStoryboardReview(episode),
  ).length;
  const storyboardReviewEpisodes = controller.plannedEpisodes.filter(
    needsStoryboardReview,
  ).length;
  const storyboardsComplete =
    controller.plannedEpisodes.length > 0 &&
    storyboardCompleteEpisodes >= controller.plannedEpisodes.length;
  const storyboardTarget =
    controller.plannedEpisodes.find((episode) => {
      const count = storyboardByEpisode.get(episode.id) ?? 0;
      return (
        hasScript(episode) &&
        !getEpisodeStaleLabel(episode) &&
        (count === 0 || needsStoryboardReview(episode))
      );
    }) ||
    controller.currentScriptReadyEpisodes[0] ||
    null;

  return (
    <section className="drama-stage-section">
      <div className="drama-stage-section-head">
        <div>
          <span>步骤 5/5 · 分镜制作</span>
          <h3>在单集工作台中确认和生成分镜</h3>
          <p>
            分镜仍以单集为生产单位；项目页负责告诉你覆盖情况，并提供进入当前集的深链。
          </p>
        </div>
        <span className="drama-stage-count">
          {storyboardCompleteEpisodes}/{controller.plannedEpisodes.length} 集 ·{" "}
          {totalStoryboards} 镜
          {storyboardReviewEpisodes
            ? ` · ${storyboardReviewEpisodes} 集待复核`
            : ""}
        </span>
      </div>

      {!controller.scriptReadyEpisodes.length ? (
        <EmptyStage
          icon={Clapperboard}
          title="先生成至少一集剧本正文"
          description="分镜生成依赖单集正文，完成后可直接从下方列表进入单集分镜步骤。"
          action={
            <Button asChild type="button">
              <Link href={getProjectStageHref(dramaId, "script")}>
                进入剧本正文
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {storyboardsComplete ? (
            <div className="drama-stage-action-row">
              <div>
                <strong>全剧分镜已完成</strong>
                <p>
                  已完成 {storyboardCompleteEpisodes}/
                  {controller.plannedEpisodes.length} 集分镜，共{" "}
                  {totalStoryboards} 个镜头。接下来可进入镜头生产或查看成片。
                </p>
              </div>
              <div className="drama-stage-action-row-buttons">
                <Button asChild type="button" variant="outline">
                  <Link href={`/drama/${dramaId}/final`}>查看成片</Link>
                </Button>
                <Button asChild type="button">
                  <Link
                    href={getEpisodeWorkbenchHref(
                      dramaId,
                      controller.plannedEpisodes[0]!.episode_number,
                      "prod-shots",
                    )}
                  >
                    进入镜头生产
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="drama-stage-action-row">
              <div>
                <strong>按集推进分镜</strong>
                <p>
                  {storyboardReviewEpisodes
                    ? `${storyboardReviewEpisodes} 集分镜需要根据最新剧本复核。`
                    : "从单集工作台生成分镜，后续即可进入镜头制作与项目画布。"}
                </p>
              </div>
              {storyboardTarget ? (
                <Button asChild type="button">
                  <Link
                    href={getEpisodeWorkbenchHref(
                      dramaId,
                      storyboardTarget.episode_number,
                      "script-storyboard",
                    )}
                  >
                    <Clapperboard size={15} />
                    {needsStoryboardReview(storyboardTarget)
                      ? `复核第 ${storyboardTarget.episode_number} 集分镜`
                      : storyboardByEpisode.get(storyboardTarget.id)
                        ? `继续第 ${storyboardTarget.episode_number} 集分镜`
                        : `开始第 ${storyboardTarget.episode_number} 集分镜`}
                  </Link>
                </Button>
              ) : null}
            </div>
          )}
          <div className="drama-stage-episode-list">
            {controller.plannedEpisodes.map((episode) => {
              const count = storyboardByEpisode.get(episode.id) ?? 0;
              const staleLabel = getEpisodeStaleLabel(episode);
              const scriptReady = hasScript(episode) && !staleLabel;
              const reviewRequired = needsStoryboardReview(episode);
              return (
                <article key={episode.id} className="drama-stage-episode-row">
                  <div className="drama-stage-episode-number">
                    第 {episode.episode_number} 集
                  </div>
                  <div className="drama-stage-episode-copy">
                    <strong>
                      {episode.title || `第 ${episode.episode_number} 集`}
                    </strong>
                    <p>
                      {staleLabel
                        ? count > 0
                          ? "上游内容已更新。请先重写正文，再复核已有分镜。"
                          : "上游内容已更新，等待重写剧本正文。"
                        : reviewRequired
                          ? "剧本正文已更新，已有分镜需要复核。"
                          : scriptReady
                            ? `${count} 个分镜，进入单集可继续补全。`
                            : "等待剧本正文生成。"}
                    </p>
                  </div>
                  <div className="drama-stage-episode-meta">
                    <span className={cn(count > 0 && "is-ready")}>
                      {staleLabel
                        ? "需重写正文"
                        : reviewRequired
                          ? "需要复核"
                          : count > 0
                            ? `${count} 镜`
                            : scriptReady
                              ? "待生成"
                              : "未就绪"}
                    </span>
                    {scriptReady ? (
                      <Button asChild type="button" variant="outline" size="sm">
                        <Link
                          href={getEpisodeWorkbenchHref(
                            dramaId,
                            episode.episode_number,
                            "script-storyboard",
                          )}
                        >
                          {reviewRequired ? "复核分镜" : "进入分镜"}
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled
                      >
                        进入分镜
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export function DramaEpisodesStagePanel({
  controller,
  dramaId,
  stage,
  workspaceEpisodes,
  scriptedEpisodeCount,
}: DramaEpisodesStagePanelProps) {
  if (controller.loading && !controller.drama) {
    return (
      <div className="drama-stage-loading">
        <Loader2 size={22} className="animate-spin" />
        正在加载 AI-first 向导
      </div>
    );
  }

  if (controller.error && !controller.drama) {
    return (
      <div className="drama-stage-loading">
        <span>{controller.error}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void controller.load();
          }}
        >
          重试
        </Button>
      </div>
    );
  }

  const content =
    stage === "source" ? (
      <SourceStage controller={controller} />
    ) : stage === "plan" ? (
      <PlanStage controller={controller} dramaId={dramaId} />
    ) : stage === "script" ? (
      <ScriptStage controller={controller} dramaId={dramaId} />
    ) : stage === "graph" ? (
      <DramaStoryGraphStagePanel
        controller={controller}
        dramaId={dramaId}
        plannedEpisodeCount={controller.planTargetEpisodes}
        scriptedEpisodeCount={scriptedEpisodeCount}
      />
    ) : (
      <StoryboardStage
        controller={controller}
        dramaId={dramaId}
        workspaceEpisodes={workspaceEpisodes}
      />
    );

  return (
    <div className="drama-stage-board is-single">
      <main className="drama-stage-main">{content}</main>
    </div>
  );
}
