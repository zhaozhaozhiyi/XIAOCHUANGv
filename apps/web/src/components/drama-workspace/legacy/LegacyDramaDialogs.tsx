'use client'

import type { Dispatch, SetStateAction } from 'react'
import { AlertTriangle, BookOpen, CheckCircle2, FileText, FileUp, LayoutGrid, Loader2, LogIn, RefreshCw, Settings2, Wand2, X } from 'lucide-react'
import { Dialog, DialogActions, DialogContent, DialogDescription, DialogHeaderBar, DialogMain, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { BaseSelect } from '@/components/shared/base-select'
import type { Episode, WritingListItem } from '@/types/api'
import {
  AdaptationTargetFields,
  CharacterBibleDialog,
  episodePreviewText,
  formatCount,
  type AdaptationCharacter,
} from './ai-first-workbench-parts'

type SelectOption = { label: string; value: string }

type ProjectDefaultsDraft = {
  image_config_id: string
  video_config_id: string
  audio_config_id: string
}

type SourceDialogHealthView = {
  kind: string
  message: string
}

type LegacyDramaDialogsProps = {
  addDialog: boolean
  adaptationPlan: unknown
  audioConfigOptions: SelectOption[]
  creating: boolean
  defaultsSaving: boolean
  imageConfigOptions: SelectOption[]
  importSelectedWritingSource: () => Promise<void>
  loadWritingSources: (query?: string) => Promise<void>
  missingConfigHints: string[]
  newTitle: string
  openLoginNextHere: () => void
  pickerAspectRhythm: string
  pickerEpisodeDuration: string
  pickerTargetEpisodes: number
  pickerVisualStyle: string
  previewScriptEpisode: Episode | null
  previewVideoTitle: string
  previewVideoUrl: string | null
  projectDefaults: ProjectDefaultsDraft
  projectDefaultsDialogOpen: boolean
  saveNovelSource: () => Promise<void>
  saveProjectDefaults: () => Promise<void>
  selectedPlanCharacter: AdaptationCharacter | null
  selectedWritingSource: WritingListItem | null
  selectedWritingSourceId: number | null
  setAddDialog: Dispatch<SetStateAction<boolean>>
  setNewTitle: Dispatch<SetStateAction<string>>
  setPickerAspectRhythm: Dispatch<SetStateAction<string>>
  setPickerEpisodeDuration: Dispatch<SetStateAction<string>>
  setPickerTargetEpisodes: Dispatch<SetStateAction<number>>
  setPickerVisualStyle: Dispatch<SetStateAction<string>>
  setPreviewScriptEpisode: Dispatch<SetStateAction<Episode | null>>
  setPreviewVideoUrl: Dispatch<SetStateAction<string | null>>
  setProjectDefaults: Dispatch<SetStateAction<ProjectDefaultsDraft>>
  setProjectDefaultsDialogOpen: Dispatch<SetStateAction<boolean>>
  setSelectedPlanCharacter: Dispatch<SetStateAction<AdaptationCharacter | null>>
  setSelectedWritingSourceId: Dispatch<SetStateAction<number | null>>
  setSourceContentDraft: Dispatch<SetStateAction<string>>
  setSourceDialogOpen: Dispatch<SetStateAction<boolean>>
  setSourcePickerOpen: Dispatch<SetStateAction<boolean>>
  setSourceTitleDraft: Dispatch<SetStateAction<string>>
  setSplitContent: Dispatch<SetStateAction<string>>
  setSplitDialog: Dispatch<SetStateAction<boolean>>
  setWritingSourceQuery: Dispatch<SetStateAction<string>>
  sourceContentDraft: string
  sourceDialogHasBlockingIssue: boolean
  sourceDialogHealth: SourceDialogHealthView
  sourceDialogMode: 'edit' | 'view'
  sourceDialogOpen: boolean
  sourceDraftChapterCount: number
  sourceDraftWordCount: number
  sourcePickerOpen: boolean
  sourceSaving: boolean
  sourceTitleDraft: string
  splitContent: string
  splitDialog: boolean
  splitEpisodes: () => Promise<void>
  splitting: boolean
  videoConfigOptions: SelectOption[]
  writingSourceImportingId: number | null
  writingSourceLoading: boolean
  writingSourceQuery: string
  writingSources: WritingListItem[]
  onAddEpisode: () => Promise<void>
}

export function LegacyDramaDialogs({
  addDialog,
  adaptationPlan,
  audioConfigOptions,
  creating,
  defaultsSaving,
  imageConfigOptions,
  importSelectedWritingSource,
  loadWritingSources,
  missingConfigHints,
  newTitle,
  openLoginNextHere,
  pickerAspectRhythm,
  pickerEpisodeDuration,
  pickerTargetEpisodes,
  pickerVisualStyle,
  previewScriptEpisode,
  previewVideoTitle,
  previewVideoUrl,
  projectDefaults,
  projectDefaultsDialogOpen,
  saveNovelSource,
  saveProjectDefaults,
  selectedPlanCharacter,
  selectedWritingSource,
  selectedWritingSourceId,
  setAddDialog,
  setNewTitle,
  setPickerAspectRhythm,
  setPickerEpisodeDuration,
  setPickerTargetEpisodes,
  setPickerVisualStyle,
  setPreviewScriptEpisode,
  setPreviewVideoUrl,
  setProjectDefaults,
  setProjectDefaultsDialogOpen,
  setSelectedPlanCharacter,
  setSelectedWritingSourceId,
  setSourceContentDraft,
  setSourceDialogOpen,
  setSourcePickerOpen,
  setSourceTitleDraft,
  setSplitContent,
  setSplitDialog,
  setWritingSourceQuery,
  sourceContentDraft,
  sourceDialogHasBlockingIssue,
  sourceDialogHealth,
  sourceDialogMode,
  sourceDialogOpen,
  sourceDraftChapterCount,
  sourceDraftWordCount,
  sourcePickerOpen,
  sourceSaving,
  sourceTitleDraft,
  splitContent,
  splitDialog,
  splitEpisodes,
  splitting,
  videoConfigOptions,
  writingSourceImportingId,
  writingSourceLoading,
  writingSourceQuery,
  writingSources,
  onAddEpisode,
}: LegacyDramaDialogsProps) {
  return (
    <>
      <Dialog
        open={sourcePickerOpen}
        onOpenChange={(open) => {
          setSourcePickerOpen(open)
          if (!open) setSelectedWritingSourceId(null)
        }}
      >
        <DialogContent variant="workspace" size="wide">
          <DialogTitle className="sr-only">从小说模块引入</DialogTitle>
          <DialogDescription className="sr-only">
            选择已有小说作品并导入当前短剧项目，导入后会替换现有源稿并继续用于生成改编策略。
          </DialogDescription>
          <DialogHeaderBar variant="workspace">
            <div className="flex items-start gap-4 pr-12">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-accent-bg text-accent">
                <BookOpen size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[22px] font-bold leading-tight tracking-[-0.018em] text-text-0">
                  从小说模块引入
                </div>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain variant="workspace" className="gap-4 overflow-hidden">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                value={writingSourceQuery}
                onChange={(event) => setWritingSourceQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadWritingSources(writingSourceQuery)
                }}
                placeholder="搜索小说标题或梗概"
                className="h-10 rounded-[10px] border-border/60 shadow-none"
              />
              <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0 rounded-[10px] border-border/60 px-4 shadow-none"
                disabled={writingSourceLoading}
                onClick={() => void loadWritingSources(writingSourceQuery)}
              >
                {writingSourceLoading ? <Loader2 size={14} className="animate-spin" /> : null}
                搜索
              </Button>
            </div>

            {writingSourceLoading ? (
              <div className="flex min-h-[280px] flex-1 items-center justify-center rounded-[14px] bg-[color-mix(in_srgb,var(--color-bg-2)_52%,var(--color-bg-0))] text-text-3">
                <Loader2 size={28} className="animate-spin" />
              </div>
            ) : writingSources.length === 0 ? (
              <div className="flex min-h-[280px] flex-1 flex-col items-center justify-center rounded-[14px] bg-[color-mix(in_srgb,var(--color-bg-2)_52%,var(--color-bg-0))] px-6 text-center">
                <BookOpen size={38} className="text-text-3" strokeWidth={1.7} />
                <h3 className="mt-4 font-body text-base font-black tracking-normal text-text-0">暂无可引入小说</h3>
                <p className="mt-2 max-w-md text-sm leading-6 text-text-2">
                  先去小说模块新建或完善一部小说，再回到这里引入为短剧源稿。
                </p>
              </div>
            ) : (
              <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                <div className="min-h-0 overflow-y-auto rounded-[14px] bg-[color-mix(in_srgb,var(--color-bg-2)_52%,var(--color-bg-0))] p-2.5">
                  <div className="grid gap-3">
                    {writingSources.map((item) => {
                      const importing = writingSourceImportingId === item.id
                      const selected = selectedWritingSourceId === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`group flex min-h-[112px] w-full items-start gap-4 rounded-[12px] border p-4 text-left shadow-[0_1px_0_rgba(40,28,18,0.04)] transition-[background-color,border-color,transform] duration-200 disabled:cursor-not-allowed disabled:opacity-70 ${
                            selected
                              ? 'border-accent/35 bg-accent-bg/70'
                              : 'border-transparent bg-bg-0 hover:-translate-y-0.5 hover:bg-bg-0/90'
                          }`}
                          disabled={writingSourceImportingId != null}
                          onClick={() => setSelectedWritingSourceId(item.id)}
                        >
                          <div className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-accent-bg text-accent">
                            {importing ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className={`line-clamp-1 font-body text-base font-black tracking-normal ${selected ? 'text-accent' : 'text-text-0 group-hover:text-accent'}`}>
                                {item.title}
                              </h3>
                              <span className="rounded-full border border-border bg-bg-2 px-2.5 py-1 text-xs text-text-2">
                                {item.document_count} 文档
                              </span>
                              {selected ? (
                                <span className="inline-flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-on-accent">
                                  <CheckCircle2 size={12} />
                                  已选中
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-text-2">
                              {item.synopsis || '暂无梗概，导入时会读取作品导出的完整 Markdown。'}
                            </p>
                            <div className="mt-3 text-xs text-text-3">
                              更新 {item.updated_at ? new Date(item.updated_at).toLocaleDateString() : '未知'}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex min-h-[320px] flex-col rounded-[18px] border border-border/60 bg-bg-surface p-4 shadow-shadow-xs">
                  {selectedWritingSource ? (
                    <>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">已选小说</div>
                          <div className="mt-2 line-clamp-1 font-body text-lg font-black tracking-normal text-text-0">
                            {selectedWritingSource.title}
                          </div>
                        </div>
                        <span className="inline-flex h-8 shrink-0 items-center rounded-full border border-border bg-bg-2 px-3 text-xs text-text-2">
                          {selectedWritingSource.document_count} 文档
                        </span>
                      </div>
                      <p className="mt-3 line-clamp-3 text-sm leading-6 text-text-2">
                        {selectedWritingSource.synopsis || '暂无梗概，导入时会读取作品导出的完整 Markdown。'}
                      </p>

                      <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-text-0">
                        <span className="inline-flex size-6 items-center justify-center rounded-full bg-bg-2 text-xs font-semibold text-accent-text">A</span>
                        改编目标
                      </div>
                      <p className="mt-1 text-xs leading-5 text-text-3">
                        选中小说后，先确认这次改编的目标参数；导入完成后会带回当前短剧项目。
                      </p>
                      <AdaptationTargetFields
                        gridClassName="mt-4 sm:grid-cols-2"
                        targetEpisodeCount={pickerTargetEpisodes}
                        onTargetEpisodeCountChange={setPickerTargetEpisodes}
                        episodeDuration={pickerEpisodeDuration}
                        onEpisodeDurationChange={setPickerEpisodeDuration}
                        visualStyle={pickerVisualStyle}
                        onVisualStyleChange={setPickerVisualStyle}
                        aspectRhythm={pickerAspectRhythm}
                        onAspectRhythmChange={setPickerAspectRhythm}
                      />

                      <div className="mt-4 rounded-[14px] border border-accent-glow bg-accent-bg/60 px-3.5 py-3 text-xs leading-5 text-text-2">
                        导入后会替换当前小说源稿；如果项目里已有旧方案草稿，它会失效，需要基于新源稿重新生成改编策略。
                      </div>
                    </>
                  ) : (
                    <div className="flex min-h-full flex-1 flex-col items-center justify-center px-6 text-center">
                      <Wand2 size={34} className="text-text-3" strokeWidth={1.8} />
                      <h3 className="mt-4 font-body text-base font-black tracking-normal text-text-0">先选一部小说</h3>
                      <p className="mt-2 text-sm leading-6 text-text-2">
                        选中左侧作品后，这里会立即出现改编目标参数，确认好再导入会更顺手。
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </DialogMain>

          <DialogActions variant="workspace" className="justify-end sm:flex-row sm:items-center sm:justify-end">
            <div className="flex shrink-0 justify-end gap-3">
              <Button
                type="button"
                variant="ghost"
                className="h-9 rounded-[10px] px-4"
                onClick={() => setSourcePickerOpen(false)}
                disabled={writingSourceImportingId != null}
              >
                取消
              </Button>
              <Button
                type="button"
                className="h-9 rounded-[10px] px-4"
                disabled={!selectedWritingSource || writingSourceImportingId != null}
                onClick={() => void importSelectedWritingSource()}
              >
                {writingSourceImportingId != null ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                导入并继续
              </Button>
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <CharacterBibleDialog character={selectedPlanCharacter} onClose={() => setSelectedPlanCharacter(null)} />

      <Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}>
        <DialogContent variant="workspace" size="wide">
          <DialogHeaderBar variant="workspace">
            <div
              className={
                sourceDialogMode === 'view'
                  ? 'flex items-start gap-3.5 pr-11 sm:pr-12'
                  : 'flex items-start gap-3.5 pr-11 sm:pr-12'
              }
            >
              <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent-glow bg-accent-bg text-accent">
                <BookOpen size={18} />
              </div>
              <div className="min-w-0">
                <DialogTitle className="font-body text-xl font-semibold leading-tight tracking-[-0.012em] text-text-0">
                  {sourceDialogMode === 'view' ? '查看小说剧本' : '粘贴小说剧本'}
                </DialogTitle>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain
            variant="workspace"
            className={
              sourceDialogMode === 'view'
                ? 'min-h-0 flex-1 gap-5 overflow-y-auto !p-0'
                : 'gap-5'
            }
          >
            {sourceDialogMode === 'edit' && adaptationPlan ? (
              <div className="flex gap-3 rounded-[14px] border border-accent-glow bg-accent-bg px-4 py-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-surface/70 text-accent">
                  <RefreshCw size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold tracking-[0.02em] text-accent-text">重新导入提醒</div>
                  <p className="mt-1 text-[13px] leading-6 text-text-2">
                    保存新的小说源稿后，当前改编规划会被置为失效并清空；已有分集不会被自动删除。
                  </p>
                </div>
              </div>
            ) : null}
            {sourceDialogHasBlockingIssue ? (
              <div role="alert" className="flex gap-3 rounded-[14px] border border-warning/30 bg-warning-bg px-4 py-3">
                <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-bg-surface/70 text-warning">
                  <AlertTriangle size={14} />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold tracking-[0.02em] text-warning">源稿内容异常</div>
                  <p id="novel-source-content-error" className="mt-1 text-[13px] leading-6 text-text-2">
                    {sourceDialogHealth.message}
                  </p>
                </div>
              </div>
            ) : null}
            {sourceDialogMode === 'view' ? (
              <div className="flex flex-col gap-4 px-6 pb-6 sm:px-7 sm:pb-7">
                <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <Input
                    aria-label="源稿标题"
                    value={sourceTitleDraft}
                    onChange={(event) => setSourceTitleDraft(event.target.value)}
                    placeholder="例如：时光邮局"
                    className="h-10 text-sm"
                    disabled
                  />
                  <div className="flex flex-wrap gap-2 text-xs text-text-2 sm:justify-end">
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-bg-2 px-3">
                      <FileText size={13} />
                      {formatCount(sourceDraftWordCount)} 字
                    </span>
                    <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-bg-2 px-3">
                      <LayoutGrid size={13} />
                      {sourceDraftChapterCount} 章
                    </span>
                  </div>
                </div>

                <textarea
                  id="novel-source-content"
                  aria-label="源稿正文"
                  value={sourceContentDraft}
                  onChange={(event) => setSourceContentDraft(event.target.value)}
                  placeholder="请粘贴整本小说全文..."
                  readOnly
                  aria-invalid={sourceDialogHasBlockingIssue ? true : undefined}
                  aria-describedby={sourceDialogHasBlockingIssue ? 'novel-source-content-error' : undefined}
                  className="h-[clamp(260px,34dvh,340px)] min-h-[260px] w-full shrink-0 resize-none rounded-[18px] border border-border bg-bg-input px-4 py-3.5 text-sm leading-7 text-text-0 shadow-inset outline-none transition-[border-color,box-shadow] placeholder:text-text-3 read-only:bg-bg-2 focus:border-border-focus focus:ring-[3px] focus:ring-accent-glow"
                />
              </div>
            ) : (
              <>
                <div className="rounded-[16px] border border-border bg-bg-0 p-4 shadow-shadow-xs">
                  <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                    <label className="flex min-w-0 flex-col gap-2">
                      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">源稿标题</span>
                      <Input
                        aria-label="源稿标题"
                        value={sourceTitleDraft}
                        onChange={(event) => setSourceTitleDraft(event.target.value)}
                        placeholder="例如：时光邮局"
                        className="h-10 text-sm"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2 text-xs text-text-2 sm:justify-end">
                      <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-bg-2 px-3">
                        <FileText size={13} />
                        {formatCount(sourceDraftWordCount)} 字
                      </span>
                      <span className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-bg-2 px-3">
                        <LayoutGrid size={13} />
                        {sourceDraftChapterCount} 章
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <label htmlFor="novel-source-content" className="text-xs font-semibold uppercase tracking-[0.08em] text-text-3">
                      源稿正文
                    </label>
                    <span className="shrink-0 text-xs text-text-3">{sourceContentDraft.length.toLocaleString()} 字符</span>
                  </div>
                  <textarea
                    id="novel-source-content"
                    aria-label="源稿正文"
                    value={sourceContentDraft}
                    onChange={(event) => setSourceContentDraft(event.target.value)}
                    placeholder="请粘贴整本小说全文..."
                    aria-invalid={sourceDialogHasBlockingIssue ? true : undefined}
                    aria-describedby={sourceDialogHasBlockingIssue ? 'novel-source-content-help novel-source-content-error' : 'novel-source-content-help'}
                    className="h-[clamp(260px,34dvh,340px)] min-h-[260px] w-full shrink-0 resize-none rounded-[18px] border border-border bg-bg-input px-4 py-3.5 text-sm leading-7 text-text-0 shadow-inset outline-none transition-[border-color,box-shadow] placeholder:text-text-3 read-only:bg-bg-2 focus:border-border-focus focus:ring-[3px] focus:ring-accent-glow"
                  />
                  <p id="novel-source-content-help" className="text-xs leading-5 text-text-3">
                    建议粘贴完整正文；系统会按章节标记统计章节，没有章节标记时会按全文处理。
                  </p>
                </div>
              </>
            )}
          </DialogMain>

          {sourceDialogMode === 'edit' ? (
            <DialogActions variant="workspace" className="border-0 bg-transparent !p-0">
              <div className="flex w-full shrink-0 flex-col-reverse gap-2 px-6 pb-6 sm:w-auto sm:flex-row sm:justify-end sm:px-7 sm:pb-7">
                <Button type="button" variant="ghost" className="h-10 w-full rounded-[var(--radius-sm)] px-4 sm:w-auto" onClick={() => setSourceDialogOpen(false)} disabled={sourceSaving}>
                  取消
                </Button>
                <Button
                  type="button"
                  className="h-10 w-full rounded-[var(--radius-sm)] px-5 sm:w-auto"
                  disabled={sourceSaving || !sourceContentDraft.trim() || sourceDialogHealth.kind !== 'valid'}
                  onClick={saveNovelSource}
                >
                  {sourceSaving ? <Loader2 size={14} className="animate-spin" /> : <FileUp size={14} />}
                  {sourceSaving ? '保存中...' : '保存源稿'}
                </Button>
              </div>
            </DialogActions>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={projectDefaultsDialogOpen} onOpenChange={setProjectDefaultsDialogOpen}>
        <DialogContent variant="form" size="large" className="animate-scale-in">
          <DialogDescription className="sr-only">
            配置当前项目默认使用的图片、视频和配音模型，后续制作流程会优先继承这些设定。
          </DialogDescription>
          <DialogHeaderBar variant="form">
            <div className="flex gap-3.5">
              <div
                className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-accent-glow bg-accent-bg text-accent shadow-shadow-xs"
                aria-hidden
              >
                <Settings2 className="size-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 pr-7">
                <DialogTitle className="font-display text-xl font-bold tracking-tight text-text-0 sm:text-[22px]">
                  项目默认设定
                </DialogTitle>
                <p className="mt-2 text-sm leading-6 text-text-2">
                  固定本项目常用的图片、视频和配音模型；角色、主角和音色由改编策略与后续制作流程生成。
                </p>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain variant="form">
            {missingConfigHints.length > 0 ? (
              <div role="alert" className="mb-4 rounded-[12px] border border-warning/30 bg-warning-bg px-4 py-3">
                <div className="text-sm font-semibold text-warning">仍缺少可用 AI 配置</div>
                <p className="mt-1 text-sm leading-6 text-text-2">
                  {missingConfigHints.join('、')}暂无启用项；相关生成按钮会提示先到设置中启用配置。
                </p>
              </div>
            ) : null}
            <div className="grid gap-4 xl:grid-cols-3">
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认图片模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.image_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, image_config_id: String(v) }))}
                  options={imageConfigOptions}
                  placeholder="选择图片模型"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认视频模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.video_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, video_config_id: String(v) }))}
                  options={videoConfigOptions}
                  placeholder="选择视频模型"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-2">
                <span className="text-xs font-medium text-text-2">默认配音模型</span>
                <BaseSelect
                  className="[&_button]:h-11 [&_button]:px-3.5 [&_button]:text-sm"
                  value={projectDefaults.audio_config_id}
                  onValueChange={(v) => setProjectDefaults((prev) => ({ ...prev, audio_config_id: String(v) }))}
                  options={audioConfigOptions}
                  placeholder="选择配音模型"
                />
              </label>
            </div>

          </DialogMain>

          <DialogActions variant="form">
            <Button
              type="button"
              variant="ghost"
              className="h-10 w-full sm:w-auto sm:min-w-[88px]"
              onClick={() => setProjectDefaultsDialogOpen(false)}
              disabled={defaultsSaving}
            >
              取消
            </Button>
            <Button
              type="button"
              className="h-10 w-full rounded-full px-6 sm:w-auto sm:min-w-[132px]"
              disabled={defaultsSaving}
              onClick={async () => {
                await saveProjectDefaults()
                setProjectDefaultsDialogOpen(false)
              }}
            >
              {defaultsSaving ? <Loader2 size={15} className="animate-spin" /> : <Settings2 size={15} />}
              保存设定
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={splitDialog} onOpenChange={setSplitDialog}>
        <DialogContent variant="workspace" size="wide">
          <DialogTitle className="sr-only">快速按标记分集</DialogTitle>
          <DialogDescription className="sr-only">
            粘贴带有集数或章节标记的剧本文本，系统会按标记自动拆分并写入各集原始内容。
          </DialogDescription>
          <DialogHeaderBar variant="workspace">
            <div className="flex items-start gap-4 pr-12">
              <div className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-accent-glow bg-accent-bg text-accent">
                <FileUp size={20} />
              </div>
              <div className="min-w-0">
                <div className="text-[22px] font-bold leading-tight tracking-[-0.018em] text-text-0">快速按标记分集</div>
                <p className="mt-2 text-sm leading-6 text-text-2">
                  粘贴已带集数或章节标记的剧本，系统会按“第1集”“第一集”“第1章”“第一章”等明确标记拆分，并保存到每集原始内容。
                </p>
              </div>
            </div>
          </DialogHeaderBar>

          <DialogMain variant="workspace" className="gap-4 overflow-hidden">
            <div className="rounded-[16px] border border-accent-glow bg-accent-bg px-4 py-3">
              <div className="text-xs font-semibold text-accent-text">推荐格式</div>
              <p className="mt-1 text-[13px] leading-6 text-text-2">
                在剧本中使用“第1集”“第一集”“第1章”“第一章”等明确标记；未识别到标记时不会自动按剧情或长度拆分。
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <div className="flex h-9 items-center gap-2 rounded-full border border-border bg-bg-2 px-4 text-sm font-semibold text-text-1">
                <FileText size={15} />
                文本输入
              </div>
              <span className="text-xs text-text-3">将写入每集原始内容</span>
            </div>

            <label className="relative block">
              <textarea
                value={splitContent}
                onChange={(event) => setSplitContent(event.target.value)}
                placeholder="请输入或粘贴剧本内容..."
                className="h-[clamp(260px,38dvh,330px)] w-full resize-none rounded-[18px] border border-border bg-bg-input px-4 py-3.5 text-sm leading-7 text-text-0 shadow-inset outline-none transition-[border-color,box-shadow] placeholder:text-text-3 focus:border-border-focus focus:ring-[3px] focus:ring-accent-glow"
              />
              <span className="absolute bottom-3 right-4 text-xs text-text-3">{splitContent.length}</span>
            </label>
          </DialogMain>

          <DialogActions variant="workspace" className="items-center justify-between sm:flex-row">
            <p className="text-xs leading-5 text-text-3">
              创建后可在分集卡片进入制作页继续改写剧本。
            </p>
            <div className="flex shrink-0 justify-end gap-3">
              <Button type="button" variant="ghost" className="h-9 rounded-[var(--radius-sm)] px-4" onClick={() => setSplitDialog(false)} disabled={splitting}>
                取消
              </Button>
              <Button
                type="button"
                className="h-9 rounded-[var(--radius-sm)] px-5"
                disabled={splitting || !splitContent.trim()}
                onClick={splitEpisodes}
              >
                {splitting ? '分集中...' : '开始分集'}
              </Button>
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={addDialog} onOpenChange={setAddDialog}>
        <DialogContent variant="form" size="standard">
          <DialogTitle className="sr-only">创建新集</DialogTitle>
          <DialogDescription className="sr-only">
            为当前短剧项目创建新的一集，并可在创建后直接进入单集制作页面。
          </DialogDescription>
          <DialogHeaderBar variant="form">
            <div className="text-[1.55rem] font-semibold tracking-[-0.018em] text-text-0">添加新集</div>
            <p className="mt-1 text-sm text-text-2">设置本集标题，创建后可直接进入单集制作。</p>
          </DialogHeaderBar>

          <DialogMain variant="form" className="gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-text-1">集标题（可选）</span>
              <Input
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="例如：重逢倒计时 · 第 2 集（留空自动命名）"
                className="h-11 rounded-xl text-sm"
              />
            </label>
          </DialogMain>

          <DialogActions variant="form" className="flex-col items-stretch gap-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-text-3">项目默认配置和模型可在后续制作时继承或覆盖。</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" className="h-10 rounded-full px-5" onClick={() => setAddDialog(false)} disabled={creating}>
                取消
              </Button>
              <Button
                className="h-10 shrink-0 rounded-full px-6"
                disabled={creating}
                onClick={onAddEpisode}
              >
                {creating ? '创建中...' : '创建并进入制作页'}
              </Button>
            </div>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewScriptEpisode} onOpenChange={(open) => { if (!open) setPreviewScriptEpisode(null) }}>
        <DialogContent variant="workspace" size="large">
          <DialogTitle className="sr-only">分集正文预览</DialogTitle>
          <DialogDescription className="sr-only">
            只读预览当前分集的正文内容，可在关闭后返回列表继续创作或登录后编辑。
          </DialogDescription>
          <DialogHeaderBar variant="workspace">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-3">Read only</div>
            <div className="mt-2 text-lg font-bold text-text-0">
              {previewScriptEpisode ? `${previewScriptEpisode.title || `第 ${previewScriptEpisode.episode_number} 集`} · 正文` : ''}
            </div>
          </DialogHeaderBar>
          <DialogMain variant="workspace" className="pt-5">
            {previewScriptEpisode ? (
              <pre className="whitespace-pre-wrap break-words rounded-[var(--radius-md)] border border-border bg-bg-2 p-4 text-sm leading-7 text-text-1">
                {episodePreviewText(previewScriptEpisode) || '（无内容）'}
              </pre>
            ) : null}
          </DialogMain>
          <DialogActions variant="workspace">
            <Button type="button" variant="outline" className="h-9 rounded-[10px]" onClick={() => setPreviewScriptEpisode(null)}>
              关闭
            </Button>
            <Button type="button" className="h-9 rounded-[10px]" onClick={openLoginNextHere}>
              <LogIn size={15} />
              登录后创作
            </Button>
          </DialogActions>
        </DialogContent>
      </Dialog>

      <Dialog open={!!previewVideoUrl} onOpenChange={(open) => { if (!open) setPreviewVideoUrl(null) }}>
        <DialogContent variant="media">
          <DialogTitle className="sr-only">视频预览</DialogTitle>
          <DialogDescription className="sr-only">
            预览当前短剧分集生成的视频内容，可直接在弹窗内播放查看效果。
          </DialogDescription>
          <button
            type="button"
            onClick={() => setPreviewVideoUrl(null)}
            className="fixed right-4 top-4 z-50 inline-flex size-8 items-center justify-center rounded-sm border border-white/25 bg-black/25 text-white/90 transition-colors hover:bg-black/45 hover:text-white sm:right-6 sm:top-6"
            aria-label="关闭预览"
            title="关闭"
          >
            <X size={14} aria-hidden />
          </button>
          <div className="flex min-h-0 flex-1 items-center justify-center p-3 sm:p-6">
            <div className="w-[min(960px,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-xl)] border border-border bg-bg-surface shadow-shadow-elevated">
              <DialogHeaderBar variant="workspace">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-text-3">Video Preview</div>
                <div className="mt-2 text-lg font-bold text-text-0">{previewVideoTitle || '视频预览'}</div>
              </DialogHeaderBar>
              <DialogMain variant="media" className="bg-black/70 p-3 sm:p-5">
                {previewVideoUrl ? (
                  <video src={previewVideoUrl} controls className="aspect-video w-full rounded-[var(--radius-md)] bg-bg-2" />
                ) : null}
              </DialogMain>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
