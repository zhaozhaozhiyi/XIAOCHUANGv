import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, Res, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, desc, eq, isNull } from 'drizzle-orm'
import type { FastifyReply } from 'fastify'
import { z } from 'zod'

import { DatabaseService } from '../../db/database.service'
import { writingBatchExecutions, writingDocuments, writingKnowledgeCardHistories, writingKnowledgeCards, writingObjectHistories, writingProposals, writings } from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { runWritingAiAction } from './writings.service'

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(20),
  kind: z.string().trim().optional(),
  status: z.string().trim().optional(),
  q: z.string().trim().optional(),
})

const createWritingSchema = z.object({
  title: z.string(),
  kind: z.enum(['novel', 'screenplay', 'outline']),
  synopsis: z.string().nullable().optional(),
  brief_json: z.string().nullable().optional(),
})

const addDocumentSchema = z.object({
  title: z.string(),
  parent_id: z.number().int().nullable().optional(),
  document_type: z.enum(['root', 'chapter', 'scene', 'note', 'brief', 'summary', 'outline']),
})

const aiActionSchema = z.object({
  document_id: z.number().int().positive(),
  action: z.enum(['continue', 'polish', 'summarize', 'extract_outline']),
  instructions: z.string().optional(),
})

const patchWritingSchema = z.object({
  title: z.string().optional(),
  kind: z.enum(['novel', 'screenplay', 'outline']).optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  synopsis: z.string().nullable().optional(),
  outline_json: z.string().nullable().optional(),
  brief_json: z.string().nullable().optional(),
  current_document_id: z.number().int().positive().nullable().optional(),
})

const patchDocumentSchema = z.object({
  title: z.string().optional(),
  content_md: z.string().optional(),
  sort_order: z.number().int().optional(),
  summary: z.string().nullable().optional(),
})

const listHistoryQuerySchema = z.object({
  object_kind: z.enum(['brief', 'outline', 'summary']),
  document_id: z.coerce.number().int().positive().optional(),
})

const restoreHistorySchema = z.object({
  history_id: z.number().int().positive(),
})

const previewHistoryQuerySchema = z.object({
  history_id: z.coerce.number().int().positive(),
})

const listKnowledgeHistoryQuerySchema = z.object({
  card_id: z.coerce.number().int().positive(),
})

const restoreKnowledgeHistorySchema = z.object({
  history_id: z.number().int().positive(),
})

const referenceNetworkQuerySchema = z.object({
  proposal_id: z.coerce.number().int().positive().optional(),
  document_id: z.coerce.number().int().positive().optional(),
})

const proposalImpactQuerySchema = z.object({
  proposal_id: z.coerce.number().int().positive(),
})

const batchPlanSchema = z.object({
  proposal_ids: z.array(z.number().int().positive()).min(1),
})

const batchApplySchema = z.object({
  proposal_ids: z.array(z.number().int().positive()).min(1),
  stop_on_error: z.boolean().optional().default(true),
  allow_conflicts: z.boolean().optional().default(false),
  note: z.string().trim().max(255).optional(),
  tag: z.string().trim().max(100).optional(),
})

const rollbackBatchSchema = z.object({
  execution_id: z.number().int().positive(),
})

const batchExecutionDetailQuerySchema = z.object({
  execution_id: z.coerce.number().int().positive(),
})

const listBatchExecutionsQuerySchema = z.object({
  q: z.string().trim().optional(),
  tag: z.string().trim().optional(),
  status: z.enum(['all', 'blocked', 'applied']).optional().default('all'),
  marker: z.enum(['all', 'pinned', 'important']).optional().default('all'),
  page: z.coerce.number().int().positive().optional().default(1),
  page_size: z.coerce.number().int().positive().max(50).optional().default(6),
})

const patchBatchExecutionSchema = z.object({
  execution_id: z.number().int().positive(),
  is_pinned: z.boolean().optional(),
  is_important: z.boolean().optional(),
}).refine((value) => value.is_pinned !== undefined || value.is_important !== undefined, {
  message: 'patch payload is empty',
})

const createProposalSchema = z.object({
  source_run_id: z.number().int().positive().nullable().optional(),
  proposal_kind: z.string().trim().min(1).default('generic'),
  target_kind: z.string().trim().min(1).default('proposal'),
  target_document_id: z.number().int().positive().nullable().optional(),
  title: z.string().trim().min(1),
  content: z.string(),
  references: z.array(z.object({
    kind: z.string(),
    title: z.string(),
    reason: z.string().optional(),
    document_id: z.number().int().positive().optional(),
  })).optional().default([]),
  structured: z.object({
    issues: z.array(z.object({
      title: z.string(),
      evidence: z.array(z.string()).optional(),
      suggested_fix: z.array(z.string()).optional(),
      target_object: z.string().nullable().optional(),
    })).optional(),
  }).nullable().optional(),
})

const createKnowledgeCardSchema = z.object({
  proposal_id: z.number().int().positive().nullable().optional(),
  card_type: z.enum(['character', 'setting', 'worldview', 'term', 'plotline', 'foreshadowing']),
  title: z.string().trim().min(1),
  content: z.string(),
  evidence: z.array(z.object({
    kind: z.string(),
    title: z.string(),
    reason: z.string().optional(),
    document_id: z.number().int().positive().optional(),
  })).optional().default([]),
})

const patchKnowledgeCardSchema = z.object({
  card_type: z.enum(['character', 'setting', 'worldview', 'term', 'plotline', 'foreshadowing']).optional(),
  title: z.string().trim().min(1).optional(),
  content: z.string().optional(),
  evidence: z.array(z.object({
    kind: z.string(),
    title: z.string(),
    reason: z.string().optional(),
    document_id: z.number().int().positive().optional(),
  })).optional(),
})

function now() {
  return new Date()
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function getBatchGroupLabel(targetKind: string) {
  if (targetKind === 'brief') return '????'
  if (targetKind === 'outline') return '??'
  if (targetKind === 'summary') return '??'
  if (targetKind === 'document') return '????'
  if (targetKind === 'knowledge') return '????'
  return '????'
}

function getProposalExecutionPriority(targetKind: string) {
  if (targetKind === 'brief') return 10
  if (targetKind === 'outline') return 20
  if (targetKind === 'summary') return 30
  if (targetKind === 'document') return 40
  if (targetKind === 'knowledge') return 50
  return 99
}

function countImpactRows(impact: {
  briefs: unknown[]
  outlines: unknown[]
  summaries: unknown[]
  documents: unknown[]
  knowledge_cards: unknown[]
  object_histories: unknown[]
  knowledge_histories: unknown[]
}) {
  return {
    briefs: impact.briefs.length,
    outlines: impact.outlines.length,
    summaries: impact.summaries.length,
    documents: impact.documents.length,
    knowledge_cards: impact.knowledge_cards.length,
    object_histories: impact.object_histories.length,
    knowledge_histories: impact.knowledge_histories.length,
  }
}

function countWordsMd(md: string): number {
  const text = String(md || '').trim()
  if (!text) return 0
  return text.length
}




async function createKnowledgeCardHistory(args: {
  databaseService: DatabaseService
  writingId: number
  knowledgeCardId: number
  userId: number
  cardType: string
  title: string
  content: string
  evidenceJson?: string | null
  sourceProposalId?: number | null
  sourceRunId?: number | null
}) {
  await args.databaseService.db.insert(writingKnowledgeCardHistories).values({
    writingId: args.writingId,
    knowledgeCardId: args.knowledgeCardId,
    userId: args.userId,
    cardType: args.cardType,
    title: args.title,
    content: args.content,
    evidenceJson: args.evidenceJson ?? null,
    sourceProposalId: args.sourceProposalId ?? null,
    sourceRunId: args.sourceRunId ?? null,
    createdAt: now(),
  })
}

function buildLineDiff(previousContent: string, currentContent: string) {
  const previousLines = String(previousContent || '').split('\n')
  const currentLines = String(currentContent || '').split('\n')
  const max = Math.max(previousLines.length, currentLines.length)
  const lines: Array<{ type: 'same' | 'added' | 'removed'; text: string }> = []
  for (let index = 0; index < max; index += 1) {
    const previousLine = previousLines[index]
    const currentLine = currentLines[index]
    if (previousLine === currentLine) {
      if (previousLine !== undefined) lines.push({ type: 'same', text: previousLine })
      continue
    }
    if (previousLine !== undefined) lines.push({ type: 'removed', text: previousLine })
    if (currentLine !== undefined) lines.push({ type: 'added', text: currentLine })
  }
  return lines
}

async function createObjectHistory(args: {
  databaseService: DatabaseService
  writingId: number
  userId: number
  objectKind: 'brief' | 'outline' | 'summary'
  content: string | null | undefined
  documentId?: number | null
  snapshotTitle?: string | null
  sourceProposalId?: number | null
  sourceRunId?: number | null
}) {
  const content = String(args.content || '')
  if (!content.trim()) return
  await args.databaseService.db.insert(writingObjectHistories).values({
    writingId: args.writingId,
    userId: args.userId,
    objectKind: args.objectKind,
    documentId: args.documentId ?? null,
    snapshotTitle: args.snapshotTitle ?? null,
    content,
    sourceProposalId: args.sourceProposalId ?? null,
    sourceRunId: args.sourceRunId ?? null,
    createdAt: now(),
  })
}

function parseId(value: string, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`invalid ${label}`)
  }
  return id
}

function inferKnowledgeCardType(title: string, content: string, proposalKind: string) {
  const source = `${title}
${content}`.toLowerCase()
  if (proposalKind === 'consistency_check') return 'plotline'
  if (source.includes('??') || source.includes('??') || source.includes('??') || source.includes('??') || source.includes('character')) return 'character'
  if (source.includes('???') || source.includes('??') || source.includes('??') || source.includes('worldview')) return 'worldview'
  if (source.includes('??') || source.includes('??') || source.includes('??') || source.includes('??') || source.includes('setting')) return 'setting'
  if (source.includes('??') || source.includes('??') || source.includes('??') || source.includes('term')) return 'term'
  if (source.includes('??') || source.includes('??') || source.includes('??') || source.includes('foreshadow')) return 'foreshadowing'
  if (source.includes('??') || source.includes('??') || source.includes('??') || source.includes('???') || source.includes('plot')) return 'plotline'
  return 'setting'
}

@ApiTags('writings')
@Controller('writings')
@UseGuards(SessionAuthGuard)
export class WritingsController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get()
  async list(@Query() query: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const parsed = listQuerySchema.parse(query)
    let rows = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))
      .orderBy(desc(writings.updatedAt))

    if (parsed.kind) rows = rows.filter((row) => row.kind === parsed.kind)
    if (parsed.status) rows = rows.filter((row) => row.status === parsed.status)
    if (parsed.q) {
      const q = parsed.q.toLowerCase()
      rows = rows.filter((row) => row.title.toLowerCase().includes(q) || String(row.synopsis || '').toLowerCase().includes(q))
    }

    const total = rows.length
    const start = (parsed.page - 1) * parsed.page_size
    const pageRows = rows.slice(start, start + parsed.page_size)

    const items = await Promise.all(pageRows.map(async (row) => {
      const documentCount = (await this.databaseService.db
        .select()
        .from(writingDocuments)
        .where(and(eq(writingDocuments.writingId, row.id), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))).length

      return {
        id: row.id,
        title: row.title,
        kind: row.kind,
        status: row.status,
        synopsis: row.synopsis,
        updated_at: row.updatedAt,
        document_count: documentCount,
        current_document_id: row.currentDocumentId,
      }
    }))

    return {
      items,
      pagination: {
        page: parsed.page,
        page_size: parsed.page_size,
        total,
      },
    }
  }

  @Get(':id')
  async getDetail(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const writingId = parseId(id, 'writing id')
    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) {
      return { error: 'writing_not_found' }
    }

    const documents = (await this.databaseService.db
      .select()
      .from(writingDocuments)
      .where(and(eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt))))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
      .map((doc) => ({
        id: doc.id,
        parent_id: doc.parentId,
        title: doc.title,
        document_type: doc.documentType,
        sort_order: doc.sortOrder,
        updated_at: doc.updatedAt,
      }))

    return {
      id: writing.id,
      title: writing.title,
      kind: writing.kind,
      status: writing.status,
      synopsis: writing.synopsis,
      outline_json: writing.outlineJson,
      brief_json: writing.briefJson,
      current_document_id: writing.currentDocumentId,
      updated_at: writing.updatedAt,
      created_at: writing.createdAt,
      documents,
    }
  }

  @Get(':id/export')
  async exportMarkdown(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const writingId = parseId(id, 'writing id')
    if ((format || 'md') !== 'md') {
      return { error: 'writing_export_format_invalid' }
    }

    const detail = await this.getDetail(String(writingId), currentUser)
    if ('error' in detail) {
      return detail
    }

    const sections: string[] = [`# ${detail.title}`]
    if (detail.synopsis?.trim()) {
      sections.push(`## 鎽樿\n\n${detail.synopsis.trim()}`)
    }

    for (const item of detail.documents) {
      const [document] = await this.databaseService.db
        .select()
        .from(writingDocuments)
        .where(and(eq(writingDocuments.id, item.id), eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))
      if (!document) continue
      const content = String(document.contentMd || '').trim()
      if (!content && document.documentType === 'root') continue
      sections.push(`## ${document.title}\n\n${content || '_绌虹櫧鏂囨。_'}`)
    }

    const filename = `${detail.title.replace(/[\\/:*?"<>|]+/g, '_') || 'writing'}.md`
    reply.header('Content-Type', 'text/markdown; charset=utf-8')
    reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return sections.join('\n\n')
  }

  @Get(':id/documents/:documentId')
  async getDocument(
    @Param('id') id: string,
    @Param('documentId') documentIdParam: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const documentId = parseId(documentIdParam, 'document id')
    const [document] = await this.databaseService.db
      .select()
      .from(writingDocuments)
      .where(and(eq(writingDocuments.id, documentId), eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))

    if (!document) {
      return { error: 'document_not_found' }
    }

    return {
      id: document.id,
      writing_id: document.writingId,
      parent_id: document.parentId,
      title: document.title,
      document_type: document.documentType,
      sort_order: document.sortOrder,
      content_md: document.contentMd,
      summary: document.summary,
      word_count: document.wordCount,
      updated_at: document.updatedAt,
      created_at: document.createdAt,
    }
  }

  @Post()
  async create(@Body() body: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const payload = createWritingSchema.parse(body)
    const ts = now()
    const title = payload.title.trim() || '未命名作品'

    const [writing] = await this.databaseService.db
      .insert(writings)
      .values({
        userId: currentUser.id,
        title,
        kind: payload.kind,
        status: 'draft',
        synopsis: payload.synopsis?.trim() || null,
        outlineJson: null,
        briefJson: payload.brief_json?.trim() || null,
        currentDocumentId: null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    const [document] = await this.databaseService.db
      .insert(writingDocuments)
      .values({
        writingId: writing.id,
        userId: currentUser.id,
        parentId: null,
        title: '作品根文档',
        documentType: 'root',
        sortOrder: 0,
        contentMd: '',
        summary: null,
        wordCount: 0,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    await this.databaseService.db
      .update(writings)
      .set({ currentDocumentId: document.id, updatedAt: ts })
      .where(eq(writings.id, writing.id))

    return { writing_id: writing.id, document_id: document.id }
  }

  @Post(':id/documents')
  async addDocument(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = addDocumentSchema.parse(body)
    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) {
      return { error: 'writing_not_found' }
    }

    if (payload.parent_id != null) {
      const [parent] = await this.databaseService.db
        .select()
        .from(writingDocuments)
        .where(and(eq(writingDocuments.id, payload.parent_id), eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))
      if (!parent) {
        return { error: 'invalid_parent_id' }
      }
    }

    const siblings = await this.databaseService.db
      .select()
      .from(writingDocuments)
      .where(
        and(
          eq(writingDocuments.writingId, writingId),
          eq(writingDocuments.userId, currentUser.id),
          payload.parent_id == null ? isNull(writingDocuments.parentId) : eq(writingDocuments.parentId, payload.parent_id),
          isNull(writingDocuments.deletedAt),
        ),
      )

    const maxOrder = siblings.reduce((value, row) => Math.max(value, row.sortOrder), -1)
    const ts = now()
    const [document] = await this.databaseService.db
      .insert(writingDocuments)
      .values({
        writingId,
        userId: currentUser.id,
        parentId: payload.parent_id ?? null,
        title: payload.title.trim() || '未命名文档',
        documentType: payload.document_type,
        sortOrder: maxOrder + 1,
        contentMd: '',
        summary: null,
        wordCount: 0,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    await this.databaseService.db
      .update(writings)
      .set({ currentDocumentId: document.id, updatedAt: ts })
      .where(eq(writings.id, writingId))

    return { document_id: document.id }
  }

  @Post(':id/ai-actions')
  async aiAction(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = aiActionSchema.parse(body)
    const detail = await this.getDetail(String(writingId), currentUser)
    const document = await this.getDocument(String(writingId), String(payload.document_id), currentUser)

    if ('error' in detail || 'error' in document) {
      return { error: 'document_not_found' }
    }

    const resultText = await runWritingAiAction(this.databaseService, payload.action, {
      title: detail.title,
      synopsis: detail.synopsis,
      documentTitle: document.title,
      content: document.content_md,
      instructions: payload.instructions,
    })

    return {
      action: payload.action,
      result_text: resultText,
      document_id: payload.document_id,
    }
  }



  private async rollbackBatchExecution(writingId: number, executionId: number, currentUser: CurrentUserType) {
    const [execution] = await this.databaseService.db
      .select()
      .from(writingBatchExecutions)
      .where(and(eq(writingBatchExecutions.id, executionId), eq(writingBatchExecutions.writingId, writingId), eq(writingBatchExecutions.userId, currentUser.id)))

    if (!execution) return { error: 'batch_execution_not_found' as const }

    const rollbackItems = safeJsonParse<Array<Record<string, unknown>>>(execution.rollbackJson, [])
    for (const item of [...rollbackItems].reverse()) {
      const kind = String(item.kind || '')
      if (kind === 'object_history_restore') {
        const historyId = Number(item.history_id || 0)
        if (historyId > 0) {
          const result = await this.restoreObjectHistory(String(writingId), { history_id: historyId }, currentUser)
          if ('error' in result) return result
        }
      }
      if (kind === 'knowledge_history_restore') {
        const historyId = Number(item.history_id || 0)
        if (historyId > 0) {
          const result = await this.restoreKnowledgeCardHistory(String(writingId), { history_id: historyId }, currentUser)
          if ('error' in result) return result
        }
      }
      if (kind === 'knowledge_delete') {
        const cardId = Number(item.knowledge_card_id || 0)
        if (cardId > 0) {
          await this.databaseService.db.update(writingKnowledgeCards).set({ deletedAt: now(), updatedAt: now() }).where(eq(writingKnowledgeCards.id, cardId))
        }
      }
      if (kind === 'document_delete') {
        const documentId = Number(item.document_id || 0)
        if (documentId > 0) {
          await this.databaseService.db.update(writingDocuments).set({ deletedAt: now(), updatedAt: now() }).where(eq(writingDocuments.id, documentId))
        }
      }
    }

    return { restored: true }
  }

  private async applyProposalRecord(writingId: number, proposal: typeof writingProposals.$inferSelect, currentUser: CurrentUserType) {
    if (proposal.status !== 'pending') return { error: 'proposal_not_pending' as const }

    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) return { error: 'writing_not_found' as const }

    const ts = now()
    if (proposal.targetKind === 'brief') {
      await createObjectHistory({ databaseService: this.databaseService, writingId, userId: currentUser.id, objectKind: 'brief', content: writing.briefJson, snapshotTitle: '????', sourceProposalId: proposal.id, sourceRunId: proposal.sourceRunId })
      await this.databaseService.db.update(writings).set({ briefJson: proposal.content, updatedAt: ts }).where(eq(writings.id, writingId))
    } else if (proposal.targetKind === 'outline') {
      await createObjectHistory({ databaseService: this.databaseService, writingId, userId: currentUser.id, objectKind: 'outline', content: writing.outlineJson, snapshotTitle: '??', sourceProposalId: proposal.id, sourceRunId: proposal.sourceRunId })
      await this.databaseService.db.update(writings).set({ outlineJson: proposal.content, updatedAt: ts }).where(eq(writings.id, writingId))
    } else if (proposal.targetKind === 'summary' && proposal.targetDocumentId) {
      const [targetDocument] = await this.databaseService.db.select().from(writingDocuments).where(eq(writingDocuments.id, proposal.targetDocumentId))
      await createObjectHistory({ databaseService: this.databaseService, writingId, userId: currentUser.id, objectKind: 'summary', content: targetDocument?.summary, documentId: proposal.targetDocumentId, snapshotTitle: targetDocument?.title ?? null, sourceProposalId: proposal.id, sourceRunId: proposal.sourceRunId })
      await this.databaseService.db.update(writingDocuments).set({ summary: proposal.content, updatedAt: ts }).where(eq(writingDocuments.id, proposal.targetDocumentId))
    } else if (proposal.targetKind === 'knowledge') {
      await this.databaseService.db.insert(writingKnowledgeCards).values({
        writingId,
        userId: currentUser.id,
        proposalId: proposal.id,
        cardType: inferKnowledgeCardType(proposal.title, proposal.content, proposal.proposalKind),
        title: proposal.title,
        content: proposal.content,
        evidenceJson: proposal.referencesJson,
        createdAt: ts,
        updatedAt: ts,
      })
    } else {
      const [inserted] = await this.databaseService.db.insert(writingDocuments).values({
        writingId,
        userId: currentUser.id,
        title: proposal.title,
        documentType: 'note',
        sortOrder: 9999,
        contentMd: proposal.content,
        createdAt: ts,
        updatedAt: ts,
      }).returning()
      await this.databaseService.db.update(writingProposals).set({ targetDocumentId: inserted.id }).where(eq(writingProposals.id, proposal.id))
    }

    await this.databaseService.db.update(writingProposals).set({ status: 'applied', appliedAt: ts, updatedAt: ts }).where(eq(writingProposals.id, proposal.id))
    await this.databaseService.db.update(writings).set({ updatedAt: ts }).where(eq(writings.id, writingId))
    return { updated: true, status: 'applied' as const }
  }


  private async buildProposalImpact(writingId: number, proposalId: number, currentUser: CurrentUserType) {
    const [proposal] = await this.databaseService.db
      .select()
      .from(writingProposals)
      .where(and(eq(writingProposals.id, proposalId), eq(writingProposals.writingId, writingId), eq(writingProposals.userId, currentUser.id)))

    if (!proposal) return null

    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) return null

    const knowledgeCards = await this.databaseService.db
      .select()
      .from(writingKnowledgeCards)
      .where(and(eq(writingKnowledgeCards.writingId, writingId), eq(writingKnowledgeCards.userId, currentUser.id), isNull(writingKnowledgeCards.deletedAt)))

    const objectHistories = await this.databaseService.db
      .select()
      .from(writingObjectHistories)
      .where(and(eq(writingObjectHistories.writingId, writingId), eq(writingObjectHistories.userId, currentUser.id)))

    const knowledgeHistories = await this.databaseService.db
      .select()
      .from(writingKnowledgeCardHistories)
      .where(and(eq(writingKnowledgeCardHistories.writingId, writingId), eq(writingKnowledgeCardHistories.userId, currentUser.id)))

    const documents = await this.databaseService.db
      .select()
      .from(writingDocuments)
      .where(and(eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))

    const affectedDocuments = documents.filter((item) => item.id === proposal.targetDocumentId || proposal.referencesJson?.includes(`"document_id":${item.id}`))
    const affectedKnowledgeCards = knowledgeCards.filter((item) => item.proposalId === proposal.id || item.evidenceJson?.includes(proposal.title))
    const affectedObjectHistories = objectHistories.filter((item) => item.sourceProposalId === proposal.id)
    const affectedKnowledgeHistories = knowledgeHistories.filter((item) => item.sourceProposalId === proposal.id)

    const briefDiff = proposal.targetKind === 'brief' ? [{ title: '????', diff_preview: buildLineDiff(writing.briefJson || '', proposal.content).slice(0, 12) }] : []
    const outlineDiff = proposal.targetKind === 'outline' ? [{ title: '??', diff_preview: buildLineDiff(writing.outlineJson || '', proposal.content).slice(0, 12) }] : []
    const summaryDiff = proposal.targetKind === 'summary' && proposal.targetDocumentId
      ? affectedDocuments.filter((item) => item.id === proposal.targetDocumentId).map((item) => ({ id: item.id, title: item.title, diff_preview: buildLineDiff(item.summary || '', proposal.content).slice(0, 12) }))
      : []

    const impact = {
      proposal: {
        id: proposal.id,
        title: proposal.title,
        proposal_kind: proposal.proposalKind,
        target_kind: proposal.targetKind,
        target_document_id: proposal.targetDocumentId,
        content: proposal.content,
      },
      briefs: briefDiff,
      outlines: outlineDiff,
      summaries: summaryDiff,
      documents: affectedDocuments.map((item) => ({
        id: item.id,
        title: item.title,
        relation: item.documentType,
        diff_preview: buildLineDiff(item.summary || item.contentMd || '', proposal.content).slice(0, 12),
      })),
      knowledge_cards: affectedKnowledgeCards.map((item) => ({
        id: item.id,
        title: item.title,
        relation: item.cardType,
        diff_preview: buildLineDiff(item.content, proposal.content).slice(0, 12),
      })),
      object_histories: affectedObjectHistories.map((item) => ({ id: item.id, title: item.snapshotTitle || item.objectKind, relation: item.objectKind })),
      knowledge_histories: affectedKnowledgeHistories.map((item) => ({ id: item.id, title: item.title, relation: item.cardType })),
      counts: {
        briefs: briefDiff.length,
        outlines: outlineDiff.length,
        summaries: summaryDiff.length,
        documents: affectedDocuments.length,
        knowledge_cards: affectedKnowledgeCards.length,
        object_histories: affectedObjectHistories.length,
        knowledge_histories: affectedKnowledgeHistories.length,
      },
    }

    return { proposal, impact }
  }

  @Get(':id/proposal-impact')
  async getProposalImpact(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = proposalImpactQuerySchema.parse(query)
    const result = await this.buildProposalImpact(writingId, payload.proposal_id, currentUser)

    if (!result) return { error: 'proposal_not_found' }
    return result.impact
  }

  @Post(':id/proposals/batch-plan')
  async getBatchPlan(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = batchPlanSchema.parse(body)
    const orderedImpacts: Array<NonNullable<Awaited<ReturnType<WritingsController['buildProposalImpact']>>>> = []

    for (const proposalId of payload.proposal_ids) {
      const result = await this.buildProposalImpact(writingId, proposalId, currentUser)
      if (!result) return { error: 'proposal_not_found', proposal_id: proposalId }
      if (result.proposal.status !== 'pending') return { error: 'proposal_not_pending', proposal_id: proposalId }
      orderedImpacts.push(result)
    }

    const recommendedProposalIds = [...orderedImpacts]
      .sort((left, right) => {
        const priority = getProposalExecutionPriority(left.proposal.targetKind) - getProposalExecutionPriority(right.proposal.targetKind)
        if (priority !== 0) return priority
        return left.proposal.id - right.proposal.id
      })
      .map((item) => item.proposal.id)

    const impactById = new Map(orderedImpacts.map((item) => [item.proposal.id, item]))
    const orderedByRecommendation = recommendedProposalIds
      .map((proposalId) => impactById.get(proposalId))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))

    const groups = orderedByRecommendation.reduce<Array<{ key: string; label: string; proposal_ids: number[] }>>((acc, item) => {
      const key = item.proposal.targetKind || 'other'
      const existing = acc.find((group) => group.key === key)
      if (existing) {
        existing.proposal_ids.push(item.proposal.id)
        return acc
      }
      acc.push({ key, label: getBatchGroupLabel(key), proposal_ids: [item.proposal.id] })
      return acc
    }, [])

    const conflictMap = new Map<string, { key: string; target_kind: string; target_document_id: number | null; proposal_ids: number[]; proposal_titles: string[]; severity: 'warning' | 'blocking'; reason: string }>()
    for (const item of orderedByRecommendation) {
      const proposal = item.proposal
      const key = proposal.targetDocumentId != null ? `${proposal.targetKind}:${proposal.targetDocumentId}` : `${proposal.targetKind}:${proposal.targetKind === 'knowledge' ? proposal.id : 'global'}`
      const current = conflictMap.get(key) ?? {
        key,
        target_kind: proposal.targetKind,
        target_document_id: proposal.targetDocumentId,
        proposal_ids: [],
        proposal_titles: [],
        severity: proposal.targetKind === 'knowledge' ? 'warning' : 'blocking',
        reason: proposal.targetKind === 'knowledge' ? '????????????????????' : '?????????????????????????',
      }
      current.proposal_ids.push(proposal.id)
      current.proposal_titles.push(proposal.title)
      conflictMap.set(key, current)
    }

    const conflicts = Array.from(conflictMap.values()).filter((item) => item.proposal_ids.length > 1)

    const counts = orderedByRecommendation.reduce((acc, item) => {
      const impactCounts = countImpactRows(item.impact)
      acc.briefs += impactCounts.briefs
      acc.outlines += impactCounts.outlines
      acc.summaries += impactCounts.summaries
      acc.documents += impactCounts.documents
      acc.knowledge_cards += impactCounts.knowledge_cards
      acc.object_histories += impactCounts.object_histories
      acc.knowledge_histories += impactCounts.knowledge_histories
      return acc
    }, { briefs: 0, outlines: 0, summaries: 0, documents: 0, knowledge_cards: 0, object_histories: 0, knowledge_histories: 0 })

    return {
      proposal_ids: payload.proposal_ids,
      recommended_proposal_ids: recommendedProposalIds,
      ordered_impacts: orderedByRecommendation.map((item) => item.impact),
      groups,
      conflicts,
      counts,
      can_apply: !conflicts.some((item) => item.severity === 'blocking'),
    }
  }

  @Get(':id/reference-network')
  async getReferenceNetwork(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = referenceNetworkQuerySchema.parse(query)

    const proposals = await this.databaseService.db
      .select()
      .from(writingProposals)
      .where(and(eq(writingProposals.writingId, writingId), eq(writingProposals.userId, currentUser.id)))

    const knowledgeCards = await this.databaseService.db
      .select()
      .from(writingKnowledgeCards)
      .where(and(eq(writingKnowledgeCards.writingId, writingId), eq(writingKnowledgeCards.userId, currentUser.id), isNull(writingKnowledgeCards.deletedAt)))

    const objectHistories = await this.databaseService.db
      .select()
      .from(writingObjectHistories)
      .where(and(eq(writingObjectHistories.writingId, writingId), eq(writingObjectHistories.userId, currentUser.id)))

    const knowledgeHistories = await this.databaseService.db
      .select()
      .from(writingKnowledgeCardHistories)
      .where(and(eq(writingKnowledgeCardHistories.writingId, writingId), eq(writingKnowledgeCardHistories.userId, currentUser.id)))

    const documents = await this.databaseService.db
      .select()
      .from(writingDocuments)
      .where(and(eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))

    const filteredProposals = payload.proposal_id ? proposals.filter((item) => item.id === payload.proposal_id || item.referencesJson?.includes(`"document_id":${payload.document_id ?? ''}`)) : proposals

    return {
      proposals: filteredProposals.map((item) => ({
        type: 'proposal',
        id: item.id,
        title: item.title,
        relation: item.targetKind,
        target_document_id: item.targetDocumentId,
        source_proposal_id: null,
      })),
      knowledge_cards: knowledgeCards
        .filter((item) => !payload.proposal_id || item.proposalId === payload.proposal_id)
        .map((item) => ({
          type: 'knowledge_card',
          id: item.id,
          title: item.title,
          relation: item.cardType,
          source_proposal_id: item.proposalId,
        })),
      object_histories: objectHistories
        .filter((item) => !payload.proposal_id || item.sourceProposalId === payload.proposal_id)
        .map((item) => ({
          type: 'object_history',
          id: item.id,
          title: item.snapshotTitle || item.objectKind,
          relation: item.objectKind,
          target_document_id: item.documentId,
          target_object_kind: item.objectKind as 'brief' | 'outline' | 'summary',
          source_proposal_id: item.sourceProposalId,
        })),
      knowledge_histories: knowledgeHistories
        .filter((item) => !payload.proposal_id || item.sourceProposalId === payload.proposal_id)
        .map((item) => ({
          type: 'knowledge_history',
          id: item.id,
          title: item.title,
          relation: item.cardType,
          source_proposal_id: item.sourceProposalId,
        })),
      documents: documents
        .filter((item) => !payload.document_id || item.id === payload.document_id)
        .map((item) => ({
          type: 'document',
          id: item.id,
          title: item.title,
          relation: item.documentType,
          target_document_id: item.id,
        })),
    }
  }

  @Get(':id/proposals')
  async listProposals(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const writingId = parseId(id, 'writing id')
    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) return { error: 'writing_not_found' }

    const rows = await this.databaseService.db
      .select()
      .from(writingProposals)
      .where(and(eq(writingProposals.writingId, writingId), eq(writingProposals.userId, currentUser.id)))
      .orderBy(desc(writingProposals.createdAt))

    return rows.map((row) => ({
      id: row.id,
      writing_id: row.writingId,
      source_run_id: row.sourceRunId,
      proposal_kind: row.proposalKind,
      target_kind: row.targetKind,
      target_document_id: row.targetDocumentId,
      title: row.title,
      content: row.content,
      structured: row.structuredJson ? JSON.parse(row.structuredJson) : null,
      references: row.referencesJson ? JSON.parse(row.referencesJson) : [],
      status: row.status,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
      applied_at: row.appliedAt,
      rejected_at: row.rejectedAt,
    }))
  }

  @Post(':id/proposals')
  async createProposal(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = createProposalSchema.parse(body)
    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) return { error: 'writing_not_found' }

    const nowTs = now()
    const [inserted] = await this.databaseService.db.insert(writingProposals).values({
      writingId,
      userId: currentUser.id,
      sourceRunId: payload.source_run_id ?? null,
      proposalKind: payload.proposal_kind,
      targetKind: payload.target_kind,
      targetDocumentId: payload.target_document_id ?? null,
      title: payload.title,
      content: payload.content,
      structuredJson: payload.structured ? JSON.stringify(payload.structured) : null,
      referencesJson: JSON.stringify(payload.references || []),
      status: 'pending',
      createdAt: nowTs,
      updatedAt: nowTs,
    }).returning()

    return {
      id: inserted.id,
      writing_id: inserted.writingId,
      source_run_id: inserted.sourceRunId,
      proposal_kind: inserted.proposalKind,
      target_kind: inserted.targetKind,
      target_document_id: inserted.targetDocumentId,
      title: inserted.title,
      content: inserted.content,
      structured: inserted.structuredJson ? JSON.parse(inserted.structuredJson) : null,
      references: inserted.referencesJson ? JSON.parse(inserted.referencesJson) : [],
      status: inserted.status,
      created_at: inserted.createdAt,
      updated_at: inserted.updatedAt,
      applied_at: inserted.appliedAt,
      rejected_at: inserted.rejectedAt,
    }
  }

  @Post(':id/proposals/:proposalId/reject')
  async rejectProposal(
    @Param('id') id: string,
    @Param('proposalId') proposalIdParam: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const proposalId = parseId(proposalIdParam, 'proposal id')
    const [proposal] = await this.databaseService.db
      .select()
      .from(writingProposals)
      .where(and(eq(writingProposals.id, proposalId), eq(writingProposals.writingId, writingId), eq(writingProposals.userId, currentUser.id)))

    if (!proposal) return { error: 'proposal_not_found' }
    if (proposal.status !== 'pending') return { error: 'proposal_not_pending' }

    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) return { error: 'writing_not_found' }

    const ts = now()
    await this.databaseService.db.update(writingProposals).set({ status: 'rejected', rejectedAt: ts, updatedAt: ts }).where(eq(writingProposals.id, proposalId))
    return { updated: true, status: 'rejected' }
  }

  @Post(':id/proposals/:proposalId/apply')
  async applyProposal(
    @Param('id') id: string,
    @Param('proposalId') proposalIdParam: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const proposalId = parseId(proposalIdParam, 'proposal id')
    const [proposal] = await this.databaseService.db
      .select()
      .from(writingProposals)
      .where(and(eq(writingProposals.id, proposalId), eq(writingProposals.writingId, writingId), eq(writingProposals.userId, currentUser.id)))

    if (!proposal) return { error: 'proposal_not_found' }
    return this.applyProposalRecord(writingId, proposal, currentUser)
  }

  @Post(':id/proposals/batch-apply')
  async applyBatchProposals(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = batchApplySchema.parse(body)
    const planPayload = { proposal_ids: payload.proposal_ids }
    const plan = await this.getBatchPlan(id, planPayload, currentUser)
    if ('error' in plan) return plan
    if (!payload.allow_conflicts && !plan.can_apply) {
      return { applied: 0, stopped_at: null, results: [], blocked_by_conflict: true }
    }

    const results: Array<{ proposal_id: number; title: string; status: 'applied' | 'skipped' | 'failed'; error?: string }> = []
    let stoppedAt: number | null = null

    for (const proposalId of plan.recommended_proposal_ids) {
      const [proposal] = await this.databaseService.db
        .select()
        .from(writingProposals)
        .where(and(eq(writingProposals.id, proposalId), eq(writingProposals.writingId, writingId), eq(writingProposals.userId, currentUser.id)))

      if (!proposal) {
        results.push({ proposal_id: proposalId, title: `proposal-${proposalId}`, status: 'failed', error: 'proposal_not_found' })
        stoppedAt = proposalId
        if (payload.stop_on_error) break
        continue
      }

      const applied = await this.applyProposalRecord(writingId, proposal, currentUser)
      if ('error' in applied) {
        results.push({ proposal_id: proposal.id, title: proposal.title, status: 'failed', error: applied.error })
        stoppedAt = proposal.id
        if (payload.stop_on_error) break
        continue
      }

      results.push({ proposal_id: proposal.id, title: proposal.title, status: 'applied' })
    }

    if (stoppedAt != null && payload.stop_on_error) {
      for (const proposalId of payload.proposal_ids.slice(results.length)) {
        results.push({ proposal_id: proposalId, title: `proposal-${proposalId}`, status: 'skipped', error: 'stopped_after_error' })
      }
    }

    const rollbackItems: Array<Record<string, unknown>> = []
    for (const item of results) {
      if (item.status !== 'applied') continue
      const [proposal] = await this.databaseService.db
        .select()
        .from(writingProposals)
        .where(and(eq(writingProposals.id, item.proposal_id), eq(writingProposals.writingId, writingId), eq(writingProposals.userId, currentUser.id)))
      if (!proposal) continue
      if (proposal.targetKind === 'brief' || proposal.targetKind === 'outline' || proposal.targetKind === 'summary') {
        const [history] = await this.databaseService.db
          .select()
          .from(writingObjectHistories)
          .where(and(eq(writingObjectHistories.writingId, writingId), eq(writingObjectHistories.userId, currentUser.id), eq(writingObjectHistories.sourceProposalId, proposal.id)))
          .orderBy(desc(writingObjectHistories.id))
        if (history) rollbackItems.push({ kind: 'object_history_restore', history_id: history.id, proposal_id: proposal.id })
      } else if (proposal.targetKind === 'knowledge') {
        const [card] = await this.databaseService.db
          .select()
          .from(writingKnowledgeCards)
          .where(and(eq(writingKnowledgeCards.writingId, writingId), eq(writingKnowledgeCards.userId, currentUser.id), eq(writingKnowledgeCards.proposalId, proposal.id), isNull(writingKnowledgeCards.deletedAt)))
          .orderBy(desc(writingKnowledgeCards.id))
        if (card) rollbackItems.push({ kind: 'knowledge_delete', knowledge_card_id: card.id, proposal_id: proposal.id })
      } else {
        const [document] = await this.databaseService.db
          .select()
          .from(writingDocuments)
          .where(and(eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), eq(writingDocuments.title, proposal.title), isNull(writingDocuments.deletedAt)))
          .orderBy(desc(writingDocuments.id))
        if (document) rollbackItems.push({ kind: 'document_delete', document_id: document.id, proposal_id: proposal.id })
      }
    }

    const [execution] = await this.databaseService.db.insert(writingBatchExecutions).values({
      writingId,
      userId: currentUser.id,
      proposalIdsJson: JSON.stringify(payload.proposal_ids),
      recommendedProposalIdsJson: JSON.stringify(plan.recommended_proposal_ids),
      resultsJson: JSON.stringify(results),
      rollbackJson: JSON.stringify(rollbackItems),
      appliedCount: results.filter((item) => item.status === 'applied').length,
      stoppedAtProposalId: stoppedAt,
      blockedByConflict: false,
      note: payload.note ?? null,
      tag: payload.tag ?? null,
      createdAt: now(),
    }).returning()

    return {
      applied: results.filter((item) => item.status === 'applied').length,
      stopped_at: stoppedAt,
      results,
      blocked_by_conflict: false,
      execution_id: execution?.id ?? null,
    }
  }



  @Get(':id/batch-executions/detail')
  async getBatchExecutionDetail(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = batchExecutionDetailQuerySchema.parse(query)
    const [row] = await this.databaseService.db
      .select()
      .from(writingBatchExecutions)
      .where(and(eq(writingBatchExecutions.id, payload.execution_id), eq(writingBatchExecutions.writingId, writingId), eq(writingBatchExecutions.userId, currentUser.id)))

    if (!row) return { error: 'batch_execution_not_found' }

    const results = safeJsonParse<Array<Record<string, unknown>>>(row.resultsJson, [])
    const rollbackItems = safeJsonParse<Array<Record<string, unknown>>>(row.rollbackJson, [])
    const proposalIds = safeJsonParse<number[]>(row.proposalIdsJson, [])
    const diffPreview: Array<{ proposal_id: number; title: string; diff_lines: Array<{ type: 'same' | 'added' | 'removed'; text: string }> }> = []

    for (const proposalId of proposalIds) {
      const [proposal] = await this.databaseService.db
        .select()
        .from(writingProposals)
        .where(and(eq(writingProposals.id, proposalId), eq(writingProposals.writingId, writingId), eq(writingProposals.userId, currentUser.id)))
      if (!proposal) continue
      if (proposal.targetKind === 'brief') {
        const [history] = await this.databaseService.db.select().from(writingObjectHistories).where(and(eq(writingObjectHistories.writingId, writingId), eq(writingObjectHistories.userId, currentUser.id), eq(writingObjectHistories.sourceProposalId, proposal.id))).orderBy(desc(writingObjectHistories.id))
        if (history) diffPreview.push({ proposal_id: proposal.id, title: proposal.title, diff_lines: buildLineDiff(history.content, proposal.content).slice(0, 16) })
        continue
      }
      if (proposal.targetKind === 'outline') {
        const [history] = await this.databaseService.db.select().from(writingObjectHistories).where(and(eq(writingObjectHistories.writingId, writingId), eq(writingObjectHistories.userId, currentUser.id), eq(writingObjectHistories.sourceProposalId, proposal.id))).orderBy(desc(writingObjectHistories.id))
        if (history) diffPreview.push({ proposal_id: proposal.id, title: proposal.title, diff_lines: buildLineDiff(history.content, proposal.content).slice(0, 16) })
        continue
      }
      if (proposal.targetKind === 'summary' && proposal.targetDocumentId) {
        const [history] = await this.databaseService.db.select().from(writingObjectHistories).where(and(eq(writingObjectHistories.writingId, writingId), eq(writingObjectHistories.userId, currentUser.id), eq(writingObjectHistories.sourceProposalId, proposal.id))).orderBy(desc(writingObjectHistories.id))
        if (history) diffPreview.push({ proposal_id: proposal.id, title: proposal.title, diff_lines: buildLineDiff(history.content, proposal.content).slice(0, 16) })
      }
    }

    return {
      id: row.id,
      writing_id: row.writingId,
      proposal_ids: proposalIds,
      recommended_proposal_ids: safeJsonParse<number[]>(row.recommendedProposalIdsJson, []),
      results,
      rollback_items: rollbackItems,
      diff_preview: diffPreview,
      applied_count: row.appliedCount,
      stopped_at_proposal_id: row.stoppedAtProposalId,
      blocked_by_conflict: row.blockedByConflict,
      note: row.note ?? null,
      tag: row.tag ?? null,
      created_at: row.createdAt?.toISOString?.() ?? String(row.createdAt),
    }
  }

  @Get(':id/batch-executions/rollback-preview')
  async getBatchRollbackPreview(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = batchExecutionDetailQuerySchema.parse(query)
    const [row] = await this.databaseService.db
      .select()
      .from(writingBatchExecutions)
      .where(and(eq(writingBatchExecutions.id, payload.execution_id), eq(writingBatchExecutions.writingId, writingId), eq(writingBatchExecutions.userId, currentUser.id)))

    if (!row) return { error: 'batch_execution_not_found' }

    const rollbackItems = safeJsonParse<Array<Record<string, unknown>>>(row.rollbackJson, [])
    return {
      execution_id: row.id,
      items: rollbackItems.map((item) => ({
        kind: String(item.kind || 'unknown'),
        label: String(item.kind || 'unknown'),
        target_id: Number(item.history_id || item.knowledge_card_id || item.document_id || 0) || null,
        proposal_id: Number(item.proposal_id || 0) || null,
      })),
    }
  }

  @Get(':id/batch-executions')
  async listBatchExecutions(@Param('id') id: string, @Query() query: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const writingId = parseId(id, 'writing id')
    const payload = listBatchExecutionsQuerySchema.parse(query)
    const rows = await this.databaseService.db
      .select()
      .from(writingBatchExecutions)
      .where(and(eq(writingBatchExecutions.writingId, writingId), eq(writingBatchExecutions.userId, currentUser.id)))
      .orderBy(desc(writingBatchExecutions.createdAt))

    const filtered = rows.filter((row) => {
      const note = row.note || ''
      const tag = row.tag || ''
      const matchQuery = !payload.q || note.includes(payload.q) || tag.includes(payload.q)
      const matchTag = !payload.tag || tag === payload.tag
      const matchStatus = payload.status === 'all' || (payload.status === 'blocked' ? row.blockedByConflict : row.appliedCount > 0)
      return matchQuery && matchTag && matchStatus
    })

    const start = (payload.page - 1) * payload.page_size
    const paged = filtered.slice(start, start + payload.page_size)

    return {
      items: paged.map((row) => ({
      id: row.id,
      writing_id: row.writingId,
      proposal_ids: safeJsonParse<number[]>(row.proposalIdsJson, []),
      recommended_proposal_ids: safeJsonParse<number[]>(row.recommendedProposalIdsJson, []),
      results: safeJsonParse<Array<Record<string, unknown>>>(row.resultsJson, []),
      applied_count: row.appliedCount,
      stopped_at_proposal_id: row.stoppedAtProposalId,
      blocked_by_conflict: row.blockedByConflict,
      note: row.note ?? null,
      tag: row.tag ?? null,
      created_at: row.createdAt?.toISOString?.() ?? String(row.createdAt),
    })),
      pagination: { page: payload.page, page_size: payload.page_size, total: filtered.length },
    }
  }


  @Patch(':id/batch-executions')
  async patchBatchExecution(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = patchBatchExecutionSchema.parse(body)

    const [row] = await this.databaseService.db
      .select()
      .from(writingBatchExecutions)
      .where(and(eq(writingBatchExecutions.id, payload.execution_id), eq(writingBatchExecutions.writingId, writingId), eq(writingBatchExecutions.userId, currentUser.id)))

    if (!row) return { error: 'batch_execution_not_found' }

    const patch: Record<string, unknown> = {}
    if (payload.is_pinned !== undefined) patch.isPinned = payload.is_pinned
    if (payload.is_important !== undefined) patch.isImportant = payload.is_important

    const [updated] = await this.databaseService.db
      .update(writingBatchExecutions)
      .set(patch)
      .where(eq(writingBatchExecutions.id, row.id))
      .returning()

    return {
      id: updated.id,
      writing_id: updated.writingId,
      proposal_ids: safeJsonParse<number[]>(updated.proposalIdsJson, []),
      recommended_proposal_ids: safeJsonParse<number[]>(updated.recommendedProposalIdsJson, []),
      results: safeJsonParse<Array<Record<string, unknown>>>(updated.resultsJson, []),
      applied_count: updated.appliedCount,
      stopped_at_proposal_id: updated.stoppedAtProposalId,
      blocked_by_conflict: updated.blockedByConflict,
      is_pinned: updated.isPinned,
      is_important: updated.isImportant,
      note: updated.note,
      tag: updated.tag,
      created_at: updated.createdAt.toISOString(),
    }
  }
  @Post(':id/batch-executions/rollback')
  async rollbackBatchExecutionRoute(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = rollbackBatchSchema.parse(body)
    return this.rollbackBatchExecution(writingId, payload.execution_id, currentUser)
  }

  @Get(':id/knowledge-cards')
  async listKnowledgeCards(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const writingId = parseId(id, 'writing id')
    const rows = await this.databaseService.db
      .select({
        id: writingKnowledgeCards.id,
        writingId: writingKnowledgeCards.writingId,
        proposalId: writingKnowledgeCards.proposalId,
        cardType: writingKnowledgeCards.cardType,
        title: writingKnowledgeCards.title,
        content: writingKnowledgeCards.content,
        evidenceJson: writingKnowledgeCards.evidenceJson,
        createdAt: writingKnowledgeCards.createdAt,
        updatedAt: writingKnowledgeCards.updatedAt,
        sourceRunId: writingProposals.sourceRunId,
        sourceProposalTitle: writingProposals.title,
        sourceProposalKind: writingProposals.proposalKind,
      })
      .from(writingKnowledgeCards)
      .leftJoin(writingProposals, eq(writingKnowledgeCards.proposalId, writingProposals.id))
      .where(and(eq(writingKnowledgeCards.writingId, writingId), eq(writingKnowledgeCards.userId, currentUser.id), isNull(writingKnowledgeCards.deletedAt)))
      .orderBy(desc(writingKnowledgeCards.createdAt))

    return rows.map((row) => ({
      id: row.id,
      writing_id: row.writingId,
      proposal_id: row.proposalId,
      source_run_id: row.sourceRunId,
      source_proposal_title: row.sourceProposalTitle,
      source_proposal_kind: row.sourceProposalKind,
      card_type: row.cardType,
      title: row.title,
      content: row.content,
      evidence: row.evidenceJson ? JSON.parse(row.evidenceJson) : [],
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    }))
  }

  @Post(':id/knowledge-cards')
  async createKnowledgeCard(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = createKnowledgeCardSchema.parse(body)
    const ts = now()
    const [inserted] = await this.databaseService.db.insert(writingKnowledgeCards).values({
      writingId,
      userId: currentUser.id,
      proposalId: payload.proposal_id ?? null,
      cardType: payload.card_type,
      title: payload.title,
      content: payload.content,
      evidenceJson: JSON.stringify(payload.evidence || []),
      createdAt: ts,
      updatedAt: ts,
    }).returning()

    return {
      id: inserted.id,
      writing_id: inserted.writingId,
      proposal_id: inserted.proposalId,
      source_run_id: null,
      source_proposal_title: null,
      source_proposal_kind: null,
      card_type: inserted.cardType,
      title: inserted.title,
      content: inserted.content,
      evidence: inserted.evidenceJson ? JSON.parse(inserted.evidenceJson) : [],
      created_at: inserted.createdAt,
      updated_at: inserted.updatedAt,
    }
  }

  @Patch(':id/knowledge-cards/:cardId')
  async patchKnowledgeCard(
    @Param('id') id: string,
    @Param('cardId') cardIdParam: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const cardId = parseId(cardIdParam, 'card id')
    const payload = patchKnowledgeCardSchema.parse(body)
    const [card] = await this.databaseService.db
      .select()
      .from(writingKnowledgeCards)
      .where(and(eq(writingKnowledgeCards.id, cardId), eq(writingKnowledgeCards.writingId, writingId), eq(writingKnowledgeCards.userId, currentUser.id), isNull(writingKnowledgeCards.deletedAt)))

    if (!card) return { error: 'knowledge_card_not_found' }

    await createKnowledgeCardHistory({
      databaseService: this.databaseService,
      writingId,
      knowledgeCardId: card.id,
      userId: currentUser.id,
      cardType: card.cardType,
      title: card.title,
      content: card.content,
      evidenceJson: card.evidenceJson,
      sourceProposalId: card.proposalId,
      sourceRunId: null,
    })

    const updates: Partial<typeof writingKnowledgeCards.$inferInsert> = { updatedAt: now() }
    if (payload.card_type !== undefined) updates.cardType = payload.card_type
    if (payload.title !== undefined) updates.title = payload.title
    if (payload.content !== undefined) updates.content = payload.content
    if (payload.evidence !== undefined) updates.evidenceJson = JSON.stringify(payload.evidence)

    await this.databaseService.db.update(writingKnowledgeCards).set(updates).where(eq(writingKnowledgeCards.id, cardId))
    return { updated: true }
  }

  @Post(':id/knowledge-cards/:cardId/delete')
  async deleteKnowledgeCard(
    @Param('id') id: string,
    @Param('cardId') cardIdParam: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const cardId = parseId(cardIdParam, 'card id')
    const [card] = await this.databaseService.db
      .select()
      .from(writingKnowledgeCards)
      .where(and(eq(writingKnowledgeCards.id, cardId), eq(writingKnowledgeCards.writingId, writingId), eq(writingKnowledgeCards.userId, currentUser.id), isNull(writingKnowledgeCards.deletedAt)))

    if (!card) return { error: 'knowledge_card_not_found' }

    await createKnowledgeCardHistory({
      databaseService: this.databaseService,
      writingId,
      knowledgeCardId: card.id,
      userId: currentUser.id,
      cardType: card.cardType,
      title: card.title,
      content: card.content,
      evidenceJson: card.evidenceJson,
      sourceProposalId: card.proposalId,
      sourceRunId: null,
    })

    await this.databaseService.db.update(writingKnowledgeCards).set({ deletedAt: now(), updatedAt: now() }).where(eq(writingKnowledgeCards.id, cardId))
    return { deleted: true }
  }

  @Get(':id/knowledge-cards/history')
  async listKnowledgeCardHistories(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = listKnowledgeHistoryQuerySchema.parse(query)
    const rows = await this.databaseService.db
      .select()
      .from(writingKnowledgeCardHistories)
      .where(and(eq(writingKnowledgeCardHistories.writingId, writingId), eq(writingKnowledgeCardHistories.knowledgeCardId, payload.card_id), eq(writingKnowledgeCardHistories.userId, currentUser.id)))
      .orderBy(desc(writingKnowledgeCardHistories.createdAt))

    return rows.map((row) => ({
      id: row.id,
      writing_id: row.writingId,
      knowledge_card_id: row.knowledgeCardId,
      card_type: row.cardType,
      title: row.title,
      content: row.content,
      evidence: row.evidenceJson ? JSON.parse(row.evidenceJson) : [],
      source_proposal_id: row.sourceProposalId,
      source_run_id: row.sourceRunId,
      created_at: row.createdAt,
    }))
  }

  @Post(':id/knowledge-cards/history/restore')
  async restoreKnowledgeCardHistory(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = restoreKnowledgeHistorySchema.parse(body)
    const [history] = await this.databaseService.db
      .select()
      .from(writingKnowledgeCardHistories)
      .where(and(eq(writingKnowledgeCardHistories.id, payload.history_id), eq(writingKnowledgeCardHistories.writingId, writingId), eq(writingKnowledgeCardHistories.userId, currentUser.id)))

    if (!history) return { error: 'knowledge_card_history_not_found' }

    const [card] = await this.databaseService.db
      .select()
      .from(writingKnowledgeCards)
      .where(and(eq(writingKnowledgeCards.id, history.knowledgeCardId), eq(writingKnowledgeCards.writingId, writingId), eq(writingKnowledgeCards.userId, currentUser.id), isNull(writingKnowledgeCards.deletedAt)))

    if (!card) return { error: 'knowledge_card_not_found' }

    await createKnowledgeCardHistory({
      databaseService: this.databaseService,
      writingId,
      knowledgeCardId: card.id,
      userId: currentUser.id,
      cardType: card.cardType,
      title: card.title,
      content: card.content,
      evidenceJson: card.evidenceJson,
      sourceProposalId: card.proposalId,
      sourceRunId: null,
    })

    await this.databaseService.db.update(writingKnowledgeCards).set({
      cardType: history.cardType,
      title: history.title,
      content: history.content,
      evidenceJson: history.evidenceJson,
      updatedAt: now(),
    }).where(eq(writingKnowledgeCards.id, card.id))

    return { restored: true, knowledge_card_id: card.id }
  }

  @Get(':id/object-histories')
  async listObjectHistories(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = listHistoryQuerySchema.parse(query)
    const rows = await this.databaseService.db
      .select()
      .from(writingObjectHistories)
      .where(and(
        eq(writingObjectHistories.writingId, writingId),
        eq(writingObjectHistories.userId, currentUser.id),
        eq(writingObjectHistories.objectKind, payload.object_kind),
        payload.document_id ? eq(writingObjectHistories.documentId, payload.document_id) : isNull(writingObjectHistories.documentId),
      ))
      .orderBy(desc(writingObjectHistories.createdAt))

    return rows.map((row) => ({
      id: row.id,
      writing_id: row.writingId,
      object_kind: row.objectKind,
      document_id: row.documentId,
      snapshot_title: row.snapshotTitle,
      content: row.content,
      source_proposal_id: row.sourceProposalId,
      source_run_id: row.sourceRunId,
      created_at: row.createdAt,
    }))
  }

  @Get(':id/object-histories/preview')
  async previewObjectHistory(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = previewHistoryQuerySchema.parse(query)
    const [history] = await this.databaseService.db
      .select()
      .from(writingObjectHistories)
      .where(and(eq(writingObjectHistories.id, payload.history_id), eq(writingObjectHistories.writingId, writingId), eq(writingObjectHistories.userId, currentUser.id)))

    if (!history) return { error: 'history_not_found' }

    let currentContent = ''
    if (history.objectKind === 'brief') {
      const [writing] = await this.databaseService.db.select().from(writings).where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))
      currentContent = writing?.briefJson || ''
    } else if (history.objectKind === 'outline') {
      const [writing] = await this.databaseService.db.select().from(writings).where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))
      currentContent = writing?.outlineJson || ''
    } else if (history.objectKind === 'summary' && history.documentId) {
      const [document] = await this.databaseService.db.select().from(writingDocuments).where(and(eq(writingDocuments.id, history.documentId), eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))
      currentContent = document?.summary || ''
    }

    return {
      history_id: history.id,
      object_kind: history.objectKind,
      snapshot_title: history.snapshotTitle,
      history_content: history.content,
      current_content: currentContent,
      diff_lines: buildLineDiff(history.content, currentContent),
    }
  }

  @Post(':id/object-histories/restore')
  async restoreObjectHistory(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = restoreHistorySchema.parse(body)
    const [history] = await this.databaseService.db
      .select()
      .from(writingObjectHistories)
      .where(and(eq(writingObjectHistories.id, payload.history_id), eq(writingObjectHistories.writingId, writingId), eq(writingObjectHistories.userId, currentUser.id)))

    if (!history) return { error: 'history_not_found' }

    const ts = now()
    if (history.objectKind === 'brief') {
      await this.databaseService.db.update(writings).set({ briefJson: history.content, updatedAt: ts }).where(eq(writings.id, writingId))
    } else if (history.objectKind === 'outline') {
      await this.databaseService.db.update(writings).set({ outlineJson: history.content, updatedAt: ts }).where(eq(writings.id, writingId))
    } else if (history.objectKind === 'summary' && history.documentId) {
      await this.databaseService.db.update(writingDocuments).set({ summary: history.content, updatedAt: ts }).where(eq(writingDocuments.id, history.documentId))
      await this.databaseService.db.update(writings).set({ updatedAt: ts, currentDocumentId: history.documentId }).where(eq(writings.id, writingId))
    }

    return { restored: true, object_kind: history.objectKind, document_id: history.documentId }
  }

  @Patch(':id')
  async patchWriting(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const payload = patchWritingSchema.parse(body)
    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) {
      return { error: 'writing_not_found' }
    }

    if (payload.current_document_id != null) {
      const [document] = await this.databaseService.db
        .select()
        .from(writingDocuments)
        .where(and(eq(writingDocuments.id, payload.current_document_id), eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))
      if (!document) {
        return { error: 'invalid_current_document_id' }
      }
    }

    const updates: Partial<typeof writings.$inferInsert> = { updatedAt: now() }
    if (payload.title !== undefined) updates.title = payload.title.trim() || writing.title
    if (payload.kind !== undefined) updates.kind = payload.kind
    if (payload.status !== undefined) updates.status = payload.status
    if (payload.synopsis !== undefined) updates.synopsis = payload.synopsis?.trim() || null
    if (payload.outline_json !== undefined) {
      await createObjectHistory({ databaseService: this.databaseService, writingId, userId: currentUser.id, objectKind: 'outline', content: writing.outlineJson, snapshotTitle: '????' })
      updates.outlineJson = payload.outline_json
    }
    if (payload.brief_json !== undefined) {
      await createObjectHistory({ databaseService: this.databaseService, writingId, userId: currentUser.id, objectKind: 'brief', content: writing.briefJson, snapshotTitle: '????' })
      updates.briefJson = payload.brief_json
    }
    if (payload.current_document_id !== undefined) updates.currentDocumentId = payload.current_document_id

    await this.databaseService.db
      .update(writings)
      .set(updates)
      .where(eq(writings.id, writingId))

    return { updated: true }
  }

  @Patch(':id/documents/:documentId')
  async patchDocument(
    @Param('id') id: string,
    @Param('documentId') documentIdParam: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const writingId = parseId(id, 'writing id')
    const documentId = parseId(documentIdParam, 'document id')
    const payload = patchDocumentSchema.parse(body)
    const [document] = await this.databaseService.db
      .select()
      .from(writingDocuments)
      .where(and(eq(writingDocuments.id, documentId), eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))

    if (!document) {
      return { error: 'document_not_found' }
    }

    const ts = now()
    const updates: Partial<typeof writingDocuments.$inferInsert> = { updatedAt: ts }
    if (payload.title !== undefined) updates.title = payload.title.trim() || document.title
    if (payload.content_md !== undefined) {
      updates.contentMd = payload.content_md
      updates.wordCount = countWordsMd(payload.content_md)
    }
    if (payload.sort_order !== undefined) updates.sortOrder = payload.sort_order
    if (payload.summary !== undefined) {
      await createObjectHistory({ databaseService: this.databaseService, writingId, userId: currentUser.id, objectKind: 'summary', content: document.summary, documentId: documentId, snapshotTitle: document.title })
      updates.summary = payload.summary?.trim() || null
    }

    await this.databaseService.db
      .update(writingDocuments)
      .set(updates)
      .where(eq(writingDocuments.id, documentId))

    await this.databaseService.db
      .update(writings)
      .set({ updatedAt: ts })
      .where(eq(writings.id, writingId))

    return { updated: true }
  }
}
