import { BadRequestException, Injectable } from '@nestjs/common'
import type { FastifyReply } from 'fastify'
import type { AiRuntimeActionItem, AiRuntimeApplyResultPayload, AiRuntimeReferenceItem, JsonObjectPayload } from '@xiaochuang/contracts'
import { and, asc, desc, eq, isNull, lt } from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'

import { DatabaseService } from '../../db/database.service'
import { aiRuns, writingDocuments, writingKnowledgeCards, writingObjectHistories, writingProposals, writings } from '../../db/schema'
import { getTextConfig, getTextProviderBaseUrl } from '../agents/agents.ai'
import { GridService } from '../grid/grid.service'
import { extractorHandler } from './skill-handlers/extractor.handler'
import { gridPromptHandler } from './skill-handlers/grid-prompt.handler'
import { quickVideoSessionTitleHandler } from './skill-handlers/quick-video-session-title.handler'
import { scriptRewriterHandler } from './skill-handlers/script-rewriter.handler'
import { storyboardBreakerHandler } from './skill-handlers/storyboard-breaker.handler'
import { storyboardFromTextHandler } from './skill-handlers/storyboard-from-text.handler'
import { sendSseReply } from './skill-handlers/_shared'
import { voiceAssignerHandler } from './skill-handlers/voice-assigner.handler'
import type { SkillHandler } from './skill-handlers/types'

function extractStreamingText(payload: any) {
  const choice = payload?.choices?.[0]
  const content = choice?.delta?.content ?? choice?.text
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (typeof part?.text === 'string') return part.text
      if (typeof part?.content === 'string') return part.content
      return ''
    }).join('')
  }
  return ''
}



function extractStreamingActions(payload: any): AiRuntimeActionItem[] {
  const actions = payload?.choices?.[0]?.delta?.actions ?? payload?.choices?.[0]?.message?.actions ?? payload?.actions
  return Array.isArray(actions) ? actions : []
}

function parseSseDataBlock(block: string) {
  const dataLines = block
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
  if (!dataLines.length) return null
  const data = dataLines.join('\n').trim()
  if (!data || data === '[DONE]') return null
  return JSON.parse(data)
}

function safeJsonParse<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseStructuredAssistantPayload(text: string) {
  const raw = String(text || '').trim()
  if (!raw) return null

  const normalized = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(normalized) as {
      answer?: unknown
      actions?: unknown
      references?: unknown
    }
    return {
      answer: typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : raw,
      actions: Array.isArray(parsed.actions) ? parsed.actions as AiRuntimeActionItem[] : [],
      references: Array.isArray(parsed.references) ? parsed.references as AiRuntimeReferenceItem[] : [],
    }
  } catch {
    return null
  }
}


function resolveRunTargetId(payload: any) {
  if (payload?.target?.type === 'writing') return Number(payload.target?.writing_id || 0)
  return Number(payload?.target?.document_id || payload?.target?.writing_id || 0)
}

const KNOWLEDGE_CARD_TYPES = new Set(['character', 'setting', 'worldview', 'term', 'plotline', 'foreshadowing'])

function normalizeKnowledgeCardType(value: unknown) {
  const cardType = String(value || '').trim()
  return KNOWLEDGE_CARD_TYPES.has(cardType) ? cardType : 'setting'
}

function getKnowledgeCardTypePriority(mode: string) {
  if (mode === 'chapter_write' || mode === 'polish') return ['character', 'setting', 'plotline', 'foreshadowing', 'worldview', 'term']
  if (mode === 'outline') return ['plotline', 'foreshadowing', 'character', 'setting', 'worldview', 'term']
  if (mode === 'consistency_check') return ['character', 'setting', 'worldview', 'term', 'plotline', 'foreshadowing']
  if (mode === 'knowledge_update') return ['character', 'setting', 'worldview', 'term', 'plotline', 'foreshadowing']
  if (mode === 'adaptation_prep') return ['character', 'setting', 'plotline', 'worldview', 'foreshadowing', 'term']
  return ['character', 'setting', 'plotline', 'worldview', 'term', 'foreshadowing']
}

function getContextBudget(mode: string) {
  if (mode === 'summarize') return { currentDocument: 9000, outline: 2500, brief: 800, selection: 1200, neighborDigest: 220, neighborCount: 2, knowledgeCount: 5, knowledgeDigest: 180, proposalCount: 3 }
  if (mode === 'outline' || mode === 'briefing') return { currentDocument: 4500, outline: 5000, brief: 2000, selection: 1600, neighborDigest: 320, neighborCount: 5, knowledgeCount: 8, knowledgeDigest: 260, proposalCount: 4 }
  if (mode === 'consistency_check') return { currentDocument: 5000, outline: 4500, brief: 1600, selection: 1800, neighborDigest: 420, neighborCount: 6, knowledgeCount: 10, knowledgeDigest: 300, proposalCount: 5 }
  return { currentDocument: 6000, outline: 4000, brief: 1200, selection: 2000, neighborDigest: 360, neighborCount: 4, knowledgeCount: 8, knowledgeDigest: 240, proposalCount: 3 }
}

function compactText(value: unknown, maxLength: number) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength)}…`
}

const BRIEF_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['worldview', '世界观'],
  ['background', '背景'],
  ['main_plot', '主线'],
  ['core_conflict', '核心冲突'],
  ['main_characters', '主要角色'],
]

// 创作准备以 `{worldview, background, main_plot, core_conflict, main_characters}`
// 的 JSON 字符串落库。喂给模型时拆成带标签的可读字段，避免直接丢原始 JSON，
// 同时让大纲等模式能直接引用世界观/背景/主线/核心冲突/主要角色。
function formatBriefForPrompt(briefJson: unknown, maxLength: number): string {
  if (!briefJson) return ''
  let brief: Record<string, unknown> | null = null
  if (typeof briefJson === 'string') {
    try {
      brief = JSON.parse(briefJson) as Record<string, unknown>
    } catch {
      return compactText(briefJson, maxLength)
    }
  } else if (typeof briefJson === 'object') {
    brief = briefJson as Record<string, unknown>
  }
  if (!brief) return ''
  const parts = BRIEF_FIELD_LABELS
    .map(([key, label]) => {
      const value = typeof brief?.[key] === 'string' ? (brief[key] as string).trim() : ''
      return value ? `- ${label}：${compactText(value, maxLength)}` : ''
    })
    .filter(Boolean)
  return parts.join('\n')
}

function rankKnowledgeCards<T extends { cardType: string; updatedAt?: Date | null }>(cards: T[], mode: string) {
  const priority = getKnowledgeCardTypePriority(mode)
  return [...cards].sort((left, right) => {
    const leftRank = priority.indexOf(left.cardType)
    const rightRank = priority.indexOf(right.cardType)
    const normalizedLeftRank = leftRank >= 0 ? leftRank : priority.length
    const normalizedRightRank = rightRank >= 0 ? rightRank : priority.length
    if (normalizedLeftRank !== normalizedRightRank) return normalizedLeftRank - normalizedRightRank
    return (right.updatedAt?.getTime() || 0) - (left.updatedAt?.getTime() || 0)
  })
}

function readNumericActionField(action: AiRuntimeActionItem, ...keys: string[]) {
  for (const key of keys) {
    const value = action[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function readStringActionField(action: AiRuntimeActionItem, structured: JsonObjectPayload | null, keys: string[], fallback: string) {
  for (const key of keys) {
    const value = action[key] ?? structured?.[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return fallback
}

function buildKnowledgeEvidence(action: AiRuntimeActionItem, structured: JsonObjectPayload | null, runReferencesJson: string | null) {
  if (Array.isArray(action.evidence)) return action.evidence
  if (Array.isArray(structured?.evidence)) return structured.evidence

  const documentId = readNumericActionField(action, 'document_id', 'target_document_id')
  if (documentId) {
    return [{ kind: 'document', title: 'Current document', reason: 'AI referenced document', document_id: documentId }]
  }

  return safeJsonParse<AiRuntimeReferenceItem[]>(runReferencesJson, [])
}

function markActionApplied(actions: AiRuntimeActionItem[], actionIndex: number, result: AiRuntimeApplyResultPayload, appliedAt: Date) {
  return actions.map((item, index) => index === actionIndex
    ? { ...item, applied: true, applied_at: appliedAt.toISOString(), apply_result: result }
    : item)
}

function resolveSkillsDir() {
  const candidates = [
    path.resolve(process.cwd(), 'skills'),
    path.resolve(process.cwd(), '../skills'),
    path.resolve(process.cwd(), '../../skills'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[candidates.length - 1]
}

function loadSkillPrompt(skillId: string) {
  const skillsDir = resolveSkillsDir()
  const candidates = [
    path.join(skillsDir, skillId, 'SKILL.md'),
    path.join(skillsDir, skillId.replace(/_/g, '-'), 'SKILL.md'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.readFileSync(candidate, 'utf8')
  }
  throw new BadRequestException(`Skill not found: ${skillId}`)
}

// Skill registry — maps skill_id to its handler. Handlers own context loading
// and side effects; AiService only orchestrates SKILL.md loading and dispatch.
// Unmatched skill_ids fall through to the writing-domain default path below,
// which is appropriate for writing_copilot and any future writing-only skill.
const SKILL_HANDLERS: ReadonlyMap<string, SkillHandler> = new Map<string, SkillHandler>([
  ['script_rewriter', scriptRewriterHandler],
  ['extractor', extractorHandler],
  ['voice_assigner', voiceAssignerHandler],
  ['storyboard_breaker', storyboardBreakerHandler],
  ['storyboard_from_text', storyboardFromTextHandler],
  ['grid_prompt_generator', gridPromptHandler],
  // Backend-only skill: called from QuickVideoSessionsController.renameViaAi.
  // Does NOT persist ai_runs (see handler header / SKILL.md).
  ['quick-video-session-title', quickVideoSessionTitleHandler],
])

@Injectable()
export class AiService {
  constructor(private readonly gridService: GridService) {}

  async run(args: {
    payload: any
    stream: boolean
    reply: FastifyReply
    currentUser: { id: number }
    databaseService: DatabaseService
  }) {
    const { payload, stream, reply, currentUser, databaseService } = args
    const skillPrompt = loadSkillPrompt(payload.skill_id)

    const handler = SKILL_HANDLERS.get(String(payload.skill_id))
    if (handler) {
      const { response } = await handler({
        skillPrompt,
        payload,
        currentUser,
        databaseService,
        services: { gridService: this.gridService },
        reply,
        stream,
      })
      return response
    }

    // Default path: writing-domain runtime (proposal/action ledger, context
    // budget, knowledge cards, etc.). Episode-domain skills should never reach
    // here once their handlers are registered above.
    const context = await this.buildContext(payload, currentUser.id, databaseService)
    const systemPrompt = [skillPrompt, '', '# 当前请求', `mode: ${payload.mode}`, `scene: ${payload.scene}`, '', '# 上下文', context.prompt].join('\n')

    if (stream) {
      return this.streamChat({ reply, databaseService, systemPrompt, message: payload.input.message, context, payload, currentUser })
    }

    return this.nonStreamChat({ databaseService, systemPrompt, message: payload.input.message, context, payload, currentUser })
  }

  private async buildContext(payload: any, userId: number, databaseService: DatabaseService) {
    if (payload.target?.type !== 'writing' || !payload.target?.writing_id) {
      return { prompt: '当前目标未提供专用上下文。', references: [] as AiRuntimeReferenceItem[] }
    }

    const writingId = Number(payload.target.writing_id)
    const currentDocumentId = payload.target.document_id ? Number(payload.target.document_id) : null
    const mode = String(payload.mode || 'continuation')
    const budget = getContextBudget(mode)
    const selection = typeof payload.input?.selection === 'string' ? payload.input.selection.trim() : ''
    const [writing] = await databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, writingId), eq(writings.userId, userId), isNull(writings.deletedAt)))

    if (!writing) throw new BadRequestException('writing_not_found')

    const references: AiRuntimeReferenceItem[] = []
    const lines = [
      `作品标题：${writing.title}`,
      `作品类型：${writing.kind || ''}`,
      `作品梗概：${writing.synopsis || ''}`,
      `当前模式：${mode}`,
    ]

    const briefText = formatBriefForPrompt(writing.briefJson, budget.brief)
    if (briefText) {
      references.push({ kind: 'brief', title: '创作准备', reason: '项目级创作目标与约束' })
      lines.push('创作准备：')
      lines.push(briefText)
    }

    if (writing.outlineJson) {
      references.push({ kind: 'outline', title: '作品大纲', reason: '结构与章节规划' })
      lines.push(`作品大纲：${compactText(writing.outlineJson, budget.outline)}`)
    }

    if (currentDocumentId) {
      const [document] = await databaseService.db
        .select()
        .from(writingDocuments)
        .where(and(
          eq(writingDocuments.id, currentDocumentId),
          eq(writingDocuments.writingId, writingId),
          eq(writingDocuments.userId, userId),
          isNull(writingDocuments.deletedAt),
        ))
      if (document) {
        references.push({ kind: 'document', title: document.title, reason: '当前操作对象', document_id: document.id })
        lines.push(`当前文档标题：${document.title}`)
        lines.push(`当前文档内容：${compactText(document.contentMd, budget.currentDocument)}`)
        if (document.summary) {
          references.push({ kind: 'summary', title: document.title + ' summary', reason: 'current document summary', document_id: document.id })
          lines.push(`当前文档摘要：${compactText(document.summary, 1500)}`)
        }
      }
    }

    if (selection) {
      lines.push(`当前选区：${compactText(selection, budget.selection)}`)
    }

    const docs = await databaseService.db
      .select({
        id: writingDocuments.id,
        title: writingDocuments.title,
        documentType: writingDocuments.documentType,
        sortOrder: writingDocuments.sortOrder,
        summary: writingDocuments.summary,
        contentMd: writingDocuments.contentMd,
      })
      .from(writingDocuments)
      .where(and(eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, userId), isNull(writingDocuments.deletedAt)))
      .orderBy(asc(writingDocuments.sortOrder), asc(writingDocuments.id))

    if (docs.length) {
      lines.push(`项目文档目录：${docs.map((item) => `${item.documentType}:${item.title}`).join(' | ')}`)
      const currentIndex = currentDocumentId ? docs.findIndex((item) => item.id === currentDocumentId) : -1
      const neighborDocs = currentIndex >= 0
        ? docs.filter((item, index) => item.id !== currentDocumentId && Math.abs(index - currentIndex) <= Math.ceil(budget.neighborCount / 2)).slice(0, budget.neighborCount)
        : docs.slice(0, budget.neighborCount)
      if (neighborDocs.length) {
        lines.push('邻近文档摘要：' + neighborDocs.map((item) => {
          const digest = compactText(item.summary || item.contentMd || '', budget.neighborDigest)
          return `${item.title}${digest ? `：${digest}` : ''}`
        }).join(' | '))
        for (const item of neighborDocs) {
          references.push({ kind: 'document', title: item.title, reason: 'neighbor context', document_id: item.id })
        }
      }
    }

    const knowledgeCards = await databaseService.db
      .select({
        id: writingKnowledgeCards.id,
        cardType: writingKnowledgeCards.cardType,
        title: writingKnowledgeCards.title,
        content: writingKnowledgeCards.content,
        updatedAt: writingKnowledgeCards.updatedAt,
      })
      .from(writingKnowledgeCards)
      .where(and(eq(writingKnowledgeCards.writingId, writingId), eq(writingKnowledgeCards.userId, userId), isNull(writingKnowledgeCards.deletedAt)))
      .orderBy(desc(writingKnowledgeCards.updatedAt))
      .limit(24)

    const rankedKnowledgeCards = rankKnowledgeCards(knowledgeCards, mode).slice(0, budget.knowledgeCount)
    if (rankedKnowledgeCards.length) {
      lines.push(`知识卡摘要：${rankedKnowledgeCards.map((item) => `[${item.cardType}] ${item.title}: ${compactText(item.content, budget.knowledgeDigest)}`).join(' | ')}`)
      for (const item of rankedKnowledgeCards.slice(0, 5)) {
        references.push({ kind: 'knowledge_card', title: item.title, reason: `project ${item.cardType} context`, knowledge_card_id: item.id })
      }
    }

    const recentProposals = await databaseService.db
      .select({ title: writingProposals.title, proposalKind: writingProposals.proposalKind })
      .from(writingProposals)
      .where(and(eq(writingProposals.writingId, writingId), eq(writingProposals.userId, userId), eq(writingProposals.status, 'pending')))
      .orderBy(desc(writingProposals.createdAt))
      .limit(budget.proposalCount)

    if (recentProposals.length) {
      lines.push(`Recent pending proposals: ${recentProposals.map((item) => `[${item.proposalKind || 'generic'}] ${item.title}`).join(' | ')}`)
      for (const item of recentProposals) {
        references.push({ kind: 'proposal', title: item.title, reason: 'avoid duplicate suggestions and conflicts' })
      }
    }

    if (mode === 'outline') {
      lines.push('')
      lines.push('# 大纲生成要求')
      lines.push('- 必须基于以上创作准备（世界观、背景、主线、核心冲突、主要角色）展开，保持与梗概、已有大纲及章节一致。')
      lines.push('- 输出的 `write_outline` 必须包含大纲名称（name）与简短描述（description），再给出分阶段/分卷/分章结构（arcs）。')
    }

    return { prompt: lines.join('\n'), references }
  }

  private async streamChat(args: { reply: FastifyReply; databaseService: DatabaseService; systemPrompt: string; message: string; context: { references: AiRuntimeReferenceItem[] }; payload: any; currentUser: { id: number } }) {
    const { reply, databaseService, systemPrompt, message, context, payload, currentUser } = args
    const config = await this.getTextConfigOrThrow(databaseService)
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()
    const transform = new TransformStream()
    const writer = transform.writable.getWriter()

    const send = async (data: unknown, event = 'message') => {
      await writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    }

    void (async () => {
      try {
        await writer.write(encoder.encode(':ok\n\n'))
        await send({ type: 'status', text: '正在加载 Skill 与上下文...' }, 'status')
        for (const reference of context.references) {
          await send({ type: 'reference', ...reference }, 'reference')
        }
        await send({ type: 'status', text: '正在生成...' }, 'status')

        const url = `${getTextProviderBaseUrl(config).replace(/\/+$/, '')}/chat/completions`
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
          body: JSON.stringify({
            model: config.model,
            temperature: 0.7,
            stream: true,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: message },
            ],
          }),
        })

        if (!response.ok) {
          const errorMessage = await response.text().catch(() => '')
          throw new Error(errorMessage || `AI 请求失败（${response.status}）`)
        }
        if (!response.body) throw new Error('AI 流式响应为空')

        const reader = response.body.getReader()
        let buffer = ''
        let assistantText = ''
        let actionCandidates: AiRuntimeActionItem[] = []
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split(/\n\n/)
          buffer = blocks.pop() || ''
          for (const block of blocks) {
            const payload = parseSseDataBlock(block)
            if (!payload) continue
            const payloadActions = extractStreamingActions(payload)
            if (payloadActions.length) actionCandidates = payloadActions
            const delta = extractStreamingText(payload)
            if (!delta) continue
            assistantText += delta
            await send({ type: 'delta', text: delta }, 'delta')
          }
        }

        buffer += decoder.decode()
        if (buffer.trim()) {
          const payload = parseSseDataBlock(buffer)
          if (payload) {
            const payloadActions = extractStreamingActions(payload)
            if (payloadActions.length) actionCandidates = payloadActions
            const delta = extractStreamingText(payload)
            if (delta) {
              assistantText += delta
              await send({ type: 'delta', text: delta }, 'delta')
            }
          }
        }

        const parsedAssistantPayload = parseStructuredAssistantPayload(assistantText)
        const finalAssistantText = parsedAssistantPayload?.answer || assistantText
        if (!actionCandidates.length && parsedAssistantPayload?.actions?.length) {
          actionCandidates = parsedAssistantPayload.actions
        }
        await send({
          type: 'result',
          text: finalAssistantText,
          actions: actionCandidates,
          references: parsedAssistantPayload?.references || [],
        }, 'result')
        await databaseService.db.insert(aiRuns).values({
          userId: currentUser.id,
          skillId: String(payload.skill_id || ''),
          mode: String(payload.mode || 'default'),
          scene: String(payload.scene || 'default'),
          targetType: String(payload.target?.type || 'unknown'),
          targetId: resolveRunTargetId(payload),
          status: 'completed',
          userMessage: message,
          assistantMessage: finalAssistantText,
          referencesJson: JSON.stringify(context.references || []),
          actionsJson: JSON.stringify(actionCandidates),
        })
        await send({ type: 'done' }, 'done')
      } catch (error) {
        const messageText = error instanceof Error ? error.message : 'AI execution failed'
        try { await send({ type: 'error', message: messageText }, 'error') } catch {}
      } finally {
        try { await writer.close() } catch {}
      }
    })()

    return sendSseReply(reply, transform.readable)
  }


  async listRuns(args: {
    currentUser: { id: number }
    databaseService: DatabaseService
    targetType: string
    targetId: number
    limit: number
    beforeId?: number
    mode?: string
  }) {
    const { currentUser, databaseService, targetType, targetId, limit, beforeId, mode } = args
    const filters = [eq(aiRuns.userId, currentUser.id), eq(aiRuns.targetType, targetType), eq(aiRuns.targetId, targetId)]
    if (beforeId) filters.push(lt(aiRuns.id, beforeId))
    if (mode) filters.push(eq(aiRuns.mode, mode))
    const rows = await databaseService.db
      .select()
      .from(aiRuns)
      .where(and(...filters))
      .orderBy(desc(aiRuns.createdAt))
      .limit(limit)

    return rows.map((row) => ({
      id: row.id,
      mode: row.mode,
      user_message: row.userMessage,
      assistant_message: row.assistantMessage,
      actions: safeJsonParse<AiRuntimeActionItem[]>(row.actionsJson, []),
      references: safeJsonParse<AiRuntimeReferenceItem[]>(row.referencesJson, []),
      created_at: row.createdAt,
    }))
  }

  async applyAction(args: {
    currentUser: { id: number }
    databaseService: DatabaseService
    runId: number
    actionIndex: number
  }) {
    const { currentUser, databaseService, runId, actionIndex } = args
    const [run] = await databaseService.db
      .select()
      .from(aiRuns)
      .where(and(eq(aiRuns.id, runId), eq(aiRuns.userId, currentUser.id)))

    if (!run) throw new BadRequestException('ai_run_not_found')

    const actions = safeJsonParse<AiRuntimeActionItem[]>(run.actionsJson, [])
    const action = actions[actionIndex]
    if (!action || typeof action.type !== 'string') throw new BadRequestException('ai_action_not_found')
    if (action.applied === true) {
      const applyResult: AiRuntimeApplyResultPayload = action.apply_result || { type: action.type }
      return {
        type: action.type,
        writing_id: run.targetType === 'writing' ? run.targetId : undefined,
        document_id: typeof applyResult.document_id === 'number' ? applyResult.document_id : undefined,
        proposal_id: typeof applyResult.proposal_id === 'number' ? applyResult.proposal_id : undefined,
        knowledge_card_id: typeof applyResult.knowledge_card_id === 'number' ? applyResult.knowledge_card_id : undefined,
        structured: typeof action.structured === 'object' && action.structured ? action.structured : null,
        already_applied: true,
      }
    }

    const writingId = run.targetType === 'writing' ? run.targetId : null
    const nowTs = new Date()
    const structured: JsonObjectPayload | null = typeof action.structured === 'object' && action.structured ? action.structured : null

    if (action.type === 'create_document_draft') {
      if (!writingId) throw new BadRequestException('writing_target_required')
      const siblings = await databaseService.db
        .select()
        .from(writingDocuments)
        .where(and(eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))
      const maxOrder = siblings.reduce((value, row) => Math.max(value, row.sortOrder), -1)
      const [inserted] = await databaseService.db.insert(writingDocuments).values({
        writingId,
        userId: currentUser.id,
        parentId: null,
        title: String(action.title || 'AI 草稿'),
        documentType: 'note',
        sortOrder: maxOrder + 1,
        contentMd: String(action.content || ''),
        summary: null,
        wordCount: String(action.content || '').length,
        createdAt: nowTs,
        updatedAt: nowTs,
      }).returning()

      await databaseService.db.update(writings).set({ currentDocumentId: inserted.id, updatedAt: nowTs }).where(eq(writings.id, writingId))
      const result = { type: action.type, writing_id: writingId, document_id: inserted.id, structured }
      await databaseService.db.update(aiRuns).set({ actionsJson: JSON.stringify(markActionApplied(actions, actionIndex, result, nowTs)), updatedAt: nowTs }).where(eq(aiRuns.id, run.id))
      return result
    }

    if (action.type === 'update_brief') {
      if (!writingId) throw new BadRequestException('writing_target_required')
      await databaseService.db.update(writings).set({ briefJson: String(action.content || ''), updatedAt: nowTs }).where(eq(writings.id, writingId))
      const result = { type: action.type, writing_id: writingId, document_id: undefined, structured }
      await databaseService.db.update(aiRuns).set({ actionsJson: JSON.stringify(markActionApplied(actions, actionIndex, result, nowTs)), updatedAt: nowTs }).where(eq(aiRuns.id, run.id))
      return result
    }

    if (action.type === 'write_outline') {
      if (!writingId) throw new BadRequestException('writing_target_required')
      await databaseService.db.update(writings).set({ outlineJson: String(action.content || ''), updatedAt: nowTs }).where(eq(writings.id, writingId))
      const result = { type: action.type, writing_id: writingId, document_id: undefined, structured }
      await databaseService.db.update(aiRuns).set({ actionsJson: JSON.stringify(markActionApplied(actions, actionIndex, result, nowTs)), updatedAt: nowTs }).where(eq(aiRuns.id, run.id))
      return result
    }

    if (action.type === 'write_summary') {
      const documentId = typeof action.document_id === 'number'
        ? action.document_id
        : (typeof action.target_document_id === 'number' ? action.target_document_id : null)
      if (!writingId || !documentId) throw new BadRequestException('document_target_required')
      const [document] = await databaseService.db
        .select()
        .from(writingDocuments)
        .where(and(
          eq(writingDocuments.id, documentId),
          eq(writingDocuments.writingId, writingId),
          eq(writingDocuments.userId, currentUser.id),
          isNull(writingDocuments.deletedAt),
        ))
      if (!document) throw new BadRequestException('writing_document_not_found')

      const previousSummary = String(document.summary || '')
      if (previousSummary.trim()) {
        await databaseService.db.insert(writingObjectHistories).values({
          writingId,
          userId: currentUser.id,
          objectKind: 'summary',
          documentId: document.id,
          snapshotTitle: document.title,
          content: previousSummary,
          sourceRunId: run.id,
          createdAt: nowTs,
        })
      }

      await databaseService.db
        .update(writingDocuments)
        .set({ summary: String(action.content || '').trim() || null, updatedAt: nowTs })
        .where(eq(writingDocuments.id, document.id))
      await databaseService.db.update(writings).set({ currentDocumentId: document.id, updatedAt: nowTs }).where(eq(writings.id, writingId))
      const result = { type: action.type, writing_id: writingId, document_id: document.id, structured }
      await databaseService.db.update(aiRuns).set({ actionsJson: JSON.stringify(markActionApplied(actions, actionIndex, result, nowTs)), updatedAt: nowTs }).where(eq(aiRuns.id, run.id))
      return result
    }

    if (action.type === 'append_document') {
      const documentId = typeof action.document_id === 'number' ? action.document_id : null
      if (!writingId || !documentId) throw new BadRequestException('document_target_required')
      const [document] = await databaseService.db.select().from(writingDocuments).where(and(eq(writingDocuments.id, documentId), eq(writingDocuments.writingId, writingId), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt)))
      if (!document) throw new BadRequestException('writing_document_not_found')
      const nextContent = `${document.contentMd || ''}${document.contentMd ? '\n\n' : ''}${String(action.content || '')}`

      await databaseService.db.update(writingDocuments).set({ contentMd: nextContent, wordCount: nextContent.length, updatedAt: nowTs }).where(eq(writingDocuments.id, document.id))
      await databaseService.db.update(writings).set({ currentDocumentId: document.id, updatedAt: nowTs }).where(eq(writings.id, writingId))
      const result = { type: action.type, writing_id: writingId, document_id: document.id, structured }
      await databaseService.db.update(aiRuns).set({ actionsJson: JSON.stringify(markActionApplied(actions, actionIndex, result, nowTs)), updatedAt: nowTs }).where(eq(aiRuns.id, run.id))
      return result
    }

    if (action.type === 'replace_selection') {
      if (!writingId) throw new BadRequestException('writing_target_required')
      const targetDocumentId = readNumericActionField(action, 'target_document_id', 'document_id')
      const selection = readStringActionField(action, structured, ['selection', 'original', 'source_text'], '')
      const replacement = readStringActionField(action, structured, ['content', 'replacement', 'target_text'], '')
      const [inserted] = await databaseService.db.insert(writingProposals).values({
        writingId,
        userId: currentUser.id,
        sourceRunId: run.id,
        proposalKind: 'replace_selection',
        targetKind: 'document',
        targetDocumentId,
        title: readStringActionField(action, structured, ['title'], 'AI 选区改写提议'),
        content: replacement || String(action.content || ''),
        structuredJson: JSON.stringify({
          ...(structured || {}),
          selection,
          replacement: replacement || String(action.content || ''),
          safety_policy: 'proposal_first',
        }),
        referencesJson: run.referencesJson || JSON.stringify([]),
        status: 'pending',
        createdAt: nowTs,
        updatedAt: nowTs,
      }).returning()
      await databaseService.db.update(writings).set({ updatedAt: nowTs }).where(eq(writings.id, writingId))
      const result = { type: action.type, writing_id: writingId, document_id: inserted.targetDocumentId ?? undefined, proposal_id: inserted.id, structured }
      await databaseService.db.update(aiRuns).set({ actionsJson: JSON.stringify(markActionApplied(actions, actionIndex, result, nowTs)), updatedAt: nowTs }).where(eq(aiRuns.id, run.id))
      return result
    }

    if (action.type === 'create_proposal') {
      if (!writingId) throw new BadRequestException('writing_target_required')
      const [inserted] = await databaseService.db.insert(writingProposals).values({
        writingId,
        userId: currentUser.id,
        sourceRunId: run.id,
        proposalKind: String(action.proposal_kind || 'generic'),
        targetKind: String(action.target_kind || 'proposal'),
        targetDocumentId: typeof action.target_document_id === 'number' ? action.target_document_id : null,
        title: String(action.title || 'AI 提议'),
        content: String(action.content || ''),
        structuredJson: structured ? JSON.stringify(structured) : null,
        referencesJson: run.referencesJson || JSON.stringify([]),
        status: 'pending',
        createdAt: nowTs,
        updatedAt: nowTs,
      }).returning()
      await databaseService.db.update(writings).set({ updatedAt: nowTs }).where(eq(writings.id, writingId))
      const result = { type: action.type, writing_id: writingId, document_id: inserted.targetDocumentId ?? undefined, proposal_id: inserted.id, structured }
      await databaseService.db.update(aiRuns).set({ actionsJson: JSON.stringify(markActionApplied(actions, actionIndex, result, nowTs)), updatedAt: nowTs }).where(eq(aiRuns.id, run.id))
      return result
    }

    if (action.type === 'knowledge_card' || action.type === 'create_knowledge_card') {
      if (!writingId) throw new BadRequestException('writing_target_required')
      const [inserted] = await databaseService.db.insert(writingKnowledgeCards).values({
        writingId,
        userId: currentUser.id,
        proposalId: readNumericActionField(action, 'proposal_id'),
        cardType: normalizeKnowledgeCardType(action.card_type ?? action.knowledge_type ?? structured?.card_type ?? structured?.knowledge_type),
        title: readStringActionField(action, structured, ['title', 'name'], 'AI 知识卡'),
        content: readStringActionField(action, structured, ['content', 'description', 'summary'], ''),
        evidenceJson: JSON.stringify(buildKnowledgeEvidence(action, structured, run.referencesJson)),
        createdAt: nowTs,
        updatedAt: nowTs,
      }).returning()
      await databaseService.db.update(writings).set({ updatedAt: nowTs }).where(eq(writings.id, writingId))
      const result = { type: action.type, writing_id: writingId, knowledge_card_id: inserted.id, structured }
      await databaseService.db.update(aiRuns).set({ actionsJson: JSON.stringify(markActionApplied(actions, actionIndex, result, nowTs)), updatedAt: nowTs }).where(eq(aiRuns.id, run.id))
      return result
    }

    return {
      type: action.type,
      writing_id: writingId ?? undefined,
      document_id: typeof action.document_id === 'number' ? action.document_id : undefined,
      structured,
    }
  }

  private async nonStreamChat(args: { databaseService: DatabaseService; systemPrompt: string; message: string; context: { references: Array<{ kind: string; title: string }> }; payload: any; currentUser: { id: number } }) {
    const { databaseService, systemPrompt, message, context, payload, currentUser } = args
    const config = await this.getTextConfigOrThrow(databaseService)
    const url = `${getTextProviderBaseUrl(config).replace(/\/+$/, '')}/chat/completions`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message },
        ],
      }),
    })

    if (!response.ok) {
      const errorMessage = await response.text().catch(() => '')
      throw new BadRequestException(errorMessage || `AI 请求失败（${response.status}）`)
    }

    const responsePayload = await response.json() as any
    const content = responsePayload?.choices?.[0]?.message?.content
    const textContent = typeof content === 'string' ? content : ''
    const parsedAssistantPayload = parseStructuredAssistantPayload(textContent)
    const actions = safeJsonParse<AiRuntimeActionItem[]>(
      responsePayload?.choices?.[0]?.message?.actions ?? responsePayload?.actions,
      parsedAssistantPayload?.actions || [],
    )
    const finalAssistantText = parsedAssistantPayload?.answer || textContent

    await databaseService.db.insert(aiRuns).values({
      userId: currentUser.id,
      skillId: String(payload.skill_id || ''),
      mode: String(payload.mode || 'default'),
      scene: String(payload.scene || 'default'),
      targetType: String(payload.target?.type || 'unknown'),
      targetId: resolveRunTargetId(payload),
      status: 'completed',
      userMessage: message,
      assistantMessage: finalAssistantText,
      referencesJson: JSON.stringify(context.references || []),
      actionsJson: JSON.stringify(actions),
    })

    return { type: 'done', text: finalAssistantText, references: context.references, actions }
  }

  private async getTextConfigOrThrow(databaseService: DatabaseService) {
    try {
      return await getTextConfig(databaseService)
    } catch {
      throw new BadRequestException('未配置可用的文本 AI 服务')
    }
  }
}



