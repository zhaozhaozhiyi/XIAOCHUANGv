"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import {
  dramaAPI,
  type StoryGraphEntity,
  type StoryGraphEvent,
  type StoryGraphRelation,
  type StoryGraphSummaryPayload,
} from "@/lib/api";
import { getAiErrorCopy } from "@/lib/ai-error-copy";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import {
  formatStoryGraphDetail,
  formatStoryGraphPhase,
  isActiveTaskStatus,
  isFailedTaskStatus,
} from "../legacy/ai-first-workbench-parts";
import { DramaAiTaskProgress } from "./DramaAiTaskProgress";
import { DramaStoryGraphForceView } from "./DramaStoryGraphForceView";
import { DramaStoryGraphInspector } from "./DramaStoryGraphInspector";
import { DramaStoryGraphSearchPanel } from "./DramaStoryGraphSearchPanel";
import { getProjectStageHref } from "./episode-route";
import type { DramaAiFirstController } from "./use-drama-ai-first-controller";

type DramaStoryGraphStagePanelProps = {
  controller: DramaAiFirstController;
  dramaId: number;
  plannedEpisodeCount: number;
  scriptedEpisodeCount: number;
};

type GraphView = "graph" | "timeline" | "list";

function groupEntities(items: StoryGraphEntity[]) {
  return {
    characters: items.filter((item) => item.entity_type === "character"),
    scenes: items.filter((item) => item.entity_type === "scene"),
    props: items.filter((item) => item.entity_type === "prop"),
  };
}

export function DramaStoryGraphStagePanel({
  controller,
  dramaId,
  plannedEpisodeCount,
  scriptedEpisodeCount,
}: DramaStoryGraphStagePanelProps) {
  const [summary, setSummary] = useState<StoryGraphSummaryPayload | null>(null);
  const [entities, setEntities] = useState<StoryGraphEntity[]>([]);
  const [relations, setRelations] = useState<StoryGraphRelation[]>([]);
  const [events, setEvents] = useState<StoryGraphEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [view, setView] = useState<GraphView>("graph");
  const [selectedEntityId, setSelectedEntityId] = useState<number | null>(null);
  const [selectedRelationId, setSelectedRelationId] = useState<number | null>(
    null,
  );

  const storyGraphTask = summary?.story_graph_task ?? controller.storyGraphTask;
  const taskActive = isActiveTaskStatus(storyGraphTask?.status);
  const taskFailed = isFailedTaskStatus(storyGraphTask?.status);
  const taskDetail = formatStoryGraphDetail(
    storyGraphTask?.result_summary ?? null,
  );
  const graphReady = summary?.graph?.status === "ready";
  const graphUsable = Boolean(graphReady && !summary?.is_stale);
  const scriptsComplete =
    summary?.scripts_complete ?? scriptedEpisodeCount >= plannedEpisodeCount;
  const grouped = useMemo(() => groupEntities(entities), [entities]);
  const selectedEntity =
    entities.find((entity) => entity.id === selectedEntityId) || null;
  const selectedRelation =
    relations.find((relation) => relation.id === selectedRelationId) || null;
  const graphSummaryText = [
    summary?.graph?.summary?.theme,
    summary?.graph?.summary?.core_conflict,
    summary?.graph?.summary?.protagonist,
  ]
    .filter(Boolean)
    .join(" · ");

  const loadGraph = useCallback(async () => {
    try {
      setLoading(true);
      const [nextSummary, entityPayload, relationPayload, eventPayload] =
        await Promise.all([
          dramaAPI.getStoryGraph(dramaId),
          dramaAPI.listStoryGraphEntities(dramaId),
          dramaAPI.listStoryGraphRelations(dramaId),
          dramaAPI.listStoryGraphEvents(dramaId),
        ]);
      setSummary(nextSummary);
      setEntities(entityPayload.items);
      setRelations(relationPayload.items);
      setEvents(eventPayload.items);
    } catch (err) {
      toast.error("加载故事地图失败", { description: getAiErrorCopy(err) });
    } finally {
      setLoading(false);
    }
  }, [dramaId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadGraph();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadGraph]);

  useEffect(() => {
    if (!taskActive) return undefined;
    const timer = window.setInterval(() => {
      void loadGraph();
      void controller.load();
    }, 2500);
    return () => window.clearInterval(timer);
  }, [controller, loadGraph, taskActive]);

  async function handleBuild(force = false) {
    if (controller.readOnly) return;
    try {
      setBuilding(true);
      const payload = await dramaAPI.buildStoryGraph(dramaId, { force });
      setSummary(payload);
      await loadGraph();
      await controller.load();
      toast.success(force ? "故事地图重建已启动" : "故事地图构建已启动");
    } catch (err) {
      toast.error("构建故事地图失败", { description: getAiErrorCopy(err) });
    } finally {
      setBuilding(false);
    }
  }

  if (loading && !summary) {
    return (
      <div className="drama-stage-loading">
        <Loader2 size={22} className="animate-spin" />
        正在加载故事地图
      </div>
    );
  }

  return (
    <section className="drama-stage-section">
      <div className="drama-stage-section-head">
        <div>
          <span>步骤 4/5 · 故事地图</span>
          <h3>从剧本抽取角色、关系与事件</h3>
          <p>故事地图是剧本的结构化产物，会非破坏性地 seed 到项目资产库。</p>
        </div>
        {graphReady ? (
          <span className="drama-stage-count">
            {grouped.characters.length} 角色 · {relations.length} 关系 ·{" "}
            {events.length} 事件
          </span>
        ) : null}
      </div>

      {!scriptsComplete ? (
        <div className="drama-stage-notice is-warning">
          <strong>剧本正文尚未全部完成</strong>
          <p>
            需先完成并更新全部 {plannedEpisodeCount}{" "}
            集正文，才能从全剧剧本构建正式故事地图。
          </p>
        </div>
      ) : null}

      {summary?.is_stale ? (
        <div className="drama-story-graph-stale-banner">
          <div>
            <strong>剧本已变更，故事地图已过期</strong>
            <p>
              当前地图基于旧版 `script_hash`，重建后会保留已 seed 的资产关联。
            </p>
          </div>
        </div>
      ) : null}

      {(taskActive || taskFailed) && storyGraphTask ? (
        <DramaAiTaskProgress
          active={taskActive}
          cancelLabel="故事地图任务"
          controller={controller}
          detail={taskDetail}
          failed={taskFailed}
          label="故事地图构建"
          progress={storyGraphTask.progress ?? 0}
          retryLabel="重试构建"
          task={storyGraphTask}
        />
      ) : null}

      <div className="drama-stage-action-row">
        <div>
          <strong>
            {graphUsable
              ? "故事地图已就绪"
              : summary?.is_stale
                ? "故事地图需要重建"
                : "构建故事地图"}
          </strong>
          <p>
            {graphUsable
              ? "可切换关系图、时间线与实体列表，并显式进入分镜制作。"
              : summary?.is_stale
                ? "剧本已经变化，当前地图只供查看；重建完成后才能进入分镜制作。"
                : `将基于全部 ${scriptedEpisodeCount}/${plannedEpisodeCount} 集剧本正文自动抽取图谱。`}
          </p>
        </div>
        <div className="drama-stage-action-row-buttons">
          {graphUsable ? (
            <>
              <Button
                type="button"
                variant="outline"
                disabled={controller.readOnly || building || taskActive}
                onClick={() => {
                  void handleBuild(true);
                }}
              >
                <RefreshCw size={15} />
                重建故事地图
              </Button>
              <Button asChild type="button">
                <Link href={getProjectStageHref(dramaId, "storyboard")}>
                  开始分镜制作
                </Link>
              </Button>
            </>
          ) : null}
          {!graphUsable ? (
            <Button
              type="button"
              disabled={
                controller.readOnly ||
                building ||
                taskActive ||
                !scriptsComplete
              }
              onClick={() => {
                void handleBuild(Boolean(graphReady || summary?.is_stale));
              }}
            >
              {building || taskActive ? (
                <Loader2 size={15} className="animate-spin" />
              ) : graphReady ? (
                <RefreshCw size={15} />
              ) : (
                <Sparkles size={15} />
              )}
              {building || taskActive
                ? "构建中"
                : graphReady
                  ? "重建故事地图"
                  : "构建故事地图"}
            </Button>
          ) : null}
        </div>
      </div>

      {graphReady ? (
        <>
          <div className="drama-story-graph-stats">
            <button
              type="button"
              onClick={() => {
                setView("list");
                setSelectedEntityId(null);
              }}
            >
              <span>角色</span>
              <strong>{grouped.characters.length}</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                setView("list");
                setSelectedEntityId(null);
              }}
            >
              <span>场景</span>
              <strong>{grouped.scenes.length}</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                setView("graph");
                setSelectedEntityId(null);
              }}
            >
              <span>关系</span>
              <strong>{relations.length}</strong>
            </button>
            <button
              type="button"
              onClick={() => {
                setView("timeline");
                setSelectedEntityId(null);
              }}
            >
              <span>事件</span>
              <strong>{events.length}</strong>
            </button>
          </div>

          {graphSummaryText ? (
            <div className="drama-story-graph-summary-strip">
              {graphSummaryText}
            </div>
          ) : null}

          <DramaStoryGraphSearchPanel
            dramaId={dramaId}
            disabled={controller.readOnly}
            onSelectEntity={(entityId) => {
              setView("graph");
              setSelectedEntityId(entityId);
              setSelectedRelationId(null);
            }}
            onSelectRelation={(relationId) => {
              setView("graph");
              setSelectedRelationId(relationId);
              setSelectedEntityId(null);
            }}
          />

          <div
            className="drama-story-graph-segmented"
            role="tablist"
            aria-label="故事地图视图"
          >
            {(
              [
                ["graph", "关系图"],
                ["timeline", "时间线"],
                ["list", "实体列表"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                data-active={view === key || undefined}
                onClick={() => setView(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            className={cn(
              "drama-story-graph-workspace",
              (selectedEntity || selectedRelation) && "has-inspector",
            )}
          >
            <div className="drama-story-graph-main">
              {view === "graph" ? (
                <DramaStoryGraphForceView
                  entities={entities}
                  relations={relations}
                  selectedEntityId={selectedEntityId}
                  onSelectEntity={setSelectedEntityId}
                  onSelectRelation={setSelectedRelationId}
                />
              ) : null}

              {view === "timeline" ? (
                <div className="drama-story-graph-event-list is-timeline">
                  {events.map((event) => (
                    <article
                      key={event.id}
                      className="drama-story-graph-event-row"
                    >
                      <span>第 {event.episode_number ?? "?"} 集</span>
                      <div>
                        <strong>{event.title}</strong>
                        {event.summary ? <p>{event.summary}</p> : null}
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}

              {view === "list" ? (
                <div className="drama-story-graph-entity-list is-full">
                  {entities.map((entity) => (
                    <button
                      key={entity.id}
                      type="button"
                      className={cn(
                        "drama-story-graph-entity-row is-clickable",
                        selectedEntityId === entity.id && "is-selected",
                      )}
                      onClick={() => {
                        setSelectedRelationId(null);
                        setSelectedEntityId(entity.id);
                      }}
                    >
                      <div>
                        <strong>
                          {entity.display_name || entity.canonical_name}
                        </strong>
                        <small>
                          {entity.entity_type}
                          {entity.role ? ` · ${entity.role}` : ""}
                        </small>
                      </div>
                      <span
                        className={cn(
                          entity.seed_status === "seeded" ||
                            entity.seed_status === "linked"
                            ? "is-ready"
                            : undefined,
                        )}
                      >
                        {entity.seed_status}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <DramaStoryGraphInspector
              dramaId={dramaId}
              entity={selectedEntity}
              relation={selectedRelation}
              onClose={() => {
                setSelectedEntityId(null);
                setSelectedRelationId(null);
              }}
            />
          </div>
        </>
      ) : null}
    </section>
  );
}
