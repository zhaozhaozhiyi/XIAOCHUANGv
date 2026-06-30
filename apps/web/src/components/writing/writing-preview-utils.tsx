import type { BriefState } from '@/components/writing/types'
import { parseStructuredOutline } from '@/components/writing/use-writing-workspace-controller'

export function renderBriefPreview(brief: BriefState, structured?: Record<string, unknown> | null) {
  const structuredBrief = structured as {
    worldview?: string
    background?: string
    mainline?: string
    conflict?: string
    characters?: Array<{ name?: string; role?: string }>
  } | null

  const items = [
    { label: '世界观', value: structuredBrief?.worldview || brief.worldview },
    { label: '背景', value: structuredBrief?.background || brief.background },
    { label: '主线', value: structuredBrief?.mainline || brief.main_plot },
    { label: '核心冲突', value: structuredBrief?.conflict || brief.core_conflict },
    {
      label: '主要角色',
      value:
        structuredBrief?.characters?.map((item) => item.name || item.role || '').filter(Boolean).join('、') ||
        brief.main_characters,
    },
  ].filter((item) => item.value?.trim())

  if (!items.length) {
    return <div className="text-xs text-text-3">创作准备暂未结构化成型，可先填写关键字段。</div>
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-[var(--radius-sm)] border border-border bg-bg-0 px-3 py-2 text-xs text-text-3">
          <div className="font-medium text-text-1">{item.label}</div>
          <div className="mt-1 whitespace-pre-wrap">{item.value}</div>
        </div>
      ))}
    </div>
  )
}

export function renderOutlinePreview(value: string) {
  const structured = parseStructuredOutline(value)
  if (!structured) {
    return <div className="whitespace-pre-wrap text-xs text-text-3">{value.trim() || '当前大纲尚未结构化。'}</div>
  }

  return (
    <div className="space-y-2 text-xs text-text-3">
      {structured.premise ? (
        <div className="rounded-[var(--radius-sm)] border border-border bg-bg-0 px-3 py-2">
          <div className="font-medium text-text-1">大纲说明</div>
          <div className="mt-1 whitespace-pre-wrap">{structured.premise}</div>
        </div>
      ) : null}
      {structured.arcs?.slice(0, 4).map((arc, index) => (
        <div key={`${arc.title || 'arc'}-${index}`} className="rounded-[var(--radius-sm)] border border-border bg-bg-0 px-3 py-2">
          <div className="font-medium text-text-1">{arc.title || `阶段 ${index + 1}`}</div>
          {arc.goal ? <div className="mt-1">目标：{arc.goal}</div> : null}
          {arc.conflict ? <div className="mt-1">冲突：{arc.conflict}</div> : null}
          {arc.turning_points?.length ? <div className="mt-1">转折：{arc.turning_points.join('；')}</div> : null}
          {arc.chapters?.length ? <div className="mt-1">章节：{arc.chapters.join('、')}</div> : null}
        </div>
      ))}
      {structured.open_questions?.length ? (
        <div className="rounded-[var(--radius-sm)] border border-dashed border-border px-3 py-2">
          <div className="font-medium text-text-1">待确认问题</div>
          <div className="mt-1">{structured.open_questions.join('；')}</div>
        </div>
      ) : null}
    </div>
  )
}
