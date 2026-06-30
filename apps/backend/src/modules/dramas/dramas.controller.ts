import { BadRequestException, Body, ConflictException, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, count, desc, eq, ilike, inArray, isNull } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { z } from 'zod'

import { toPublicMediaUrl } from '../../common/media-url'
import { toSnakeCase, toSnakeCaseArrayWithPublicMedia, toSnakeCaseWithPublicMedia } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import { characters, dramas, episodes, props, scenes, writingDocuments, writings } from '../../db/schema'
import { parseDramaMetadata, resolveProjectConfigId } from './drama-metadata'
import { AuthService } from '../auth/auth.service'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'

const dramaMediaFields = { urlFields: ['thumbnail'] } as const
const episodeMediaFields = { urlFields: ['videoUrl', 'thumbnail'] } as const
const characterMediaFields = { urlFields: ['imageUrl', 'voiceSampleUrl'], jsonArrayFields: ['referenceImages'] } as const
const sceneMediaFields = { urlFields: ['imageUrl'] } as const
const propMediaFields = { urlFields: ['imageUrl'], jsonArrayFields: ['referenceImages'] } as const

const dramaCreateSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().nullable().optional(),
  genre: z.string().trim().nullable().optional(),
  style: z.string().trim().nullable().optional(),
  tags: z.unknown().optional(),
  metadata: z.unknown().optional(),
  total_episodes: z.coerce.number().int().nonnegative().optional(),
})

const dramaUpdateSchema = z.object({
  title: z.string().trim().optional(),
  description: z.string().trim().nullable().optional(),
  genre: z.string().trim().nullable().optional(),
  style: z.string().trim().nullable().optional(),
  status: z.string().trim().optional(),
  thumbnail: z.string().trim().nullable().optional(),
  tags: z.unknown().optional(),
  metadata: z.unknown().optional(),
})

const createDramaFromWritingSchema = z.object({
  writing_id: z.coerce.number().int().positive(),
  document_id: z.coerce.number().int().positive().nullable().optional(),
  title: z.string().trim().optional(),
})

type EpisodeDraft = {
  title: string
  content: string
}

function serializeMetadata(value: unknown) {
  if (value == null) return null
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function parseDramaId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException('invalid drama id')
  }
  return id
}

function normalizeScript(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toOptionalNumber(value: unknown) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function dramaPayloadBase(drama: typeof dramas.$inferSelect) {
  return {
    ...toSnakeCaseWithPublicMedia(drama as unknown as Record<string, unknown>, dramaMediaFields),
    tags: parseJsonValue(drama.tags),
  }
}

function buildEpisodeTitle(input: {
  writingTitle: string
  documentTitle: string | null
}) {
  const docTitle = String(input.documentTitle || '').trim()
  if (docTitle && docTitle !== '作品根文档') return docTitle
  return `${input.writingTitle} · 第1集`
}

function titleForEpisode(index: number) {
  return `第${index}集`
}

function splitByEpisodeMarkers(script: string): EpisodeDraft[] {
  const markerPattern = /(?:^|\r?\n)[ \t]*(?:#{1,6}[ \t]*)?((?:(?:第[ \t]*[0-9０-９一二三四五六七八九十百千万零〇两俩]+[ \t]*(?:章节|集|章|節|节))|(?:(?:EP|Episode)\.?[ \t]*[0-9０-９]+))(?:[ \t]*(?:[：:、-]|[ \t]+)[^\r\n]*)?)[ \t]*(?=\r?\n|$)/gi
  const matches = Array.from(script.matchAll(markerPattern))
  if (!matches.length) return []

  return matches
    .map((match, index) => {
      const start = (match.index || 0) + match[0].length
      const end = matches[index + 1]?.index ?? script.length
      const markerTitle = String(match[1] || '').trim()
      const title = markerTitle || titleForEpisode(index + 1)
      const content = script.slice(start, end).trim()
      return { title, content }
    })
    .filter((episode) => episode.content)
}

@ApiTags('dramas')
@Controller('dramas')
export class DramasController {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AuthService) private readonly authService: AuthService,
  ) {}

  @Get('stats')
  @UseGuards(SessionAuthGuard)
  async getDramaStats(@CurrentUser() currentUser: CurrentUserType) {
    const rows = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.userId, currentUser.id), isNull(dramas.deletedAt)))

    const byStatus = Object.entries(
      rows.reduce<Record<string, number>>((acc, drama) => {
        const key = drama.status || 'draft'
        acc[key] = (acc[key] || 0) + 1
        return acc
      }, {}),
    ).map(([status, count]) => ({ status, count }))

    return {
      total: rows.length,
      by_status: byStatus,
    }
  }

  @Get()
  async listDramas(@Req() request: FastifyRequest, @Query() query: Record<string, string | undefined>) {
    const session = await this.authService.getSession(request)
    const page = Math.max(1, Number(query.page || 1))
    const pageSize = Math.max(1, Number(query.page_size || 20))
    const status = query.status?.trim()
    const keyword = query.keyword?.trim()
    const includeDetails = query.include_details !== '0' && query.include_details !== 'false'

    const conditions = [isNull(dramas.deletedAt)]
    if (session?.user) {
      conditions.push(eq(dramas.userId, session.user.id))
    } else {
      conditions.push(eq(dramas.isPublic, true))
    }
    if (status) {
      conditions.push(eq(dramas.status, status))
    }
    if (keyword) {
      conditions.push(ilike(dramas.title, `%${keyword}%`))
    }

    const filtered = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(...conditions))
      .orderBy(desc(dramas.updatedAt))
    const total = filtered.length
    const items = filtered.slice((page - 1) * pageSize, page * pageSize)
    const dramaIds = items.map((drama) => drama.id)

    const episodesByDrama = new Map<number, typeof episodes.$inferSelect[]>()
    const charactersByDrama = new Map<number, typeof characters.$inferSelect[]>()
    const scenesByDrama = new Map<number, typeof scenes.$inferSelect[]>()
    const episodeCountByDrama = new Map<number, number>()
    const characterCountByDrama = new Map<number, number>()
    const sceneCountByDrama = new Map<number, number>()

    if (dramaIds.length) {
      if (includeDetails || !session?.user) {
        const [episodeRows, characterRows, sceneRows] = await Promise.all([
          this.databaseService.db
            .select()
            .from(episodes)
            .where(
              and(
                inArray(episodes.dramaId, dramaIds),
                isNull(episodes.deletedAt),
                session?.user ? eq(episodes.userId, session.user.id) : undefined,
              ),
            ),
          this.databaseService.db
            .select()
            .from(characters)
            .where(
              and(
                inArray(characters.dramaId, dramaIds),
                isNull(characters.deletedAt),
                session?.user ? eq(characters.userId, session.user.id) : undefined,
              ),
            ),
          this.databaseService.db
            .select()
            .from(scenes)
            .where(
              and(
                inArray(scenes.dramaId, dramaIds),
                isNull(scenes.deletedAt),
                session?.user ? eq(scenes.userId, session.user.id) : undefined,
              ),
            ),
        ])

        for (const row of episodeRows) {
          const bucket = episodesByDrama.get(row.dramaId)
          if (bucket) {
            bucket.push(row)
          } else {
            episodesByDrama.set(row.dramaId, [row])
          }
        }
        for (const row of characterRows) {
          const bucket = charactersByDrama.get(row.dramaId)
          if (bucket) {
            bucket.push(row)
          } else {
            charactersByDrama.set(row.dramaId, [row])
          }
        }
        for (const row of sceneRows) {
          const bucket = scenesByDrama.get(row.dramaId)
          if (bucket) {
            bucket.push(row)
          } else {
            scenesByDrama.set(row.dramaId, [row])
          }
        }
      } else {
        const [episodeCounts, characterCounts, sceneCounts] = await Promise.all([
          this.databaseService.db
            .select({ dramaId: episodes.dramaId, total: count() })
            .from(episodes)
            .where(and(inArray(episodes.dramaId, dramaIds), isNull(episodes.deletedAt), eq(episodes.userId, session.user.id)))
            .groupBy(episodes.dramaId),
          this.databaseService.db
            .select({ dramaId: characters.dramaId, total: count() })
            .from(characters)
            .where(and(inArray(characters.dramaId, dramaIds), isNull(characters.deletedAt), eq(characters.userId, session.user.id)))
            .groupBy(characters.dramaId),
          this.databaseService.db
            .select({ dramaId: scenes.dramaId, total: count() })
            .from(scenes)
            .where(and(inArray(scenes.dramaId, dramaIds), isNull(scenes.deletedAt), eq(scenes.userId, session.user.id)))
            .groupBy(scenes.dramaId),
        ])

        for (const row of episodeCounts) episodeCountByDrama.set(row.dramaId, Number(row.total) || 0)
        for (const row of characterCounts) characterCountByDrama.set(row.dramaId, Number(row.total) || 0)
        for (const row of sceneCounts) sceneCountByDrama.set(row.dramaId, Number(row.total) || 0)
      }
    }

    const enriched = items.map((drama) => {
      const dramaEpisodeRows = episodesByDrama.get(drama.id) || []
      const dramaCharacterRows = charactersByDrama.get(drama.id) || []
      const dramaSceneRows = scenesByDrama.get(drama.id) || []
      const episodeCount = includeDetails || !session?.user ? dramaEpisodeRows.length : episodeCountByDrama.get(drama.id) || 0
      const characterCount = includeDetails || !session?.user ? dramaCharacterRows.length : characterCountByDrama.get(drama.id) || 0
      const sceneCount = includeDetails || !session?.user ? dramaSceneRows.length : sceneCountByDrama.get(drama.id) || 0

      const payload = {
        ...dramaPayloadBase(drama),
        total_episodes: episodeCount,
        episode_count: episodeCount,
        character_count: characterCount,
        scene_count: sceneCount,
      } as Record<string, unknown>

      if (!session?.user) {
        const scripted = dramaEpisodeRows.filter((episode) => Boolean(episode.scriptContent?.trim())).length
        payload.script_progress_percent = dramaEpisodeRows.length
          ? Math.round((scripted / dramaEpisodeRows.length) * 100)
          : 0
        payload.episodes = []
        payload.characters = []
        payload.scenes = []
        return payload
      }

      if (includeDetails) {
        payload.episodes = toSnakeCaseArrayWithPublicMedia(dramaEpisodeRows as unknown as Record<string, unknown>[], episodeMediaFields)
        payload.characters = toSnakeCaseArrayWithPublicMedia(dramaCharacterRows as unknown as Record<string, unknown>[], characterMediaFields)
        payload.scenes = toSnakeCaseArrayWithPublicMedia(dramaSceneRows as unknown as Record<string, unknown>[], sceneMediaFields)
      }

      return payload
    })

    return {
      items: enriched,
      pagination: {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.ceil(total / pageSize),
      },
    }
  }

  @Post()
  @UseGuards(SessionAuthGuard)
  async createDrama(@Body() body: unknown, @CurrentUser() currentUser: CurrentUserType) {
    const payload = dramaCreateSchema.parse(body)
    const now = new Date()

    const [drama] = await this.databaseService.db
      .insert(dramas)
      .values({
        userId: currentUser.id,
        title: payload.title,
        description: payload.description ?? null,
        genre: payload.genre ?? null,
        style: payload.style ?? null,
        tags: payload.tags !== undefined ? JSON.stringify(payload.tags) : null,
        metadata: serializeMetadata(payload.metadata),
        totalEpisodes: payload.total_episodes ?? 0,
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return dramaPayloadBase(drama)
  }

  @Post('from-writing')
  @UseGuards(SessionAuthGuard)
  async createDramaFromWriting(
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const payload = createDramaFromWritingSchema.parse(body)
    const [writing] = await this.databaseService.db
      .select()
      .from(writings)
      .where(and(eq(writings.id, payload.writing_id), eq(writings.userId, currentUser.id), isNull(writings.deletedAt)))

    if (!writing) {
      return { error: 'writing_not_found' }
    }

    const documents = (await this.databaseService.db
      .select()
      .from(writingDocuments)
      .where(and(eq(writingDocuments.writingId, payload.writing_id), eq(writingDocuments.userId, currentUser.id), isNull(writingDocuments.deletedAt))))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)

    const sourceDocument = payload.document_id == null
      ? documents.find((doc) => doc.id === writing.currentDocumentId) || documents[0] || null
      : documents.find((doc) => doc.id === payload.document_id) || null

    const documentIds = sourceDocument
      ? [sourceDocument.id]
      : documents.filter((doc) => doc.documentType !== 'root').map((doc) => doc.id)

    const blocks = documentIds
      .map((documentId) => documents.find((doc) => doc.id === documentId))
      .filter((doc): doc is typeof documents[number] => Boolean(doc))
      .map((doc) => {
        const bodyText = String(doc.contentMd || '').trim()
        if (!bodyText) return ''
        return `## ${doc.title}\n\n${bodyText}`
      })
      .filter(Boolean)

    const mergedContent = blocks.join('\n\n')
    const safeTitle = payload.title?.trim() || `${writing.title} · 改编项目`
    const now = new Date()

    const [drama] = await this.databaseService.db
      .insert(dramas)
      .values({
        userId: currentUser.id,
        title: safeTitle,
        description: writing.synopsis || `由《${writing.title}》导入`,
        totalEpisodes: 1,
        status: 'draft',
        metadata: JSON.stringify({
          source_type: 'writing',
          source_writing_id: writing.id,
          source_document_id: sourceDocument?.id ?? null,
        }),
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    const [episode] = await this.databaseService.db
      .insert(episodes)
      .values({
        userId: currentUser.id,
        dramaId: drama.id,
        episodeNumber: 1,
        title: buildEpisodeTitle({
          writingTitle: writing.title,
          documentTitle: sourceDocument?.title ?? documents[0]?.title ?? null,
        }),
        content: mergedContent || writing.synopsis || '',
        scriptContent: mergedContent || writing.synopsis || '',
        description: writing.synopsis || `从《${writing.title}》导入`,
        imageConfigId: resolveProjectConfigId(drama.metadata, 'image'),
        videoConfigId: resolveProjectConfigId(drama.metadata, 'video'),
        audioConfigId: resolveProjectConfigId(drama.metadata, 'audio'),
        status: 'draft',
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    return {
      drama_id: drama.id,
      episode_id: episode.id,
      source_writing_id: writing.id,
      source_document_id: sourceDocument?.id ?? null,
    }
  }

  @Post(':id/split-episodes')
  @UseGuards(SessionAuthGuard)
  async splitEpisodes(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id)
    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id), isNull(dramas.deletedAt)))

    if (!drama) {
      throw new NotFoundException('drama_not_found')
    }

    const replaceExisting = body.replace_existing === true
    const existingEpisodes = await this.databaseService.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.dramaId, dramaId), eq(episodes.userId, currentUser.id), isNull(episodes.deletedAt)))
      .orderBy(episodes.episodeNumber)

    const script = normalizeScript(body.content) || (
      replaceExisting && existingEpisodes.length === 1
        ? normalizeScript(existingEpisodes[0]?.content || existingEpisodes[0]?.scriptContent)
        : ''
    )

    if (!script) {
      throw new BadRequestException('请输入剧本内容')
    }

    if (existingEpisodes.length > 0 && !replaceExisting) {
      throw new ConflictException('当前项目已存在分集，不能重复自动分集')
    }

    const drafts = splitByEpisodeMarkers(script)
    const splitMode = 'marker'
    const imageConfigId = toOptionalNumber(body.image_config_id)
    const videoConfigId = toOptionalNumber(body.video_config_id)
    const audioConfigId = toOptionalNumber(body.audio_config_id)
    const projectImageConfigId = resolveProjectConfigId(drama.metadata, 'image')
    const projectVideoConfigId = resolveProjectConfigId(drama.metadata, 'video')
    const projectAudioConfigId = resolveProjectConfigId(drama.metadata, 'audio')

    if (!drafts.length) {
      throw new BadRequestException('未识别到明确分集标记，请使用“第1集”“第一集”“第1章”“第一章”等格式标注后再分集')
    }

    const ts = new Date()

    if (replaceExisting && existingEpisodes.length > 0) {
      await this.databaseService.db
        .update(episodes)
        .set({ deletedAt: ts, updatedAt: ts })
        .where(and(eq(episodes.dramaId, dramaId), eq(episodes.userId, currentUser.id), isNull(episodes.deletedAt)))
    }

    await this.databaseService.db
      .insert(episodes)
      .values(
        drafts.map((draft, index) => ({
          userId: currentUser.id,
          dramaId,
          episodeNumber: index + 1,
          title: draft.title || titleForEpisode(index + 1),
          content: draft.content,
          imageConfigId: imageConfigId ?? existingEpisodes[index]?.imageConfigId ?? existingEpisodes[0]?.imageConfigId ?? projectImageConfigId ?? null,
          videoConfigId: videoConfigId ?? existingEpisodes[index]?.videoConfigId ?? existingEpisodes[0]?.videoConfigId ?? projectVideoConfigId ?? null,
          audioConfigId: audioConfigId ?? existingEpisodes[index]?.audioConfigId ?? existingEpisodes[0]?.audioConfigId ?? projectAudioConfigId ?? null,
          status: 'draft',
          createdAt: ts,
          updatedAt: ts,
        })),
      )

    await this.databaseService.db
      .update(dramas)
      .set({
        totalEpisodes: drafts.length,
        metadata: JSON.stringify({
          ...parseDramaMetadata(drama.metadata),
          auto_split_at: ts,
          auto_split_episode_count: drafts.length,
          auto_split_mode: splitMode,
        }),
        updatedAt: ts,
      })
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id)))

    const episodeRows = await this.databaseService.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.dramaId, dramaId), eq(episodes.userId, currentUser.id), isNull(episodes.deletedAt)))
      .orderBy(episodes.episodeNumber)

    return {
      count: drafts.length,
      split_mode: splitMode,
      episodes: toSnakeCaseArrayWithPublicMedia(episodeRows as unknown as Record<string, unknown>[], episodeMediaFields),
    }
  }

  @Get(':id')
  async getDrama(@Req() request: FastifyRequest, @Param('id') id: string) {
    const dramaId = parseDramaId(id)
    const session = await this.authService.getSession(request)

    if (session?.user) {
      const [owned] = await this.databaseService.db
        .select()
        .from(dramas)
        .where(and(eq(dramas.id, dramaId), eq(dramas.userId, session.user.id), isNull(dramas.deletedAt)))

      if (owned) {
        const [episodeRows, characterRows, sceneRows, propRows] = await Promise.all([
          this.databaseService.db
            .select()
            .from(episodes)
            .where(and(eq(episodes.dramaId, dramaId), eq(episodes.userId, session.user.id), isNull(episodes.deletedAt))),
          this.databaseService.db
            .select()
            .from(characters)
            .where(and(eq(characters.dramaId, dramaId), eq(characters.userId, session.user.id), isNull(characters.deletedAt))),
          this.databaseService.db
            .select()
            .from(scenes)
            .where(and(eq(scenes.dramaId, dramaId), eq(scenes.userId, session.user.id), isNull(scenes.deletedAt))),
          this.databaseService.db
            .select()
            .from(props)
            .where(and(eq(props.dramaId, dramaId), eq(props.userId, session.user.id), isNull(props.deletedAt))),
        ])

        return {
          ...dramaPayloadBase(owned),
          episodes: toSnakeCaseArrayWithPublicMedia(episodeRows as unknown as Record<string, unknown>[], episodeMediaFields),
          characters: toSnakeCaseArrayWithPublicMedia(characterRows as unknown as Record<string, unknown>[], characterMediaFields),
          scenes: toSnakeCaseArrayWithPublicMedia(sceneRows as unknown as Record<string, unknown>[], sceneMediaFields),
          props: toSnakeCaseArrayWithPublicMedia(propRows as unknown as Record<string, unknown>[], propMediaFields),
        }
      }
    }

    const [publicDrama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), isNull(dramas.deletedAt), eq(dramas.isPublic, true)))

    if (!publicDrama) {
      return { error: 'drama_not_found' }
    }

    const [episodeRows, characterRows, sceneRows, propRows] = await Promise.all([
      this.databaseService.db.select().from(episodes).where(and(eq(episodes.dramaId, dramaId), isNull(episodes.deletedAt))),
      this.databaseService.db.select().from(characters).where(and(eq(characters.dramaId, dramaId), isNull(characters.deletedAt))),
      this.databaseService.db.select().from(scenes).where(and(eq(scenes.dramaId, dramaId), isNull(scenes.deletedAt))),
      this.databaseService.db.select().from(props).where(and(eq(props.dramaId, dramaId), isNull(props.deletedAt))),
    ])

    return {
      ...dramaPayloadBase(publicDrama),
      episodes: toSnakeCaseArrayWithPublicMedia(episodeRows as unknown as Record<string, unknown>[], episodeMediaFields),
      characters: toSnakeCaseArrayWithPublicMedia(characterRows as unknown as Record<string, unknown>[], characterMediaFields),
      scenes: toSnakeCaseArrayWithPublicMedia(sceneRows as unknown as Record<string, unknown>[], sceneMediaFields),
      props: toSnakeCaseArrayWithPublicMedia(propRows as unknown as Record<string, unknown>[], propMediaFields),
      read_only: true,
    }
  }

  @Put(':id')
  @UseGuards(SessionAuthGuard)
  async updateDrama(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = parseDramaId(id)
    const payload = dramaUpdateSchema.parse(body)

    const [owned] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id), isNull(dramas.deletedAt)))

    if (!owned) {
      return { error: 'drama_not_found' }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() }
    if (payload.title !== undefined) updates.title = payload.title
    if (payload.description !== undefined) updates.description = payload.description
    if (payload.genre !== undefined) updates.genre = payload.genre
    if (payload.style !== undefined) updates.style = payload.style
    if (payload.status !== undefined) updates.status = payload.status
    if (payload.thumbnail !== undefined) updates.thumbnail = toPublicMediaUrl(payload.thumbnail)
    if (payload.tags !== undefined) updates.tags = JSON.stringify(payload.tags)
    if (payload.metadata !== undefined) updates.metadata = serializeMetadata(payload.metadata)

    await this.databaseService.db
      .update(dramas)
      .set(updates)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id)))

    return { success: true }
  }

  @Delete(':id')
  @UseGuards(SessionAuthGuard)
  async deleteDrama(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const dramaId = parseDramaId(id)

    const [owned] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id), isNull(dramas.deletedAt)))

    if (!owned) {
      return { error: 'drama_not_found' }
    }

    await this.databaseService.db
      .update(dramas)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id)))

    return { success: true }
  }
}
