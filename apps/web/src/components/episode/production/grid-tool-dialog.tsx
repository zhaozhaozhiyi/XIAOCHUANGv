'use client'

import { useState, useEffect } from 'react'
import { Loader2, X, Check } from 'lucide-react'
import { useGridTool } from '@/hooks/use-grid-tool'
import { cn } from '@/lib/cn'
import type { Storyboard } from '@/types/api'

const GRID_MODES = [
  { id: 'first_frame', label: '首帧', desc: '每格=一个镜头的首帧' },
  { id: 'first_last', label: '首尾帧', desc: '每镜头占一行：左首帧，右尾帧' },
  { id: 'multi_ref', label: '多参考', desc: '所有格子=同一镜头的参考图' },
] as const

const GRID_LAYOUTS = ['2x2', '2x3', '3x3', '3x4', '4x4', '4x6', '5x5', '6x6']

const FRAME_TYPE_OPTIONS = [
  { label: '首帧', value: 'first_frame' },
  { label: '尾帧', value: 'last_frame' },
  { label: '参考图', value: 'reference' },
]

interface Props {
  storyboards: Storyboard[]
  dramaId: number
  episodeId: number
  onDone: () => void
}

function parseLayout(layout: string) {
  const parts = String(layout || '3x3').split('x').map(Number)
  return { rows: parts[0] || 3, cols: parts[1] || 3 }
}

export function GridToolDialog({ storyboards, dramaId, episodeId, onDone }: Props) {
  const gt = useGridTool()

  if (!gt.open) return null

  const { rows, cols } = parseLayout(gt.layout)
  const totalCells = rows * cols

  const canStart = gt.mode === 'multi_ref' ? !!gt.singleTarget : gt.selected.length > 0

  const summary = (() => {
    if (gt.mode === 'multi_ref') {
      const idx = storyboards.findIndex(s => s.id === gt.singleTarget) + 1
      return gt.singleTarget ? `${rows}x${cols} 参考图 → 镜头 #${idx}` : '请选择一个镜头'
    }
    if (!gt.selected.length) return '请选择镜头'
    if (gt.mode === 'first_last') return `${gt.selected.length} 个镜头 → ${rows}x${cols} 宫格（首尾帧）`
    return `${gt.selected.length} 个镜头 → ${rows}x${cols} 宫格`
  })()

  // Assignment pagination
  const pageSize = gt.assignments.length >= 25 ? 8 : gt.assignments.length >= 16 ? 10 : 9
  const totalPages = Math.max(1, Math.ceil(gt.assignments.length / pageSize))
  const pageStart = gt.assignmentPage * pageSize
  const pageEnd = Math.min(gt.assignments.length, pageStart + pageSize)
  const pagedAssignments = gt.assignments.slice(pageStart, pageEnd).map((a, offset) => ({
    assignment: a,
    index: pageStart + offset,
  }))

  const assignedCount = gt.assignments.filter(a => a.storyboard_id).length

  const shotOptions = [
    { label: '未分配', value: null as number | null },
    ...(gt.activeShotIds.length ? gt.activeShotIds : storyboards.map(s => s.id))
      .filter(id => storyboards.some(s => s.id === id))
      .map(id => {
        const idx = storyboards.findIndex(s => s.id === id) + 1
        const sb = storyboards.find(s => s.id === id)
        return {
          label: `#${String(idx).padStart(2, '0')} ${sb?.title || sb?.description || '镜头'}`,
          value: id,
        }
      }),
  ]

  function getCellLabel(a: { storyboard_id: number | null; frame_type: string }) {
    if (!a.storyboard_id) return '—'
    const idx = storyboards.findIndex(s => s.id === a.storyboard_id) + 1
    const suffix = ({ first_frame: '首', last_frame: '尾', reference: '参' } as Record<string, string>)[a.frame_type] || ''
    return `#${idx}${suffix ? ` ${suffix}` : ''}`
  }

  function getCellTitle(id: number | null) {
    if (!id) return '未分配'
    const idx = storyboards.findIndex(s => s.id === id) + 1
    const sb = storyboards.find(s => s.id === id)
    return `#${String(idx).padStart(2, '0')} ${sb?.title || sb?.description || '镜头'}`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) gt.setOpen(false) }}
    >
      <div className="bg-bg-surface border border-border rounded-[var(--radius-xl)] shadow-shadow-elevated w-[920px] max-w-[96vw] max-h-[92vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-bg-0/90 px-6 py-5 sm:px-8 sm:py-5">
          <span className="font-display text-[15px] font-semibold text-text-0">宫格图工具</span>
          <button
            type="button"
            aria-label="关闭"
            title="关闭"
            className="w-7 h-7 rounded-full flex items-center justify-center text-text-3 hover:bg-bg-hover hover:text-text-0 transition-colors"
            onClick={() => gt.setOpen(false)}
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        {/* Step 0: Config */}
        {gt.step === 0 && (
          <div className="flex flex-1 flex-col gap-5 overflow-hidden p-6 sm:p-8">
            {/* Mode tabs */}
            <div className="flex gap-2">
              {GRID_MODES.map(m => (
                <button
                  key={m.id}
                  className={cn(
                    'flex-1 flex flex-col items-start gap-0.5 px-4 py-3 rounded-[var(--radius-sm)] border text-left transition-colors cursor-pointer',
                    gt.mode === m.id
                      ? 'border-accent bg-accent-bg text-accent-text'
                      : 'border-border bg-bg-2 text-text-2 hover:bg-bg-hover',
                  )}
                  onClick={() => {
                    gt.setMode(m.id)
                    gt.selectAll([])
                    gt.setSingleTarget(null)
                  }}
                >
                  <span className="font-semibold text-sm">{m.label}</span>
                  <span className="text-xs opacity-70">{m.desc}</span>
                </button>
              ))}
            </div>

            {/* Layout + shot selection header */}
            <div className="flex items-end gap-3">
              {gt.mode !== 'multi_ref' && (
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-text-3 font-medium uppercase tracking-wide">宫格</span>
                  <select
                    value={gt.layout}
                    onChange={e => gt.setLayout(e.target.value)}
                    className="px-2 py-1.5 rounded-[var(--radius-xs)] border border-border bg-bg-2 text-sm text-text-0 w-24"
                  >
                    {GRID_LAYOUTS.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
              )}
              <div className="flex-1">
                <span className="text-xs text-text-3 font-medium uppercase tracking-wide">
                  {gt.mode === 'multi_ref' ? '选择目标镜头' : `选择镜头 (已选 ${gt.selected.length})`}
                </span>
              </div>
              {gt.mode !== 'multi_ref' && (
                <button className="px-3 py-1.5 text-xs rounded-[var(--radius-xs)] border border-border bg-bg-2 text-text-2 hover:bg-bg-hover cursor-pointer"
                  onClick={() => gt.selectAll(storyboards.map(s => s.id))}>
                  {gt.selected.length === storyboards.length ? '取消全选' : '全选'}
                </button>
              )}
            </div>

            {/* Shot pick list */}
            <div className="flex-1 overflow-y-auto border border-border rounded-[var(--radius-sm)] bg-bg-2 divide-y divide-border">
              {storyboards.map((sb, i) => {
                const checked = gt.mode === 'multi_ref'
                  ? gt.singleTarget === sb.id
                  : gt.selected.includes(sb.id)
                return (
                  <label
                    key={sb.id}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors',
                      checked ? 'bg-accent-bg' : 'hover:bg-bg-hover',
                    )}
                  >
                    <input
                      type={gt.mode === 'multi_ref' ? 'radio' : 'checkbox'}
                      checked={checked}
                      onChange={() => gt.mode === 'multi_ref' ? gt.setSingleTarget(sb.id) : gt.toggleSelected(sb.id, storyboards.map(s => s.id))}
                      className="shrink-0"
                    />
                    <span className="font-mono text-xs text-text-3 w-8 shrink-0">#{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-xs text-text-1 truncate">{sb.description || sb.title || '—'}</span>
                  </label>
                )
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 shrink-0">
              {canStart && (
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-bg-2 border border-border text-text-2">
                  {rows}x{cols} = {totalCells}格
                </span>
              )}
              <span className="text-xs text-text-3">
                {gt.promptLoading ? gt.promptStatus : summary}
              </span>
              <button
                type="button"
                className={cn(
                  'ml-auto flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium transition-colors cursor-pointer',
                  'bg-accent text-on-accent border-0 shadow-primary-glow hover:bg-accent-dark',
                  (!canStart || gt.promptLoading) && 'opacity-50 cursor-not-allowed',
                )}
                disabled={!canStart || gt.promptLoading}
                onClick={() => gt.generatePrompt(dramaId, episodeId)}
              >
                {gt.promptLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                {gt.promptLoading ? '生成中' : '生成提示词'}
              </button>
            </div>
          </div>
        )}

        {/* Step 1: Prompt Preview */}
        {gt.step === 1 && (
          <div className="flex flex-1 flex-col gap-5 overflow-hidden p-6 sm:p-8">
            <div className="rounded-[12px] bg-bg-2 border border-border p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-bold text-text-3 uppercase tracking-wide">宫格图提示词</span>
                {gt.promptSource && (
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent-bg text-accent-text">
                    {gt.promptSource === 'agent' ? 'AI生成' : '模板兜底'}
                  </span>
                )}
              </div>
              <div className="text-sm text-text-1 leading-relaxed whitespace-pre-wrap">
                {gt.promptText || '（等待生成）'}
              </div>
            </div>

            {/* Cell prompts grid preview */}
            <div
              className="flex-1 overflow-y-auto grid gap-1"
              style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
            >
              {Array.from({ length: rows * cols }, (_, i) => {
                const cell = gt.cellPrompts[i] as { shot_number?: number; frame_type?: string; prompt?: string } | undefined
                return (
                  <div
                    key={i}
                    className="rounded-[var(--radius-xs)] bg-bg-2 border border-border p-2 text-xs flex flex-col gap-1"
                  >
                    <div className="font-mono text-text-3">
                      {cell ? `#${cell.shot_number} ${({ first_frame: '首', last_frame: '尾', reference: '参' } as Record<string, string>)[cell.frame_type || ''] || ''}` : '空'}
                    </div>
                    <div className="text-text-2 line-clamp-3">{cell?.prompt || '—'}</div>
                  </div>
                )
              })}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button className="px-4 py-2 rounded-[var(--radius-sm)] border border-border bg-bg-2 text-sm text-text-2 hover:bg-bg-hover cursor-pointer"
                onClick={() => gt.step !== undefined && useGridTool.setState({ step: 0 })}>
                上一步
              </button>
              <button className="px-4 py-2 rounded-[var(--radius-sm)] border border-border bg-bg-2 text-sm text-text-2 hover:bg-bg-hover cursor-pointer flex items-center gap-1.5"
                disabled={gt.promptLoading}
                onClick={() => gt.generatePrompt(dramaId, episodeId)}>
                重新生成
              </button>
              <button
                type="button"
                className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium bg-accent text-on-accent border-0 shadow-primary-glow hover:bg-accent-dark cursor-pointer"
                onClick={() => gt.startGeneration(dramaId)}
              >
                生成宫格图
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Generating */}
        {gt.step === 2 && (
            <div className="flex flex-col flex-1 items-center justify-center gap-3 p-10">
            <Loader2 size={32} className="animate-spin text-accent" />
            <div className="text-sm font-semibold text-text-1">宫格图生成中...</div>
            <div className="text-xs text-text-3">{gt.statusText}</div>
          </div>
        )}

        {/* Step 3: Preview + Assignment */}
        {gt.step === 3 && (
          <div className="flex flex-1 overflow-hidden">
            {/* Left: image preview */}
            <div className="flex flex-1 flex-col gap-4 overflow-hidden p-6 sm:p-8">
              <div className="flex-1 min-h-0 rounded-[12px] overflow-hidden bg-bg-2 border border-border flex items-center justify-center">
                {gt.imagePath && (
                  <div className="relative max-h-full max-w-full">
                    <img
                      src={'/' + gt.imagePath}
                      alt="宫格图"
                      className="block max-h-full max-w-full object-contain"
                    />
                    {/* Grid overlay */}
                    <div
                      className="absolute inset-0 grid"
                      style={{
                        gridTemplateColumns: `repeat(${gt.actualLayout.cols}, 1fr)`,
                        gridTemplateRows: `repeat(${gt.actualLayout.rows}, 1fr)`,
                      }}
                    >
                      {gt.assignments.map((a, i) => (
                        <button
                          key={i}
                          type="button"
                          className={cn(
                            'border border-white/20 flex items-end justify-start p-1 cursor-pointer transition-colors',
                            gt.activeCell === i ? 'bg-accent/30 border-accent' : 'hover:bg-bg-1/40',
                          )}
                          onClick={() => gt.focusCell(i)}
                        >
                          <span className={cn(
                            'text-xs font-mono px-1 rounded',
                            a.storyboard_id ? 'bg-accent text-white' : 'bg-black/50 text-white/70',
                          )}>
                            {getCellLabel(a)}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-mono px-2 py-0.5 rounded-full bg-bg-2 border border-border text-text-2">
                  {gt.actualLayout.rows}x{gt.actualLayout.cols} = {gt.actualLayout.rows * gt.actualLayout.cols}格
                </span>
                <span className="text-text-3">{assignedCount}/{gt.assignments.length} 格已分配</span>
                {assignedCount < gt.assignments.length && (
                  <span className="text-xs px-1.5 py-0.5 rounded bg-bg-2 text-text-3">未分配格子会被忽略</span>
                )}
              </div>
            </div>

            {/* Right: assignments */}
            <div className="w-[340px] shrink-0 flex flex-col border-l border-border overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-sm font-semibold text-text-0">格子分配</div>
                <div className="text-xs text-text-3">切分后由你自己决定每格对应哪个分镜</div>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center gap-2 px-3 py-2 border-b border-border text-xs">
                  <button
                    className="px-2 py-1 rounded border border-border text-text-2 hover:bg-bg-hover disabled:opacity-40 cursor-pointer"
                    disabled={gt.assignmentPage === 0}
                    onClick={() => gt.setAssignmentPage(gt.assignmentPage - 1)}
                  >上一页</button>
                  <span className="text-text-3 flex-1 text-center">第 {gt.assignmentPage + 1}/{totalPages} 页</span>
                  <button
                    className="px-2 py-1 rounded border border-border text-text-2 hover:bg-bg-hover disabled:opacity-40 cursor-pointer"
                    disabled={gt.assignmentPage >= totalPages - 1}
                    onClick={() => gt.setAssignmentPage(gt.assignmentPage + 1)}
                  >下一页</button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {pagedAssignments.map(({ assignment, index }) => (
                  <div
                    key={index}
                    className={cn(
                      'flex flex-col gap-1.5 px-3 py-2.5 border-b border-border cursor-pointer',
                      gt.activeCell === index ? 'bg-accent-bg' : 'hover:bg-bg-hover',
                    )}
                    onClick={() => gt.focusCell(index)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-text-3">格{index + 1}</span>
                      <span className="text-xs text-text-2 truncate max-w-[180px]">
                        {getCellTitle(assignment.storyboard_id)}
                      </span>
                    </div>
                    <div className="flex gap-1.5">
                      <select
                        value={assignment.storyboard_id ?? ''}
                        onChange={e => gt.updateAssignment(index, 'storyboard_id', e.target.value ? Number(e.target.value) : null)}
                        className="flex-1 px-1.5 py-1 rounded border border-border bg-bg-2 text-xs text-text-0"
                      >
                        {shotOptions.map(o => (
                          <option key={String(o.value)} value={o.value ?? ''}>{o.label}</option>
                        ))}
                      </select>
                      <select
                        value={assignment.frame_type}
                        onChange={e => gt.updateAssignment(index, 'frame_type', e.target.value)}
                        className="w-20 px-1.5 py-1 rounded border border-border bg-bg-2 text-xs text-text-0"
                      >
                        {FRAME_TYPE_OPTIONS.map(o => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center gap-2 px-4 py-3 border-t border-border shrink-0">
                <button
                  className="px-3 py-1.5 rounded-[var(--radius-xs)] border border-border bg-bg-2 text-sm text-text-2 hover:bg-bg-hover cursor-pointer"
                  onClick={() => useGridTool.setState({ step: 1 })}
                >
                  返回
                </button>
                <button
                  type="button"
                  className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-[var(--radius-sm)] text-sm font-medium bg-accent text-on-accent border-0 shadow-primary-glow hover:bg-accent-dark cursor-pointer"
                  onClick={() => gt.doSplit(dramaId, episodeId, () => { onDone() })}
                >
                  切分并分配
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {gt.step === 4 && (
          <div className="flex flex-col flex-1 items-center justify-center gap-3 p-10">
            <Check size={32} className="text-success" />
            <div className="font-display text-[17px] font-bold text-text-0">分配完成</div>
            <div className="text-sm text-text-3">{assignedCount} 格已分配</div>
            <button
              type="button"
              className="mt-4 px-6 py-2 rounded-[var(--radius-sm)] text-sm font-medium bg-accent text-on-accent border-0 shadow-primary-glow hover:bg-accent-dark cursor-pointer"
              onClick={() => { gt.setOpen(false); onDone() }}
            >
              关闭
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
