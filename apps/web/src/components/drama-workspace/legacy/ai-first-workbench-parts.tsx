"use client";

import Image from "next/image";
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Mountain,
  RefreshCw,
  UserRound,
  Wand2,
} from "lucide-react";
import { dramaStyleLabel, dramaStyleSelectOptions } from "@/lib/drama-style";
import {
  type AdaptationPlan,
  type NovelSource,
  type NovelSourceChapter,
} from "@/lib/drama-metadata";
import { staticUrl } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeaderBar,
  DialogMain,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BaseSelect } from "@/components/shared/base-select";
import type { AdaptationBrief, Drama, Episode } from "@/types/api";

export function hasScript(ep: Episode) {
  return !!ep.script_content;
}

export function formatEpisodeDuration(duration: number | null) {
  if (!duration) return "0 分钟";
  if (duration < 60) return `${duration} 秒`;
  return `${Math.ceil(duration / 60)} 分钟`;
}

export function normalizePromptText(value: string | null | undefined) {
  return String(value || "")
    .replace(/[#*_`>\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncatePromptText(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

export function buildNovelSummaryReference(drama: Drama) {
  const episodeSummary = (drama.episodes || [])
    .slice(0, 3)
    .map((episode) =>
      normalizePromptText(
        episode.script_content || episode.content || episode.description,
      ),
    )
    .filter(Boolean)
    .join(" ");

  const characterSummary = (drama.characters || [])
    .slice(0, 6)
    .map((character) => {
      const detail = normalizePromptText(
        character.description || character.appearance || character.personality,
      );
      return detail ? `${character.name}：${detail}` : character.name;
    })
    .filter(Boolean)
    .join("；");

  const sceneSummary = (drama.scenes || [])
    .slice(0, 6)
    .map((scene) => {
      const detail = normalizePromptText(scene.prompt);
      return detail ? `${scene.location || "场景"}：${detail}` : scene.location;
    })
    .filter(Boolean)
    .join("；");

  return [
    drama.description
      ? `小说/项目总结：${normalizePromptText(drama.description)}`
      : "",
    episodeSummary
      ? `正文内容参考：${truncatePromptText(episodeSummary, 1200)}`
      : "",
    characterSummary
      ? `主要角色参考：${truncatePromptText(characterSummary, 500)}`
      : "",
    sceneSummary
      ? `关键场景参考：${truncatePromptText(sceneSummary, 500)}`
      : "",
  ]
    .filter(Boolean)
    .join("。");
}

export function buildCoverPrompt(drama: Drama) {
  const summaryReference = buildNovelSummaryReference(drama);
  const details = [
    `短剧项目《${drama.title}》`,
    drama.genre ? `题材：${drama.genre}` : "",
    drama.style ? `视觉风格：${dramaStyleLabel(drama.style)}` : "",
    summaryReference,
  ]
    .filter(Boolean)
    .join("。");
  return `${details}。请严格参考以上小说内容、角色关系、关键场景和情绪基调生成封面，不要生成与故事无关的通用风景。生成一张 16:9 横版短剧封面图，电影级构图，主体明确，适合作为项目头图和海报背景，画面中不要出现文字、字幕、Logo、水印。`;
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isActiveTaskStatus(status: string | null | undefined) {
  return status === "queued" || status === "running";
}

export function isFailedTaskStatus(status: string | null | undefined) {
  return (
    status === "failed" || status === "dead_letter" || status === "canceled"
  );
}

export function getEpisodeStaleLabel(ep: Episode) {
  const mode = String(ep.generation_mode || "");
  if (mode.includes("source_stale")) return "来源已更新";
  if (mode.includes("analysis_stale")) return "理解已更新";
  if (mode.includes("strategy_stale")) return "策略已更新";
  if (mode.includes("blueprint_stale")) return "蓝图已更新";
  return "";
}

export function formatTaskProgress(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function summaryText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function summaryNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function summaryRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function formatRuntimeTaskDetail(
  summary: Record<string, unknown> | null | undefined,
  fallback: string,
) {
  const progress = summaryRecord(summary?.agent_progress);
  const action =
    summaryText(progress.current_action) ||
    summaryText(progress.message) ||
    summaryText(summary?.current_action) ||
    summaryText(summary?.message);
  if (!action) return fallback;
  const actionText = `最近动作：${action}。`;
  const base = fallback.trim();
  if (!base || base === actionText) return actionText;
  return `${actionText}${base}`;
}

export function formatSourceAnalysisPhase(
  summary: Record<string, unknown> | null | undefined,
) {
  const phase = String(summary?.phase || "");
  if (phase === "queued") return "等待 AI 分析任务开始";
  if (phase === "agent_runtime_queued") return "源稿理解已排队";
  if (phase === "agent_runtime_running") return "正在理解源稿";
  if (phase === "agent_runtime_progress") return "正在理解源稿";
  if (phase === "loading_source") return "正在读取源稿";
  if (phase === "source_analysis") return "正在理解源稿";
  if (phase === "chunk_analysis") return "正在分块理解长篇源稿";
  if (phase === "global_summary") return "正在汇总全书主线";
  if (phase === "writing_analysis") return "正在写入源稿分析";
  if (phase === "completed") return "源稿理解已完成";
  if (phase === "chunk_failed") return "部分分块理解失败";
  return "源稿理解任务进行中";
}

export function formatBriefPhase(
  summary: Record<string, unknown> | null | undefined,
) {
  const phase = String(summary?.phase || "");
  if (phase === "queued") return "等待生成改编策略";
  if (phase === "loading_context") return "正在读取源稿理解";
  if (phase === "adaptation_briefs") return "正在生成改编策略";
  if (phase === "writing_briefs") return "正在写入策略结果";
  if (phase === "completed") return "改编策略已完成";
  if (phase === "failed") return "改编策略生成失败";
  return "改编策略任务进行中";
}

export function formatBriefDetail(
  summary: Record<string, unknown> | null | undefined,
) {
  const count = Number(summary?.brief_count || 0);
  const target = Number(summary?.target_episode_count || 0);
  const countText = count > 0 ? `${count} 套策略` : "多套策略";
  return target > 0
    ? `将生成 ${countText}，目标 ${target} 集。`
    : `将生成 ${countText}，页面会自动刷新进度。`;
}

export function formatBlueprintPhase(
  summary: Record<string, unknown> | null | undefined,
) {
  const phase = String(summary?.phase || "");
  if (phase === "queued") return "等待生成分集蓝图";
  if (phase === "agent_runtime_queued") return "分集规划已排队";
  if (phase === "agent_runtime_running") return "正在规划分集";
  if (phase === "agent_runtime_progress") return "正在规划分集";
  if (phase === "loading_context") return "正在读取改编策略";
  if (phase === "blueprint_generate") return "正在生成分集蓝图";
  if (phase === "blueprint_batch_submitted") return "正在写入分集蓝图";
  if (phase === "writing_blueprints") return "正在写入真实分集";
  if (phase === "completed") return "分集蓝图已完成";
  if (phase === "failed") return "分集蓝图生成失败";
  return "分集蓝图任务进行中";
}

export function formatBlueprintDetail(
  summary: Record<string, unknown> | null | undefined,
) {
  const total = Number(
    summary?.total_episodes || summary?.target_episode_count || 0,
  );
  const generated = Number(summary?.generated_episodes || 0);
  let detail = "任务已进入队列，页面会自动刷新进度。";
  if (total > 0) {
    detail = generated > 0
      ? `${generated}/${total} 集蓝图已写入。`
      : `目标 ${total} 集，页面会自动刷新进度。`;
  }
  return formatRuntimeTaskDetail(summary, detail);
}

export function formatPilotScriptPhase(
  summary: Record<string, unknown> | null | undefined,
) {
  const phase = String(summary?.phase || "");
  if (phase === "queued") return "等待生成剧本正文";
  if (phase === "agent_runtime_queued") return "剧本正文已排队";
  if (phase === "agent_runtime_running") return "正在生成剧本正文";
  if (phase === "agent_runtime_progress") return "正在生成剧本正文";
  if (phase === "loading_episodes") return "正在读取分集蓝图";
  if (phase === "pilot_scripts") return "准备生成剧本正文";
  if (phase === "episode_script") return "正在生成剧本正文";
  if (phase === "episode_script_submitted") return "正在写入剧本正文";
  if (phase === "episode_failed") return "部分剧本正文生成失败";
  if (phase === "completed") return "剧本正文已完成";
  if (phase === "failed") return "剧本正文生成失败";
  return "剧本正文任务进行中";
}

export function formatPilotScriptDetail(
  summary: Record<string, unknown> | null | undefined,
) {
  const total = Number(summary?.total_episodes || 0);
  const completed = Number(summary?.completed_episodes || 0);
  const failed = Number(summary?.failed_episodes || 0);
  const currentEpisodeNumber = Number(summary?.current_episode_number || 0);
  let detail = "任务已进入队列，页面会自动刷新进度。";
  if (total > 0) {
    const current =
      currentEpisodeNumber > 0 ? `，当前第 ${currentEpisodeNumber} 集` : "";
    detail = `${completed}/${total} 集已完成${failed > 0 ? `，${failed} 集失败` : ""}${current}。`;
  }
  return formatRuntimeTaskDetail(summary, detail);
}

export function formatStoryGraphPhase(
  summary: Record<string, unknown> | null | undefined,
) {
  const phase = String(summary?.phase || "");
  if (phase === "queued") return "等待构建故事地图";
  if (phase === "agent_runtime_queued") return "故事地图已排队";
  if (phase === "agent_runtime_running") return "正在构建故事地图";
  if (phase === "agent_runtime_progress") return "正在构建故事地图";
  if (phase === "collecting_scripts") return "正在读取全剧正文";
  if (phase === "story_graph_batch_submitted") return "正在汇集故事地图草稿";
  if (phase === "story_graph_finalizing") return "正在写入正式故事地图";
  if (phase === "writing_graph") return "正在写入故事地图";
  if (phase === "seeding_assets") return "正在关联角色与场景资产";
  if (phase === "indexing_search") return "正在建立故事地图检索";
  if (phase === "completed") return "故事地图已完成";
  if (phase === "failed") return "故事地图构建失败";
  return "故事地图构建进行中";
}

export function formatStoryGraphDetail(
  summary: Record<string, unknown> | null | undefined,
) {
  const entities = summaryNumber(summary?.submitted_entities);
  const relations = summaryNumber(summary?.submitted_relations);
  const events = summaryNumber(summary?.submitted_events);
  const parts = [
    entities ? `${entities} 个实体` : "",
    relations ? `${relations} 条关系` : "",
    events ? `${events} 个事件` : "",
  ].filter(Boolean);
  const detail = parts.length
    ? `故事地图草稿已提交 ${parts.join("、")}。`
    : formatStoryGraphPhase(summary);
  return formatRuntimeTaskDetail(summary, detail);
}

export function episodePreviewText(ep: Episode) {
  return String(ep.script_content || ep.content || ep.description || "").trim();
}

export function countNovelWords(content: string) {
  return content.replace(/\s/g, "").length;
}

export function formatCount(value: number) {
  if (value >= 10000)
    return `${(value / 10000).toFixed(value >= 100000 ? 1 : 2).replace(/\.0+$/, "")} 万`;
  return value.toLocaleString();
}

export function buildChapterIndex(content: string): NovelSourceChapter[] {
  const markerPattern =
    /(?:^|\n)\s*(?:#{1,6}\s*)?((?:第\s*[0-9０-９一二三四五六七八九十百千万零〇两俩]+\s*(?:章节|章|節|节|集))|(?:Chapter|CHAPTER)\s*[0-9０-９]+)(?:[：:、\-\s]+([^\n\r]{0,80}))?/g;
  const matches = Array.from(content.matchAll(markerPattern));

  if (!matches.length) {
    const wordCount = countNovelWords(content);
    return wordCount
      ? [
          {
            chapter_no: 1,
            title: "全文",
            word_count: wordCount,
            brief: content.slice(0, 80).replace(/\s+/g, " "),
          },
        ]
      : [];
  }

  return matches
    .map((match, index) => {
      const start = (match.index || 0) + match[0].length;
      const end = matches[index + 1]?.index ?? content.length;
      const body = content.slice(start, end).trim();
      const title = [
        String(match[1] || "").trim(),
        String(match[2] || "").trim(),
      ]
        .filter(Boolean)
        .join("：");
      return {
        chapter_no: index + 1,
        title: title || `第 ${index + 1} 章`,
        word_count: countNovelWords(body),
        brief: body.slice(0, 80).replace(/\s+/g, " "),
      };
    })
    .filter((chapter) => chapter.word_count > 0);
}

export function pickChapterRange(
  chapters: NovelSourceChapter[],
  index: number,
  total: number,
) {
  if (!chapters.length) return "全文";
  const start = Math.floor((index / total) * chapters.length);
  const end = Math.max(
    start,
    Math.floor(((index + 1) / total) * chapters.length) - 1,
  );
  const first = chapters[start];
  const last = chapters[Math.min(end, chapters.length - 1)];
  if (!first || !last) return "全文";
  return first.chapter_no === last.chapter_no
    ? first.title
    : `${first.title} - ${last.title}`;
}

export type AdaptationCharacter = AdaptationPlan["character_bible"][number];
export type AdaptationScene = AdaptationPlan["scene_bible"][number];
export type AdaptationTargetSettings = {
  aspectRhythm: string;
  episodeDuration: string;
  targetEpisodeCount: number;
  visualStyle: string;
};

export function createTargetSettingsKey(settings: AdaptationTargetSettings) {
  return JSON.stringify(settings);
}

type AdaptationTargetFieldsProps = {
  aspectRhythm: string;
  disabled?: boolean;
  episodeDuration: string;
  gridClassName?: string;
  onAspectRhythmChange: (value: string) => void;
  onEpisodeDurationChange: (value: string) => void;
  onTargetEpisodeCountChange: (value: number) => void;
  onVisualStyleChange: (value: string) => void;
  targetEpisodeCount: number;
  visualStyle: string;
};

export function AdaptationTargetFields({
  aspectRhythm,
  disabled = false,
  episodeDuration,
  gridClassName,
  onAspectRhythmChange,
  onEpisodeDurationChange,
  onTargetEpisodeCountChange,
  onVisualStyleChange,
  targetEpisodeCount,
  visualStyle,
}: AdaptationTargetFieldsProps) {
  return (
    <fieldset
      disabled={disabled}
      className={[
        "m-0 grid min-w-0 border-0 p-0 disabled:cursor-not-allowed disabled:opacity-65",
        gridClassName || "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <label className="block min-w-0">
        <span className="text-xs font-medium text-text-3">目标集数</span>
        <div className="mt-2 flex items-center gap-2">
          <Input
            type="number"
            min={1}
            value={targetEpisodeCount}
            onChange={(event) =>
              onTargetEpisodeCountChange(
                Math.max(1, Number(event.target.value) || 1),
              )
            }
            className="h-10 rounded-[12px] border-0 bg-bg-2/80 px-4 text-sm font-semibold shadow-none"
            aria-label="目标集数"
            disabled={disabled}
          />
        </div>
      </label>
      <label className="block min-w-0">
        <span className="text-xs font-medium text-text-3">单集时长</span>
        <BaseSelect
          className="mt-2 [&_button]:h-10 [&_button]:rounded-[12px] [&_button]:border-0 [&_button]:bg-bg-2/80 [&_button]:px-4 [&_button]:text-sm [&_button]:font-semibold [&_button]:shadow-none [&_button:hover]:border-0 [&_button:hover]:bg-bg-hover"
          value={episodeDuration}
          onValueChange={(value) => onEpisodeDurationChange(String(value))}
          options={EPISODE_DURATION_OPTIONS}
          placeholder="选择时长"
          searchable={false}
        />
      </label>
      <label className="block min-w-0">
        <span className="text-xs font-medium text-text-3">视觉风格</span>
        <BaseSelect
          className="mt-2 [&_button]:h-10 [&_button]:rounded-[12px] [&_button]:border-0 [&_button]:bg-bg-2/80 [&_button]:px-4 [&_button]:text-sm [&_button]:font-semibold [&_button]:shadow-none [&_button:hover]:border-0 [&_button:hover]:bg-bg-hover"
          value={visualStyle}
          onValueChange={(value) => onVisualStyleChange(String(value))}
          options={dramaStyleSelectOptions}
          placeholder="选择风格"
          searchable={false}
        />
      </label>
      <label className="block min-w-0">
        <span className="text-xs font-medium text-text-3">画幅节奏</span>
        <BaseSelect
          className="mt-2 [&_button]:h-10 [&_button]:rounded-[12px] [&_button]:border-0 [&_button]:bg-bg-2/80 [&_button]:px-4 [&_button]:text-sm [&_button]:font-semibold [&_button]:shadow-none [&_button:hover]:border-0 [&_button:hover]:bg-bg-hover"
          value={aspectRhythm}
          onValueChange={(value) => onAspectRhythmChange(String(value))}
          options={ASPECT_RHYTHM_OPTIONS}
          placeholder="选择画幅"
          searchable={false}
        />
      </label>
    </fieldset>
  );
}

type LegacyAdaptationPlanNoticeProps = {
  hasSourceIssue: boolean;
  onFixSource: () => void;
  onRegenerate: () => void;
  plan: AdaptationPlan;
  planGenerating: boolean;
  readOnly: boolean;
  sourceAnalysisTaskActive: boolean;
};

export function LegacyAdaptationPlanNotice({
  hasSourceIssue,
  onFixSource,
  onRegenerate,
  plan,
  planGenerating,
  readOnly,
  sourceAnalysisTaskActive,
}: LegacyAdaptationPlanNoticeProps) {
  const loading = planGenerating || sourceAnalysisTaskActive;
  return (
    <div className="mt-4 rounded-[14px] border border-warning/30 bg-warning-bg px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-warning">
            <AlertTriangle size={15} className="shrink-0" />
            旧方案草稿
          </div>
          <p className="mt-2 text-sm leading-6 text-text-2">
            这份旧规划可作为参考，但不再作为 0.23.1
            的主流程产物。请基于源稿重新生成 AI 改编策略，再创建真实分集蓝图。
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-2">
            <span className="rounded-full border border-warning/25 bg-bg-0/55 px-2.5 py-1">
              原目标 {plan.target_episode_count} 集
            </span>
            <span className="rounded-full border border-warning/25 bg-bg-0/55 px-2.5 py-1">
              每集 {plan.episode_duration}
            </span>
          </div>
        </div>
        {!readOnly ? (
          hasSourceIssue ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 shrink-0 rounded-[9px]"
              onClick={onFixSource}
            >
              <RefreshCw size={14} />
              修复源稿
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 rounded-full px-4"
              disabled={loading}
              onClick={onRegenerate}
            >
              {loading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Wand2 size={14} />
              )}
              {sourceAnalysisTaskActive
                ? "理解源稿中"
                : planGenerating
                  ? "生成中"
                  : "重新生成策略"}
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}

const CHARACTER_NAME_DENYLIST = new Set([
  "旁白",
  "画外音",
  "字幕",
  "音效",
  "系统",
  "大家",
  "我们",
  "你们",
  "他们",
  "客户",
  "用户",
  "企业",
  "工厂",
  "产品",
  "语速与字数基准",
  "镜头",
  "大屏",
  "静态大屏",
  "动图",
  "附录",
  "巨型数字",
  "智能排缸",
]);

export function normalizeCharacterName(value: string) {
  return value
    .replace(/^(镜头切|大屏切至|大屏切|切至|切到)/, "")
    .replace(/^(把时间交回|时间交回|交回|回到|有请|请回)/, "")
    .replace(/^谢谢/, "")
    .replace(/[《》「」“”"'（）()【】\[\]\s]/g, "")
    .trim();
}

export function isLikelyCharacterName(value: string) {
  const name = normalizeCharacterName(value);
  if (!name || CHARACTER_NAME_DENYLIST.has(name)) return false;
  if (/^[A-Z]$/.test(name)) return false;
  if (name.length > 4 && !/(先生|女士|老师|博士|教授)$/.test(name))
    return false;
  if (
    /(概念|动图|页面|基准|结构|数据|矩阵|系统|模型|智能体|本体|大脑|产品|能力|行业|产业|工厂|方案|总述)/.test(
      name,
    )
  )
    return false;
  return /[\u4e00-\u9fa5]/.test(name);
}

export function sentenceAround(content: string, index: number, size = 90) {
  const safeIndex = Math.max(0, index);
  const startSearch = Math.max(0, safeIndex - size);
  const endSearch = Math.min(content.length, safeIndex + size);
  const raw = content.slice(startSearch, endSearch);
  const parts = raw
    .split(/[\n。！？!?；;]/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const containing = parts.find(
    (part) => safeIndex === 0 || raw.indexOf(part) >= 0,
  );
  return truncatePromptText(
    containing || parts[0] || raw.replace(/\s+/g, " ").trim(),
    120,
  );
}

export function collectCharacterCandidates(content: string) {
  const candidates = new Map<
    string,
    { name: string; count: number; snippets: string[] }
  >();
  const aliases = new Map<string, string>();

  function add(rawName: string, index: number, snippet?: string) {
    const name = normalizeCharacterName(rawName);
    if (!isLikelyCharacterName(name)) return;
    const current = candidates.get(name) || { name, count: 0, snippets: [] };
    current.count += 1;
    const nextSnippet = snippet || sentenceAround(content, index);
    if (nextSnippet && !current.snippets.includes(nextSnippet))
      current.snippets.push(nextSnippet);
    candidates.set(name, current);
  }

  for (const match of content.matchAll(/([\u4e00-\u9fa5]{1,6})（([A-Z])）/g)) {
    const name = normalizeCharacterName(match[1] || "");
    const alias = String(match[2] || "").trim();
    if (name && alias) {
      aliases.set(alias, name);
      add(name, match.index || 0);
    }
  }

  for (const match of content.matchAll(/^([A-Z])\s*[：:]/gm)) {
    const rawName = String(match[1] || "").trim();
    const name = aliases.get(rawName) || rawName;
    add(name, match.index || 0);
  }

  for (const match of content.matchAll(
    /([\u4e00-\u9fa5]{1,3}(?:总|老师|博士|先生|女士|教授))(?=主讲|开场|总结|讲|说|：|，|。|（|\s)/g,
  )) {
    add(match[1] || "", match.index || 0);
  }

  for (const match of content.matchAll(/(马斯克|乔布斯|雷军|任正非|建刚)/g)) {
    add(match[1] || "", match.index || 0);
  }

  return [...candidates.values()]
    .sort((a, b) => {
      const aPriority = a.name.endsWith("总") ? 1 : 0;
      const bPriority = b.name.endsWith("总") ? 1 : 0;
      return bPriority - aPriority || b.count - a.count;
    })
    .slice(0, 8);
}

export function inferCharacterRole(
  candidate: { name: string; snippets: string[] },
  index: number,
) {
  const text = `${candidate.name} ${candidate.snippets.join(" ")}`;
  if (/建刚/.test(candidate.name)) return "案例讲解人";
  if (/主讲|开场|总结|发布|A[：:]/.test(text) || candidate.name.endsWith("总"))
    return "核心讲述者";
  if (/案例|落地|纺织/.test(text)) return "案例讲解人";
  if (/对标|特斯拉|超级工厂|太空|汽车|产线/.test(text)) return "参照人物";
  return index === 0 ? "核心角色" : "重要角色";
}

export function buildCharacterDescription(
  candidate: { name: string; snippets: string[] },
  role: string,
) {
  const reference = candidate.snippets[0] || "";
  if (reference) return `${role}。源稿线索：${reference}`;
  return `${role}，从源稿中多次出现的人物。`;
}

export function buildCharacterAppearance(
  candidate: { name: string; snippets: string[] },
  role: string,
) {
  const text = `${candidate.name} ${candidate.snippets.join(" ")}`;
  if (/舞台|台前|大屏|发布会|主视觉/.test(text))
    return `${role}形象；适合站立发布会、舞台灯光和大屏演示场景。`;
  if (/案例|纺织|工厂|车间/.test(text))
    return `${role}形象；适合产业现场、工厂案例和业务讲解场景。`;
  if (/特斯拉|马斯克|太空|火箭|汽车/.test(text))
    return `${role}形象；作为产业对标与愿景参照出现。`;
  return `${role}形象；具体外貌可在后续分集制作中继续细化。`;
}

export function findExistingCharacterImage(
  drama: Drama,
  characterName: string,
) {
  const existing = (drama.characters || []).find(
    (character) =>
      character.name === characterName ||
      character.name?.includes(characterName) ||
      characterName.includes(character.name || ""),
  );
  return existing?.image_url || "";
}

export function buildCharacterImagePrompt(
  characterName: string,
  role: string,
  appearance: string,
  drama: Drama,
  snippets: string[] = [],
) {
  const styleLabel = drama.style
    ? dramaStyleLabel(drama.style)
    : "统一视觉风格";
  const reference = snippets.slice(0, 2).join("；");
  return `${styleLabel}角色设定图，${characterName}，${role}。${appearance}${reference ? ` 源稿线索：${reference}` : ""}。半身角色形象，主体清晰，适合短剧角色圣经，不出现文字、水印或Logo。`;
}

export function extractCharacterBibleFromSource(
  source: NovelSource,
  drama: Drama,
): AdaptationCharacter[] {
  const content = source.content || "";
  const candidates = collectCharacterCandidates(content);
  const characters = candidates.map((candidate, index) => {
    const role = inferCharacterRole(candidate, index);
    const appearance = buildCharacterAppearance(candidate, role);
    return {
      name: candidate.name,
      role,
      description: buildCharacterDescription(candidate, role),
      appearance,
      personality: candidate.snippets[1]
        ? `表达线索：${candidate.snippets[1]}`
        : "性格与表达方式待后续剧本拆解继续补全。",
      arc: candidate.snippets[2]
        ? `叙事线索：${candidate.snippets[2]}`
        : "围绕源稿中的职责和叙事功能展开。",
      voice_hint:
        role.includes("讲") || role.includes("述")
          ? "适合清晰、稳定、有发布会表达感的声音。"
          : "声音方向待后续配音阶段确定。",
      image_prompt: buildCharacterImagePrompt(
        candidate.name,
        role,
        appearance,
        drama,
        candidate.snippets,
      ),
      image_url: findExistingCharacterImage(drama, candidate.name),
    };
  });

  return characters.length
    ? characters
    : [
        {
          name: "待确认角色",
          role: "待确认角色",
          description:
            "当前源稿未识别到明确人物称谓，请在后续分集制作中继续补全角色。",
          appearance: "待根据源稿补全形象。",
          personality: "待补全。",
          arc: "待补全。",
          voice_hint: "待后续配音阶段确定。",
          image_prompt: `角色设定图，待确认角色，当前源稿未识别到明确人物称谓；画面暂以待补全角色形象占位，后续可补充姓名、身份、外貌、性格和关系定位。`,
          image_url: "",
        },
      ];
}

export function normalizeSceneSnippet(value: string) {
  return value
    .replace(/^\s*(?:\[|【|---)+/, "")
    .replace(/(?:\]|】|---)+\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function inferSceneName(snippet: string) {
  if (/舞台|台前|灯光|发布会|主视觉|开场/.test(snippet)) return "发布会主舞台";
  if (/纺织.*本体|本体.*结构|结构图/.test(snippet)) return "纺织本体演示屏";
  if (/数据层|多系统|系统示意|数据库|知识图谱/.test(snippet))
    return "产业数据层";
  if (/超级工厂|产线|汽车|机器人|星舰|火箭/.test(snippet))
    return "超级工厂产线";
  if (/工厂|车间|生产线|设备/.test(snippet)) return "工厂现场";
  if (/大屏|屏幕|演示|动图|图表/.test(snippet)) return "演示大屏";
  return (
    truncatePromptText(snippet.replace(/[：:，。；;].*$/, ""), 12) || "源稿场景"
  );
}

export function inferSceneTimeHint(snippet: string) {
  if (/开场|主视觉|灯光起/.test(snippet)) return "开场建立";
  if (/演示|大屏|数据|结构图|动图/.test(snippet)) return "方案讲解";
  if (/案例|纺织|工厂|车间/.test(snippet)) return "案例展开";
  if (/结尾|收束|总结|回到/.test(snippet)) return "收束段落";
  return "按剧情需要复用";
}

export function inferReuseLevel(
  count: number,
  snippet: string,
): "high" | "medium" | "low" {
  if (count >= 3 || /主舞台|大屏|工厂|数据层/.test(snippet)) return "high";
  if (count === 2 || /演示|案例|结构/.test(snippet)) return "medium";
  return "low";
}

export function collectSceneCandidates(
  content: string,
  chapters: NovelSourceChapter[],
) {
  const candidates = new Map<
    string,
    { name: string; count: number; snippets: string[] }
  >();

  function add(rawSnippet: string) {
    const snippet = normalizeSceneSnippet(rawSnippet);
    if (snippet.length < 4) return;
    if (!/[\u4e00-\u9fa5]/.test(snippet)) return;
    const name = inferSceneName(snippet);
    const current = candidates.get(name) || { name, count: 0, snippets: [] };
    current.count += 1;
    if (!current.snippets.includes(snippet))
      current.snippets.push(truncatePromptText(snippet, 120));
    candidates.set(name, current);
  }

  for (const match of content.matchAll(/[［\[]([^［\]\[\]]{4,140})[］\]]/g)) {
    add(match[1] || "");
  }

  for (const match of content.matchAll(
    /(?:^|\n)\s*(?:[-—]{2,}|#{1,6})\s*([^\n]{4,120})/g,
  )) {
    add(match[1] || "");
  }

  for (const match of content.matchAll(
    /([^。\n]{0,28}(?:舞台|大屏|发布会|主视觉|工厂|车间|产线|本体结构|数据层|超级工厂|演示屏|结构图)[^。\n]{0,70})/g,
  )) {
    add(match[1] || "");
  }

  if (!candidates.size) {
    for (const chapter of chapters.slice(0, 5)) {
      add(`${chapter.title}：${chapter.brief}`);
    }
  }

  return [...candidates.values()]
    .sort(
      (a, b) =>
        b.count - a.count ||
        b.snippets.join("").length - a.snippets.join("").length,
    )
    .slice(0, 6);
}

export function findExistingSceneImage(drama: Drama, sceneName: string) {
  const existing = (drama.scenes || []).find((scene) => {
    const text = `${scene.location || ""} ${scene.prompt || ""}`;
    return (
      text.includes(sceneName) ||
      sceneName.includes(String(scene.location || ""))
    );
  });
  return existing?.image_url || "";
}

export function buildSceneVisualPrompt(
  sceneName: string,
  snippets: string[],
  drama: Drama,
) {
  const styleLabel = drama.style
    ? dramaStyleLabel(drama.style)
    : "统一视觉风格";
  const reference = snippets.slice(0, 2).join("；");
  return `${styleLabel}场景图，${sceneName}，参考源稿线索：${reference}。画面用于短剧场景圣经，强调空间关系、光线、主体道具和可复用构图，不出现文字、水印或Logo。`;
}

export function extractSceneBibleFromSource(
  source: NovelSource,
  drama: Drama,
): AdaptationScene[] {
  const chapters = source.chapter_index || [];
  const candidates = collectSceneCandidates(source.content || "", chapters);
  const sourceTitle = source.title || drama.title || "小说源稿";
  const scenes = candidates.map((candidate) => {
    const firstSnippet = candidate.snippets[0] || source.summary || sourceTitle;
    const timeHint = inferSceneTimeHint(firstSnippet);
    return {
      name: candidate.name,
      location: candidate.name,
      time_hint: timeHint,
      visual_prompt: `源稿典型场景。线索：${firstSnippet}`,
      image_prompt: buildSceneVisualPrompt(
        candidate.name,
        candidate.snippets,
        drama,
      ),
      image_url: findExistingSceneImage(drama, candidate.name),
      reuse_level: inferReuseLevel(
        candidate.count,
        candidate.snippets.join(" "),
      ),
    };
  });

  return scenes.length
    ? scenes
    : [
        {
          name: sourceTitle,
          location: sourceTitle,
          time_hint: "按剧情需要复用",
          visual_prompt: `围绕《${sourceTitle}》核心情绪设计的可复用主场景。`,
          image_prompt: `${drama.style ? dramaStyleLabel(drama.style) : "统一视觉风格"}场景图，《${sourceTitle}》核心空间，适合短剧场景圣经。`,
          image_url: "",
          reuse_level: "high",
        },
      ];
}

export type AdaptationTargetOptions = {
  episodeDuration?: string;
  visualStyle?: string;
  aspectRhythm?: string;
};

export const EPISODE_DURATION_OPTIONS = [
  { label: "30-45 秒", value: "30-45 秒" },
  { label: "45-60 秒", value: "45-60 秒" },
  { label: "60-90 秒", value: "60-90 秒" },
  { label: "90-120 秒", value: "90-120 秒" },
];

export const ASPECT_RHYTHM_OPTIONS = [
  { label: "16:9 · 高密度钩子", value: "16:9 · 高密度钩子" },
  { label: "9:16 · 竖屏强钩子", value: "9:16 · 竖屏强钩子" },
  { label: "1:1 · 社媒切片", value: "1:1 · 社媒切片" },
  { label: "16:9 · 电影化节奏", value: "16:9 · 电影化节奏" },
];

export function buildDraftAdaptationPlan(
  source: NovelSource,
  drama: Drama,
  targetEpisodeCount = 24,
  options: AdaptationTargetOptions = {},
): AdaptationPlan {
  const chapters = source.chapter_index || [];
  const sourceTitle = source.title || drama.title || "小说源稿";
  const total = Math.max(1, targetEpisodeCount);
  const characterBible = extractCharacterBibleFromSource(source, drama);
  const leadName = characterBible[0]?.name || "核心角色";
  const sceneBible = extractSceneBibleFromSource(source, drama);
  const episodeDuration = options.episodeDuration?.trim() || "60-90 秒";
  const visualStyle = options.visualStyle?.trim() || drama.style || "";
  const aspectRhythm = options.aspectRhythm?.trim() || "16:9 · 高密度钩子";

  return {
    status: "draft",
    target_episode_count: total,
    episode_duration: episodeDuration,
    logline: `围绕《${sourceTitle}》的核心冲突，压缩为高密度短剧节奏。`,
    tone: visualStyle
      ? `${dramaStyleLabel(visualStyle)} · 情绪钩子优先`
      : "情绪钩子优先",
    main_plot:
      source.summary ||
      `从 ${formatCount(source.word_count)} 字原文中提炼主线，优先保留人物目标、反转节点和结尾悬念。`,
    character_bible: characterBible,
    scene_bible: sceneBible,
    visual_style: visualStyle,
    aspect_rhythm: aspectRhythm,
    episode_outlines: Array.from({ length: total }).map((_, index) => {
      const episodeNumber = index + 1;
      const sourceRange = pickChapterRange(chapters, index, total);
      const sceneName =
        sceneBible[index % sceneBible.length]?.name || "核心场景";
      return {
        episode_number: episodeNumber,
        title: `第${episodeNumber}集：${episodeNumber === 1 ? "开局钩子" : episodeNumber === total ? "终局反转" : "冲突升级"}`,
        source_range: sourceRange,
        hook:
          episodeNumber === 1
            ? "用原文最强事件开场，快速建立主角困境。"
            : "承接上一集悬念，开场 5 秒给出新信息。",
        key_beats: [
          "明确本集目标",
          "制造一次关系或信息反转",
          "把冲突推向下一集",
        ],
        ending_hook:
          episodeNumber === total
            ? "主线闭合，同时保留可续作余味。"
            : "留下一个必须点击下一集的悬念。",
        characters: [leadName],
        scenes: [sceneName],
      };
    }),
    generated_at: new Date().toISOString(),
    source_imported_at: source.imported_at,
  };
}

export function CharacterBibleCard({
  character,
  compact = false,
  onOpen,
}: {
  character: AdaptationCharacter;
  compact?: boolean;
  onOpen: (character: AdaptationCharacter) => void;
}) {
  const imageUrl = character.image_url ? staticUrl(character.image_url) : "";
  const title = character.name || "待确认角色";

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-bg-0">
      <div className="grid gap-0 sm:grid-cols-[132px_minmax(0,1fr)]">
        <div className="relative min-h-[132px] bg-bg-2">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={title}
              fill
              sizes="132px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="flex size-full min-h-[132px] flex-col justify-between bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_14%,transparent),color-mix(in_srgb,var(--color-bg-2)_92%,var(--color-border)))] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full border border-border/70 bg-bg-0/80 px-2 py-1 text-[11px] font-semibold text-text-2">
                  角色图提示
                </span>
                <UserRound size={16} className="text-accent" />
              </div>
              <div className="text-sm font-semibold leading-5 text-text-0">
                {title}
              </div>
            </div>
          )}
        </div>
        <div className="min-w-0 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-0">
                {title}
              </div>
              <div className="mt-1 text-xs text-accent-text">
                {character.role || "角色"}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 rounded-[8px] px-2 text-xs"
              onClick={() => onOpen(character)}
            >
              详情
            </Button>
          </div>
          <p
            className={`mt-2 text-xs leading-5 text-text-2 ${compact ? "line-clamp-3" : ""}`}
          >
            {character.description || character.arc}
          </p>
          {character.appearance ? (
            <p
              className={`mt-2 text-xs leading-5 text-text-3 ${compact ? "line-clamp-2" : ""}`}
            >
              形象：{character.appearance}
            </p>
          ) : null}
          {character.personality || character.voice_hint ? (
            <p
              className={`mt-1 text-xs leading-5 text-text-3 ${compact ? "line-clamp-2" : ""}`}
            >
              表达：{character.personality || character.voice_hint}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function CharacterBibleDialog({
  character,
  onClose,
}: {
  character: AdaptationCharacter | null;
  onClose: () => void;
}) {
  const imageUrl = character?.image_url ? staticUrl(character.image_url) : "";
  const title = character?.name || "角色详情";
  const role = character?.role || "待确认角色";
  const detailItems = character
    ? [
        ["形象设定", character.appearance || "待根据源稿补全形象。"],
        ["表达方式", character.personality || "待补全。"],
        ["人物弧光", character.arc || "待补全。"],
        ["声音方向", character.voice_hint || "待后续配音阶段确定。"],
        [
          "画面提示",
          character.image_prompt ||
            "角色设定图，待确认角色，当前源稿未识别到明确人物称谓；画面需保持干净、主体明确。",
        ],
      ]
    : [];

  return (
    <Dialog
      open={Boolean(character)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        aria-describedby="character-bible-dialog-description"
        variant="workspace"
        size="wide"
      >
        <DialogHeaderBar variant="workspace">
          <div className="flex items-start justify-between gap-5 pr-11">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex h-7 items-center rounded-full bg-bg-2 px-3 text-xs font-semibold text-accent-text">
                  {role}
                </span>
                <span className="text-xs font-medium text-text-3">
                  角色档案
                </span>
              </div>
              <DialogTitle className="mt-3 font-body text-[28px] font-semibold leading-none tracking-[-0.026em] text-text-0">
                {title}
              </DialogTitle>
              <DialogDescription
                id="character-bible-dialog-description"
                className="mt-2 max-w-[56ch] text-sm leading-6 text-text-2"
              >
                查看角色介绍、视觉设定、表达方式、人物弧光、声音方向和画面提示。
              </DialogDescription>
            </div>
          </div>
        </DialogHeaderBar>

        <DialogMain variant="workspace" className="gap-6">
          {character ? (
            <div className="grid gap-6 lg:grid-cols-[minmax(240px,0.86fr)_minmax(0,1.24fr)]">
              <aside className="lg:sticky lg:top-0 lg:self-start">
                <div className="overflow-hidden rounded-[30px] bg-bg-2 shadow-shadow-sm">
                  <div className="relative aspect-[3/4] min-h-[320px] bg-[linear-gradient(145deg,var(--color-bg-2),var(--color-bg-0))]">
                    {imageUrl ? (
                      <Image
                        src={imageUrl}
                        alt={title}
                        fill
                        sizes="260px"
                        className="object-cover"
                        unoptimized
                      />
                    ) : (
                      <div className="flex size-full flex-col justify-between p-5">
                        <span className="w-fit rounded-full bg-bg-0/75 px-3 py-1 text-xs font-semibold text-text-2 shadow-shadow-xs">
                          角色图提示
                        </span>
                        <div className="flex flex-1 items-center justify-center">
                          <div className="flex size-24 items-center justify-center rounded-full bg-bg-0/80 text-accent shadow-shadow-sm">
                            <UserRound size={42} strokeWidth={1.6} />
                          </div>
                        </div>
                        <div className="rounded-[22px] bg-bg-0/78 p-4 backdrop-blur-sm">
                          <div className="text-lg font-semibold leading-tight tracking-[-0.012em] text-text-0">
                            {title}
                          </div>
                          <p className="mt-2 text-sm leading-6 text-text-2">
                            {character.appearance || "待根据源稿补全形象。"}
                          </p>
                        </div>
                      </div>
                    )}
                    {imageUrl ? (
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent p-5 text-white">
                        <div className="text-lg font-semibold leading-tight tracking-[-0.012em]">
                          {title}
                        </div>
                        <p className="mt-1 text-sm text-white/80">{role}</p>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 rounded-[22px] bg-bg-2/70 px-4 py-3">
                  <div className="text-xs font-semibold text-text-3">
                    角色图提示
                  </div>
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-text-2">
                    {character.image_prompt ||
                      "角色设定图，待确认角色，当前源稿未识别到明确人物称谓。"}
                  </p>
                </div>
              </aside>

              <div className="min-w-0">
                <section className="rounded-[28px] bg-bg-2/70 p-5 sm:p-6">
                  <div className="text-xs font-semibold tracking-[0.08em] text-text-3">
                    PROFILE
                  </div>
                  <h3 className="mt-3 font-body text-xl font-semibold tracking-[-0.018em] text-text-0">
                    角色介绍
                  </h3>
                  <p className="mt-3 text-[15px] leading-7 text-text-1">
                    {character.description ||
                      "当前源稿未识别到明确人物称谓，请在后续分集制作中继续补全角色。"}
                  </p>
                </section>

                <div className="mt-4 overflow-hidden rounded-[28px] bg-bg-2/70">
                  {detailItems.map(([label, value], index) => (
                    <section
                      key={label}
                      className={`px-5 py-4 sm:px-6 ${index > 0 ? "border-t border-border/70" : ""}`}
                    >
                      <div className="text-xs font-semibold text-accent-text">
                        {label}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-text-2">
                        {value}
                      </p>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </DialogMain>
      </DialogContent>
    </Dialog>
  );
}

export function SceneBibleCard({
  scene,
  compact = false,
}: {
  scene: AdaptationScene;
  compact?: boolean;
}) {
  const imageUrl = scene.image_url ? staticUrl(scene.image_url) : "";
  const reuseLabel =
    scene.reuse_level === "high"
      ? "高复用"
      : scene.reuse_level === "low"
        ? "低复用"
        : "中复用";

  return (
    <div className="overflow-hidden rounded-[10px] border border-border bg-bg-0">
      <div className="relative aspect-[16/9] bg-bg-2">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={scene.name || scene.location || "场景图"}
            fill
            sizes="(min-width: 768px) 360px, 100vw"
            className="object-cover"
            unoptimized
          />
        ) : (
          <div className="flex size-full flex-col justify-between bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_16%,transparent),color-mix(in_srgb,var(--color-bg-2)_92%,var(--color-border)))] p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full border border-border/70 bg-bg-0/80 px-2 py-1 text-[11px] font-semibold text-text-2">
                场景图提示
              </span>
              <Mountain size={16} className="text-accent" />
            </div>
            <div className="text-sm font-semibold leading-5 text-text-0">
              {scene.name || scene.location}
            </div>
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-text-0">
              {scene.name || scene.location}
            </div>
            <div className="mt-1 text-xs text-accent-text">
              {reuseLabel} · {scene.time_hint || "按剧情需要复用"}
            </div>
          </div>
        </div>
        <p
          className={`mt-2 text-xs leading-5 text-text-2 ${compact ? "line-clamp-3" : ""}`}
        >
          {scene.visual_prompt || scene.time_hint}
        </p>
        {scene.image_prompt ? (
          <p
            className={`mt-2 text-xs leading-5 text-text-3 ${compact ? "line-clamp-2" : ""}`}
          >
            画面：{scene.image_prompt}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function AdaptationBriefCard({
  brief,
  disabled,
  onSelect,
  selected,
  selecting,
}: {
  brief: AdaptationBrief;
  disabled?: boolean;
  onSelect: (briefId: string) => void;
  selected: boolean;
  selecting: boolean;
}) {
  return (
    <article
      className={`rounded-[16px] border p-4 transition-colors ${
        selected
          ? "border-accent/35 bg-accent-bg/70"
          : "border-border bg-bg-2/70"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="line-clamp-1 text-sm font-semibold text-text-0">
              {brief.name}
            </h4>
            {selected ? (
              <span className="inline-flex h-6 items-center rounded-full bg-accent px-2.5 text-xs font-semibold text-on-accent">
                已选择
              </span>
            ) : null}
          </div>
          <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-2">
            {brief.claim}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={selected ? "outline" : "default"}
          className="h-8 shrink-0 rounded-full px-3 text-xs"
          disabled={disabled || selected || selecting}
          onClick={() => onSelect(brief.id)}
        >
          {selecting ? (
            <Loader2 size={13} className="animate-spin" />
          ) : selected ? (
            <CheckCircle2 size={13} />
          ) : null}
          {selected ? "已选" : "选择"}
        </Button>
      </div>
      <div className="mt-4 grid gap-2 text-xs text-text-2 sm:grid-cols-3">
        <div className="rounded-[10px] bg-bg-0 px-3 py-2">
          <div className="text-text-3">集数</div>
          <div className="mt-1 font-semibold text-text-0">
            {brief.target_episode_count} 集
          </div>
        </div>
        <div className="rounded-[10px] bg-bg-0 px-3 py-2">
          <div className="text-text-3">节奏</div>
          <div className="mt-1 line-clamp-1 font-semibold text-text-0">
            {brief.hook_density || brief.rhythm_model}
          </div>
        </div>
        <div className="rounded-[10px] bg-bg-0 px-3 py-2">
          <div className="text-text-3">成本</div>
          <div className="mt-1 font-semibold text-text-0">
            {brief.production_cost || "中"}
          </div>
        </div>
      </div>
      {brief.risk_notes?.length ? (
        <p className="mt-3 line-clamp-2 text-xs leading-5 text-text-3">
          {brief.risk_notes[0]}
        </p>
      ) : null}
    </article>
  );
}
