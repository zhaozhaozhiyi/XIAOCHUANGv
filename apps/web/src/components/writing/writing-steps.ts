import type { BriefState } from '@/components/writing/types'
import type { WritingDetail } from '@/types/api'

export const WRITING_STEPS = [
  { key: 'brief', label: '创作准备' },
  { key: 'outline', label: '大纲' },
  { key: 'write', label: '章节写作' },
  { key: 'review', label: '审阅' },
  { key: 'export', label: '导出' },
] as const

export type WritingStepKey = (typeof WRITING_STEPS)[number]['key']

export const WRITING_STEP_KEYS: WritingStepKey[] = WRITING_STEPS.map((step) => step.key)

export function isWritingStepKey(value: string | null): value is WritingStepKey {
  return value != null && WRITING_STEP_KEYS.includes(value as WritingStepKey)
}

export const WRITE_STEP_DOCUMENT_TYPES = new Set(['root', 'chapter', 'scene', 'note'])

export function formatWritingStatus(status: string) {
  if (status === 'draft') return '草稿'
  return status
}

export function formatDocumentType(type: string) {
  const map: Record<string, string> = {
    root: '根文档',
    chapter: '章节',
    outline: '大纲',
    brief: '创作准备',
    summary: '摘要',
    scene: '场景',
    note: '笔记',
  }
  return map[type] ?? type
}

export function findOutlineDocumentId(detail: WritingDetail | null) {
  return detail?.documents.find((doc) => doc.document_type === 'outline')?.id ?? null
}

export function computeStepProgress(
  detail: WritingDetail | null,
  briefDraft: BriefState,
  hasBodyContent: boolean,
  pendingProposals: number,
) {
  const briefDone =
    [briefDraft.worldview, briefDraft.background, briefDraft.main_plot, briefDraft.core_conflict, briefDraft.main_characters].filter(
      (value) => value.trim(),
    ).length >= 2
  const outlineDone = !!(detail?.outline_json?.trim()) || !!findOutlineDocumentId(detail)
  const chapterCount = detail?.documents.filter((doc) => doc.document_type === 'chapter').length ?? 0
  const writeDone = chapterCount > 0 && hasBodyContent
  const reviewDone = pendingProposals === 0

  const stepDone: Record<WritingStepKey, boolean> = {
    brief: briefDone,
    outline: outlineDone,
    write: writeDone,
    review: reviewDone,
    export: false,
  }

  return {
    done: Object.values(stepDone).filter(Boolean).length,
    total: WRITING_STEPS.length,
    stepDone,
  }
}

export function inferDefaultStep(briefDraft: BriefState): WritingStepKey {
  const briefFilled = [briefDraft.worldview, briefDraft.background, briefDraft.main_plot].filter((value) => value.trim()).length
  if (briefFilled === 0) return 'brief'
  return 'write'
}

export function buildBriefContextText(briefDraft: BriefState) {
  return [
    briefDraft.worldview ? `世界观：${briefDraft.worldview}` : '',
    briefDraft.background ? `背景：${briefDraft.background}` : '',
    briefDraft.main_plot ? `主线：${briefDraft.main_plot}` : '',
    briefDraft.core_conflict ? `核心冲突：${briefDraft.core_conflict}` : '',
    briefDraft.main_characters ? `主要角色：${briefDraft.main_characters}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export function resolveAiContext(
  step: WritingStepKey,
  detail: WritingDetail,
  briefDraft: BriefState,
  outlineDocId: number | null,
  activeDocId: number | null,
  docTitle: string,
  contentMd: string,
) {
  if (step === 'brief') {
    return {
      documentId: null as number | null,
      documentTitle: '创作准备',
      documentContent: buildBriefContextText(briefDraft),
    }
  }

  if (step === 'outline') {
    return {
      documentId: outlineDocId,
      documentTitle: docTitle || '作品大纲',
      documentContent: contentMd,
    }
  }

  if (step === 'export') {
    return {
      documentId: activeDocId,
      documentTitle: detail.title,
      documentContent: buildBriefContextText(briefDraft) || contentMd,
    }
  }

  return {
    documentId: activeDocId,
    documentTitle: docTitle || detail.title,
    documentContent: contentMd,
  }
}
