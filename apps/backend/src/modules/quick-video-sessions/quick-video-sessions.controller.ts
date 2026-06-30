import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common'
import { ApiBody, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger'
import { and, asc, desc, eq, gte, ilike, isNull, lte, or } from 'drizzle-orm'
import { z } from 'zod'

import { toPublicMediaUrl } from '../../common/media-url'
import { toSnakeCase } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import {
  quickVideoOutputs,
  quickVideoRounds,
  quickVideoSessions,
} from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { AiService } from '../ai/ai.service'
import { buildSessionTitleHistoryText } from '../ai/skill-handlers/quick-video-session-title.handler'

/**
 * 快速成片对话式工作台 · 后端 REST API
 * PRD docs/v2.2/快速成片-对话式工作台-PRD-v0.1.0.md §9 / §13
 *
 * 设计要点：
 *   - 全部端点强制 SessionAuthGuard + userId 隔离，软删除（deletedAt）
 *   - sessions.dominantOperation / summary 由 round 写入时维护，列表筛选无需 join
 *   - rounds.taskId / domainId 走业务侧软引用（不约束 FK），因为复用现有
 *     tasks / image_generations / video_generations / assets 表
 *   - 分支动作：复制目标 round 的祖先链到新会话；新 round 不复制 task_id
 *     （任务实体仍归原会话），但 outputs 全量复制以便分支独立浏览
 */

// ────────────────────────────────────────────────────────────────────
// Query / Body schemas
// ────────────────────────────────────────────────────────────────────

const STATUS_VALUES = ['active', 'archived', 'all'] as const
const OPERATION_VALUES = ['image', 'video', 'audio'] as const
const DERIVE_VALUES = ['edit', 'regenerate', 'image_to_video', 'branch'] as const
const ROUND_STATUS_VALUES = ['queued', 'running', 'completed', 'failed', 'canceled'] as const
const OUTPUT_STATUS_VALUES = ['processing', 'completed', 'failed'] as const

const sessionListQuerySchema = z.object({
  status: z.enum(STATUS_VALUES).default('active'),
  q: z.string().trim().optional(),
  op: z.enum(OPERATION_VALUES).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  page: z.coerce.number().int().positive().default(1),
  page_size: z.coerce.number().int().positive().max(100).default(50),
  sort: z.enum(['last_message_at', 'updated_at', 'created_at']).default('last_message_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
})

class SessionCreateDto {
  @ApiPropertyOptional({ type: String })
  title?: string
}

class SessionPatchDto {
  @ApiPropertyOptional({ type: String })
  title?: string

  @ApiPropertyOptional({ enum: ['active', 'archived'] })
  status?: 'active' | 'archived'

  @ApiPropertyOptional({ type: Number, nullable: true })
  cover_output_id?: number | null
}

class RoundCreateDto {
  @ApiProperty({ enum: OPERATION_VALUES })
  operation_type!: 'image' | 'video' | 'audio'

  @ApiProperty({ type: String })
  prompt!: string

  @ApiPropertyOptional({ type: [String] })
  attachments?: string[]

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  config_snapshot?: Record<string, unknown>

  @ApiPropertyOptional({ type: Number, nullable: true })
  parent_round_id?: number | null

  @ApiPropertyOptional({ enum: DERIVE_VALUES })
  derive_from?: 'edit' | 'regenerate' | 'image_to_video' | 'branch'

  @ApiPropertyOptional({ type: Number, nullable: true })
  task_id?: number | null

  @ApiPropertyOptional({ type: Number, nullable: true })
  domain_id?: number | null

  @ApiPropertyOptional({ enum: ROUND_STATUS_VALUES })
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'
}

class RoundPatchDto {
  @ApiPropertyOptional({ enum: ROUND_STATUS_VALUES })
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

  @ApiPropertyOptional({ type: Number, nullable: true })
  task_id?: number | null

  @ApiPropertyOptional({ type: Number, nullable: true })
  domain_id?: number | null

  @ApiPropertyOptional({ type: Number, nullable: true })
  progress?: number | null

  @ApiPropertyOptional({ type: String, nullable: true })
  error_message?: string | null
}

class OutputCreateDto {
  @ApiProperty({ enum: OPERATION_VALUES })
  kind!: 'image' | 'video' | 'audio'

  @ApiProperty({ type: String })
  preview_url!: string

  @ApiPropertyOptional({ type: String, nullable: true })
  thumb_url?: string | null

  @ApiPropertyOptional({ type: Number, nullable: true })
  task_id?: number | null

  @ApiPropertyOptional({ type: Number, nullable: true })
  domain_id?: number | null

  @ApiPropertyOptional({ enum: OUTPUT_STATUS_VALUES })
  status?: 'processing' | 'completed' | 'failed'

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown>

  @ApiPropertyOptional({ type: Boolean, description: '是否覆盖该 round 的现有 outputs' })
  replace?: boolean
}

class OutputsReplaceDto {
  @ApiProperty({ type: [OutputCreateDto] })
  outputs!: OutputCreateDto[]
}

// ────────────────────────────────────────────────────────────────────
// Serializers
// ────────────────────────────────────────────────────────────────────

function parseJson<T = unknown>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parsePositiveId(value: string | number, label: string) {
  const id = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`invalid ${label}`)
  }
  return id
}

function parseDate(value: string | undefined) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return date
}

function summarizePrompt(prompt: string, limit = 80) {
  const trimmed = String(prompt || '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return trimmed.length > limit ? `${trimmed.slice(0, limit)}…` : trimmed
}

function defaultSessionTitle(prompt: string) {
  const trimmed = String(prompt || '').replace(/\s+/g, ' ').trim()
  if (!trimmed) return '新创作'
  return trimmed.length > 18 ? `${trimmed.slice(0, 18)}…` : trimmed
}

type SessionRow = typeof quickVideoSessions.$inferSelect
type RoundRow = typeof quickVideoRounds.$inferSelect
type OutputRow = typeof quickVideoOutputs.$inferSelect

function serializeSession(row: SessionRow) {
  const base = toSnakeCase(row as unknown as Record<string, unknown>)
  return {
    ...base,
    metadata: parseJson<Record<string, unknown> | null>(row.metadataJson, null),
  }
}

function serializeRound(row: RoundRow) {
  const base = toSnakeCase(row as unknown as Record<string, unknown>)
  return {
    ...base,
    attachments: parseJson<string[]>(row.attachmentsJson, []),
    config_snapshot: parseJson<Record<string, unknown> | null>(row.configSnapshotJson, null),
  }
}

function serializeOutput(row: OutputRow) {
  const base = toSnakeCase(row as unknown as Record<string, unknown>)
  return {
    ...base,
    preview_url: toPublicMediaUrl(row.previewUrl),
    thumb_url: toPublicMediaUrl(row.thumbUrl),
    metadata: parseJson<Record<string, unknown> | null>(row.metadataJson, null),
  }
}

// ────────────────────────────────────────────────────────────────────
// Controller
// ────────────────────────────────────────────────────────────────────

@ApiTags('quick-video-sessions')
@Controller('quick-video-sessions')
@UseGuards(SessionAuthGuard)
export class QuickVideoSessionsController {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    private readonly aiService: AiService,
  ) {}

  // ───────── Sessions

  @Get()
  async listSessions(@Query() query: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const parsed = sessionListQuerySchema.parse(query)
    const conditions = [eq(quickVideoSessions.userId, currentUser.id), isNull(quickVideoSessions.deletedAt)]

    if (parsed.status !== 'all') {
      conditions.push(eq(quickVideoSessions.status, parsed.status))
    }
    if (parsed.op) {
      conditions.push(eq(quickVideoSessions.dominantOperation, parsed.op))
    }
    if (parsed.q) {
      const like = `%${parsed.q}%`
      conditions.push(
        // 任一字段命中即算匹配；summary 是首条 prompt 摘要，title 是会话名
        // drizzle 的 or 接受多个条件
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        or(ilike(quickVideoSessions.title, like), ilike(quickVideoSessions.summary, like))!,
      )
    }
    const from = parseDate(parsed.from)
    if (from) conditions.push(gte(quickVideoSessions.lastMessageAt, from))
    const to = parseDate(parsed.to)
    if (to) conditions.push(lte(quickVideoSessions.lastMessageAt, to))

    const sortColumn =
      parsed.sort === 'updated_at'
        ? quickVideoSessions.updatedAt
        : parsed.sort === 'created_at'
          ? quickVideoSessions.createdAt
          : quickVideoSessions.lastMessageAt
    const orderBy = parsed.order === 'asc' ? asc(sortColumn) : desc(sortColumn)

    const rows = await this.databaseService.db
      .select()
      .from(quickVideoSessions)
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(parsed.page_size)
      .offset((parsed.page - 1) * parsed.page_size)

    // 给每条会话挂封面 preview_url（cover_output_id 命中的 output）
    const coverIds = rows
      .map((row) => row.coverOutputId)
      .filter((id): id is number => typeof id === 'number')
    const covers = coverIds.length
      ? await this.databaseService.db
          .select()
          .from(quickVideoOutputs)
          .where(or(...coverIds.map((id) => eq(quickVideoOutputs.id, id)))!)
      : []
    const coverMap = new Map(covers.map((c) => [c.id, serializeOutput(c)]))

    return {
      items: rows.map((row) => ({
        ...serializeSession(row),
        cover_output: row.coverOutputId ? coverMap.get(row.coverOutputId) ?? null : null,
      })),
      page: parsed.page,
      page_size: parsed.page_size,
    }
  }

  @Post()
  @ApiBody({ type: SessionCreateDto })
  async createSession(@Body() body: SessionCreateDto, @CurrentUser() currentUser: CurrentUserType) {
    const ts = new Date()
    const title = String(body?.title || '').trim() || '新创作'
    const [row] = await this.databaseService.db
      .insert(quickVideoSessions)
      .values({
        userId: currentUser.id,
        title,
        status: 'active',
        lastMessageAt: ts,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()
    return serializeSession(row)
  }

  @Get(':id')
  async getSession(@Param('id') idParam: string, @CurrentUser() currentUser: CurrentUserType) {
    const id = parsePositiveId(idParam, 'session id')
    const session = await this.loadOwnedSession(id, currentUser.id)
    const rounds = await this.databaseService.db
      .select()
      .from(quickVideoRounds)
      .where(and(eq(quickVideoRounds.sessionId, id), isNull(quickVideoRounds.deletedAt)))
      .orderBy(asc(quickVideoRounds.createdAt))
    const roundIds = rounds.map((r) => r.id)
    const outputs = roundIds.length
      ? await this.databaseService.db
          .select()
          .from(quickVideoOutputs)
          .where(or(...roundIds.map((rid) => eq(quickVideoOutputs.roundId, rid)))!)
          .orderBy(asc(quickVideoOutputs.createdAt))
      : []
    const outputsByRound = new Map<number, OutputRow[]>()
    for (const output of outputs) {
      const list = outputsByRound.get(output.roundId) ?? []
      list.push(output)
      outputsByRound.set(output.roundId, list)
    }
    return {
      session: serializeSession(session),
      rounds: rounds.map((row) => ({
        ...serializeRound(row),
        outputs: (outputsByRound.get(row.id) ?? []).map(serializeOutput),
      })),
    }
  }

  @Patch(':id')
  @ApiBody({ type: SessionPatchDto })
  async patchSession(
    @Param('id') idParam: string,
    @Body() body: SessionPatchDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const id = parsePositiveId(idParam, 'session id')
    await this.loadOwnedSession(id, currentUser.id)
    const patch: Partial<SessionRow> = { updatedAt: new Date() }
    if (typeof body?.title === 'string') {
      const next = body.title.trim()
      if (next) patch.title = next.slice(0, 255)
    }
    if (body?.status === 'active' || body?.status === 'archived') {
      patch.status = body.status
    }
    if (body?.cover_output_id === null) {
      patch.coverOutputId = null
    } else if (typeof body?.cover_output_id === 'number') {
      // 校验封面归属
      const [output] = await this.databaseService.db
        .select({ id: quickVideoOutputs.id, roundId: quickVideoOutputs.roundId })
        .from(quickVideoOutputs)
        .where(eq(quickVideoOutputs.id, body.cover_output_id))
      if (!output) throw new NotFoundException('封面对应的产物不存在')
      const [parentRound] = await this.databaseService.db
        .select({ sessionId: quickVideoRounds.sessionId })
        .from(quickVideoRounds)
        .where(eq(quickVideoRounds.id, output.roundId))
      if (!parentRound || parentRound.sessionId !== id) {
        throw new BadRequestException('封面必须来自当前会话')
      }
      patch.coverOutputId = body.cover_output_id
    }
    const [row] = await this.databaseService.db
      .update(quickVideoSessions)
      .set(patch)
      .where(eq(quickVideoSessions.id, id))
      .returning()
    return serializeSession(row)
  }

  @Delete(':id')
  async deleteSession(@Param('id') idParam: string, @CurrentUser() currentUser: CurrentUserType) {
    const id = parsePositiveId(idParam, 'session id')
    await this.loadOwnedSession(id, currentUser.id)
    const ts = new Date()
    await this.databaseService.db
      .update(quickVideoSessions)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(eq(quickVideoSessions.id, id))
    // 同时软删该会话所有 rounds（outputs 不软删，仍能查到历史；上层走 round 过滤）
    await this.databaseService.db
      .update(quickVideoRounds)
      .set({ deletedAt: ts, updatedAt: ts })
      .where(and(eq(quickVideoRounds.sessionId, id), isNull(quickVideoRounds.deletedAt)))
    return { success: true }
  }

  // ───────── Rounds

  @Get(':id/rounds')
  async listRounds(@Param('id') idParam: string, @CurrentUser() currentUser: CurrentUserType) {
    const id = parsePositiveId(idParam, 'session id')
    await this.loadOwnedSession(id, currentUser.id)
    const rows = await this.databaseService.db
      .select()
      .from(quickVideoRounds)
      .where(and(eq(quickVideoRounds.sessionId, id), isNull(quickVideoRounds.deletedAt)))
      .orderBy(asc(quickVideoRounds.createdAt))
    return { items: rows.map(serializeRound) }
  }

  @Post(':id/rounds')
  @ApiBody({ type: RoundCreateDto })
  async createRound(
    @Param('id') idParam: string,
    @Body() body: RoundCreateDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const id = parsePositiveId(idParam, 'session id')
    const session = await this.loadOwnedSession(id, currentUser.id)
    if (!OPERATION_VALUES.includes(body?.operation_type as never)) {
      throw new BadRequestException('operation_type invalid')
    }
    const ts = new Date()
    const prompt = String(body?.prompt || '')
    const [row] = await this.databaseService.db
      .insert(quickVideoRounds)
      .values({
        sessionId: id,
        parentRoundId:
          typeof body?.parent_round_id === 'number' && body.parent_round_id > 0
            ? body.parent_round_id
            : null,
        deriveFrom: DERIVE_VALUES.includes(body?.derive_from as never) ? (body!.derive_from as string) : null,
        operationType: body.operation_type,
        prompt,
        attachmentsJson: JSON.stringify(Array.isArray(body?.attachments) ? body.attachments : []),
        configSnapshotJson: body?.config_snapshot ? JSON.stringify(body.config_snapshot) : null,
        status: ROUND_STATUS_VALUES.includes(body?.status as never) ? (body!.status as string) : 'queued',
        taskId: typeof body?.task_id === 'number' ? body.task_id : null,
        domainId: typeof body?.domain_id === 'number' ? body.domain_id : null,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    // 维护 session 的 lastMessageAt / summary / dominantOperation
    const nextSummary = summarizePrompt(prompt) ?? session.summary ?? null
    const nextDominant =
      session.dominantOperation && session.dominantOperation !== body.operation_type
        ? 'mixed'
        : body.operation_type
    const sessionPatch: Partial<SessionRow> = {
      lastMessageAt: ts,
      updatedAt: ts,
      summary: nextSummary,
      dominantOperation: nextDominant,
    }
    // 默认用首条 prompt 截断作为标题
    if (!session.title || session.title === '新创作') {
      sessionPatch.title = defaultSessionTitle(prompt)
    }
    await this.databaseService.db
      .update(quickVideoSessions)
      .set(sessionPatch)
      .where(eq(quickVideoSessions.id, id))

    return serializeRound(row)
  }

  @Patch(':id/rounds/:roundId')
  @ApiBody({ type: RoundPatchDto })
  async patchRound(
    @Param('id') idParam: string,
    @Param('roundId') roundIdParam: string,
    @Body() body: RoundPatchDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const id = parsePositiveId(idParam, 'session id')
    const roundId = parsePositiveId(roundIdParam, 'round id')
    await this.loadOwnedSession(id, currentUser.id)
    const patch: Partial<RoundRow> = { updatedAt: new Date() }
    if (ROUND_STATUS_VALUES.includes(body?.status as never)) {
      patch.status = body!.status as string
    }
    if (body?.task_id === null || typeof body?.task_id === 'number') patch.taskId = body.task_id ?? null
    if (body?.domain_id === null || typeof body?.domain_id === 'number') patch.domainId = body.domain_id ?? null
    if (body?.progress === null || typeof body?.progress === 'number') patch.progress = body.progress ?? null
    if (body?.error_message === null || typeof body?.error_message === 'string') {
      patch.errorMessage = body.error_message ?? null
    }
    const [row] = await this.databaseService.db
      .update(quickVideoRounds)
      .set(patch)
      .where(and(eq(quickVideoRounds.id, roundId), eq(quickVideoRounds.sessionId, id)))
      .returning()
    if (!row) throw new NotFoundException('轮次不存在')
    return serializeRound(row)
  }

  // ───────── Outputs

  @Get(':id/rounds/:roundId/outputs')
  async listOutputs(
    @Param('id') idParam: string,
    @Param('roundId') roundIdParam: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const id = parsePositiveId(idParam, 'session id')
    const roundId = parsePositiveId(roundIdParam, 'round id')
    await this.loadOwnedSession(id, currentUser.id)
    const rows = await this.databaseService.db
      .select()
      .from(quickVideoOutputs)
      .where(eq(quickVideoOutputs.roundId, roundId))
      .orderBy(asc(quickVideoOutputs.createdAt))
    return { items: rows.map(serializeOutput) }
  }

  @Post(':id/rounds/:roundId/outputs')
  @ApiBody({ type: OutputCreateDto })
  async createOutput(
    @Param('id') idParam: string,
    @Param('roundId') roundIdParam: string,
    @Body() body: OutputCreateDto,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const id = parsePositiveId(idParam, 'session id')
    const roundId = parsePositiveId(roundIdParam, 'round id')
    await this.loadOwnedSession(id, currentUser.id)
    const ts = new Date()
    if (body?.replace) {
      await this.databaseService.db
        .delete(quickVideoOutputs)
        .where(eq(quickVideoOutputs.roundId, roundId))
    }
    const [row] = await this.databaseService.db
      .insert(quickVideoOutputs)
      .values({
        roundId,
        kind: body.kind,
        taskId: typeof body?.task_id === 'number' ? body.task_id : null,
        domainId: typeof body?.domain_id === 'number' ? body.domain_id : null,
        previewUrl: String(body?.preview_url || ''),
        thumbUrl: body?.thumb_url ?? null,
        status: OUTPUT_STATUS_VALUES.includes(body?.status as never) ? (body!.status as string) : 'completed',
        metadataJson: body?.metadata ? JSON.stringify(body.metadata) : null,
        createdAt: ts,
      })
      .returning()
    return serializeOutput(row)
  }

  // ───────── P2: 自动命名 / 分支

  @Post(':id/rename-ai')
  async renameViaAi(@Param('id') idParam: string, @CurrentUser() currentUser: CurrentUserType) {
    const id = parsePositiveId(idParam, 'session id')
    const session = await this.loadOwnedSession(id, currentUser.id)
    const rounds = await this.databaseService.db
      .select({
        prompt: quickVideoRounds.prompt,
        operationType: quickVideoRounds.operationType,
      })
      .from(quickVideoRounds)
      .where(and(eq(quickVideoRounds.sessionId, id), isNull(quickVideoRounds.deletedAt)))
      .orderBy(asc(quickVideoRounds.createdAt))
      .limit(5)
    if (!rounds.length) {
      throw new BadRequestException('该会话还没有可用于命名的创作内容')
    }
    // Route through the unified skill runtime so this AI call is governed by
    // skills/quick-video-session-title/SKILL.md instead of an ad-hoc fetch.
    // The handler intentionally does NOT persist ai_runs (background naming
    // shouldn't pollute the user-facing AI history list).
    let title: string
    try {
      // FastifyReply is unused for this skill (stream=false), but the AiService
      // signature requires it. Pass a no-op cast — handler never touches reply.
      const result = await this.aiService.run({
        payload: {
          skill_id: 'quick-video-session-title',
          mode: 'title',
          scene: 'quick_video_session',
          target: { type: 'quick_video_session', session_id: id },
          input: { message: buildSessionTitleHistoryText(rounds) },
          options: { stream: false },
        },
        stream: false,
        reply: undefined as unknown as Parameters<typeof this.aiService.run>[0]['reply'],
        currentUser,
        databaseService: this.databaseService,
      })
      // Non-stream skill handlers return { type:'done', text, references, actions }.
      if (typeof result !== 'object' || result === null || !('text' in result)) {
        throw new Error('AI 命名响应格式异常')
      }
      title = String((result as { text: string }).text || '')
    } catch (error) {
      throw new BadGatewayException((error as Error)?.message || 'AI 命名失败')
    }
    const safeTitle = title.replace(/\s+/g, '').slice(0, 18) || session.title
    const ts = new Date()
    const [row] = await this.databaseService.db
      .update(quickVideoSessions)
      .set({ title: safeTitle, updatedAt: ts })
      .where(eq(quickVideoSessions.id, id))
      .returning()
    return serializeSession(row)
  }

  @Post(':id/rounds/:roundId/branch')
  async branchFromRound(
    @Param('id') idParam: string,
    @Param('roundId') roundIdParam: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const id = parsePositiveId(idParam, 'session id')
    const roundId = parsePositiveId(roundIdParam, 'round id')
    const session = await this.loadOwnedSession(id, currentUser.id)
    const [targetRound] = await this.databaseService.db
      .select()
      .from(quickVideoRounds)
      .where(and(eq(quickVideoRounds.id, roundId), eq(quickVideoRounds.sessionId, id)))
    if (!targetRound) throw new NotFoundException('要分支的轮次不存在')

    // 收集祖先链（含目标 round 自己）
    const chain: RoundRow[] = []
    let cursor: RoundRow | undefined = targetRound
    const guard = new Set<number>()
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id)
      chain.unshift(cursor)
      if (!cursor.parentRoundId) break
      const [parent] = await this.databaseService.db
        .select()
        .from(quickVideoRounds)
        .where(eq(quickVideoRounds.id, cursor.parentRoundId))
      cursor = parent
    }

    // 创建新会话
    const ts = new Date()
    const branchTitle = `${session.title} · 分支`.slice(0, 255)
    const [newSession] = await this.databaseService.db
      .insert(quickVideoSessions)
      .values({
        userId: currentUser.id,
        title: branchTitle,
        status: 'active',
        dominantOperation: session.dominantOperation,
        summary: session.summary,
        metadataJson: JSON.stringify({
          source_session_id: session.id,
          source_round_id: targetRound.id,
          branch_at: ts.toISOString(),
        }),
        lastMessageAt: ts,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    // 按 chain 顺序复制 rounds + outputs；维护新旧 id 映射以接续 parent
    const idMap = new Map<number, number>()
    for (const original of chain) {
      const isLeaf = original.id === targetRound.id
      const [newRound] = await this.databaseService.db
        .insert(quickVideoRounds)
        .values({
          sessionId: newSession.id,
          parentRoundId: original.parentRoundId ? idMap.get(original.parentRoundId) ?? null : null,
          deriveFrom: isLeaf ? 'branch' : original.deriveFrom,
          operationType: original.operationType,
          prompt: original.prompt,
          attachmentsJson: original.attachmentsJson,
          configSnapshotJson: original.configSnapshotJson,
          status: original.status,
          errorMessage: original.errorMessage,
          // task_id 不复制（任务实体仍归原会话）；domain_id 保留以便回显结果
          taskId: null,
          domainId: original.domainId,
          progress: original.progress,
          branchName: isLeaf ? `from-#${session.id}/${original.id}` : null,
          createdAt: ts,
          updatedAt: ts,
        })
        .returning()
      idMap.set(original.id, newRound.id)

      const outputs = await this.databaseService.db
        .select()
        .from(quickVideoOutputs)
        .where(eq(quickVideoOutputs.roundId, original.id))
      for (const o of outputs) {
        await this.databaseService.db.insert(quickVideoOutputs).values({
          roundId: newRound.id,
          kind: o.kind,
          taskId: null,
          domainId: o.domainId,
          previewUrl: o.previewUrl,
          thumbUrl: o.thumbUrl,
          status: o.status,
          metadataJson: o.metadataJson,
          createdAt: ts,
        })
      }
    }

    return { session: serializeSession(newSession), source_session_id: session.id, source_round_id: targetRound.id }
  }

  // ───────── helpers

  private async loadOwnedSession(id: number, userId: number): Promise<SessionRow> {
    const [row] = await this.databaseService.db
      .select()
      .from(quickVideoSessions)
      .where(
        and(
          eq(quickVideoSessions.id, id),
          eq(quickVideoSessions.userId, userId),
          isNull(quickVideoSessions.deletedAt),
        ),
      )
    if (!row) throw new NotFoundException('会话不存在')
    return row
  }
}
