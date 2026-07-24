import { Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import {
  dramaGraphEntities,
  dramaGraphEvents,
  dramaGraphIndexChunks,
  dramaGraphRelations,
  dramaStoryGraphs,
  writingKnowledgeCards,
} from '../../db/schema'
import { DramaStoryGraphEmbeddingService } from './drama-story-graph-embedding.service'
import {
  blendSearchScore,
  cosineSimilarity,
  keywordScore,
} from './drama-story-graph-embedding.utils'
import {
  hashChunkContent,
  splitScriptIntoChunks,
} from './drama-story-graph-writing-preseed'

type ChunkDraft = {
  chunkKind: string
  refId: number | null
  refType: string | null
  episodeNumber: number | null
  title: string | null
  content: string
  metadata?: Record<string, unknown>
}

function compactText(value: string, max = 180) {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`
}

function parseEmbeddingJson(value: string | null | undefined) {
  if (!value) return [] as number[]
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => Number(item)).filter((item) => Number.isFinite(item))
  } catch {
    return []
  }
}

function parseMetadataJson(value: string | null | undefined) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

@Injectable()
export class DramaStoryGraphIndexService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(DramaStoryGraphEmbeddingService) private readonly embeddingService: DramaStoryGraphEmbeddingService,
  ) {}

  async getIndexStatus(graphId: number, dramaId: number, userId: number) {
    const rows = await this.databaseService.db
      .select({
        chunkKind: dramaGraphIndexChunks.chunkKind,
        count: sql<number>`count(*)::int`,
      })
      .from(dramaGraphIndexChunks)
      .where(and(
        eq(dramaGraphIndexChunks.graphId, graphId),
        eq(dramaGraphIndexChunks.dramaId, dramaId),
        eq(dramaGraphIndexChunks.userId, userId),
      ))
      .groupBy(dramaGraphIndexChunks.chunkKind)

    const [latest] = await this.databaseService.db
      .select({
        embeddingModel: dramaGraphIndexChunks.embeddingModel,
        updatedAt: dramaGraphIndexChunks.updatedAt,
      })
      .from(dramaGraphIndexChunks)
      .where(eq(dramaGraphIndexChunks.graphId, graphId))
      .orderBy(desc(dramaGraphIndexChunks.updatedAt))
      .limit(1)

    const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0)
    return {
      total_chunks: total,
      by_kind: Object.fromEntries(rows.map((row) => [row.chunkKind, row.count])),
      embedding_model: latest?.embeddingModel || null,
      updated_at: latest?.updatedAt || null,
      pgvector_enabled: await this.isPgvectorEnabled(),
    }
  }

  async rebuildIndex(input: {
    graphId: number
    dramaId: number
    userId: number
    scriptEpisodes?: Array<{ id: number; episodeNumber: number; scriptContent: string }>
    writingId?: number | null
  }) {
    const drafts: ChunkDraft[] = []

    const entityRows = await this.databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(and(
        eq(dramaGraphEntities.graphId, input.graphId),
        isNull(dramaGraphEntities.deletedAt),
      ))

    for (const entity of entityRows) {
      drafts.push({
        chunkKind: 'entity',
        refId: entity.id,
        refType: 'entity',
        episodeNumber: null,
        title: entity.displayName || entity.canonicalName,
        content: [
          entity.canonicalName,
          entity.displayName,
          entity.role,
          entity.description,
        ].filter(Boolean).join('\n'),
        metadata: {
          entity_type: entity.entityType,
          entity_id: entity.id,
        },
      })
    }

    const relationRows = await this.databaseService.db
      .select()
      .from(dramaGraphRelations)
      .where(and(
        eq(dramaGraphRelations.graphId, input.graphId),
        isNull(dramaGraphRelations.deletedAt),
      ))

    const entityNameById = new Map(entityRows.map((row) => [row.id, row.canonicalName]))
    for (const relation of relationRows) {
      const subjectName = entityNameById.get(relation.subjectEntityId) || '未知主体'
      const objectName = entityNameById.get(relation.objectEntityId) || '未知客体'
      drafts.push({
        chunkKind: 'relation',
        refId: relation.id,
        refType: 'relation',
        episodeNumber: null,
        title: `${subjectName} → ${objectName}`,
        content: [
          subjectName,
          relation.predicate,
          objectName,
          relation.relationType,
          relation.description,
        ].filter(Boolean).join('\n'),
        metadata: {
          relation_id: relation.id,
          subject_entity_id: relation.subjectEntityId,
          object_entity_id: relation.objectEntityId,
        },
      })
    }

    const eventRows = await this.databaseService.db
      .select()
      .from(dramaGraphEvents)
      .where(eq(dramaGraphEvents.graphId, input.graphId))

    for (const event of eventRows) {
      drafts.push({
        chunkKind: 'event',
        refId: event.id,
        refType: 'event',
        episodeNumber: event.episodeNumber ?? null,
        title: event.title,
        content: [
          event.title,
          event.summary,
          event.emotionalTone,
          event.episodeNumber ? `第${event.episodeNumber}集` : null,
        ].filter(Boolean).join('\n'),
        metadata: {
          event_id: event.id,
          episode_number: event.episodeNumber,
        },
      })
    }

    for (const episode of input.scriptEpisodes || []) {
      const chunks = splitScriptIntoChunks(episode.scriptContent)
      chunks.forEach((chunk, index) => {
        drafts.push({
          chunkKind: 'script_span',
          refId: episode.id * 10_000 + index,
          refType: 'episode_script',
          episodeNumber: episode.episodeNumber,
          title: `第${episode.episodeNumber}集 · 片段 ${index + 1}`,
          content: chunk,
          metadata: {
            episode_id: episode.id,
            episode_number: episode.episodeNumber,
            chunk_index: index,
          },
        })
      })
    }

    if (input.writingId) {
      const cardRows = await this.databaseService.db
        .select()
        .from(writingKnowledgeCards)
        .where(and(
          eq(writingKnowledgeCards.writingId, input.writingId),
          eq(writingKnowledgeCards.userId, input.userId),
          isNull(writingKnowledgeCards.deletedAt),
        ))

      for (const card of cardRows) {
        drafts.push({
          chunkKind: 'writing_card',
          refId: card.id,
          refType: 'writing_knowledge_card',
          episodeNumber: null,
          title: card.title,
          content: [card.title, card.cardType, card.content].filter(Boolean).join('\n'),
          metadata: {
            writing_id: input.writingId,
            card_type: card.cardType,
            knowledge_card_id: card.id,
          },
        })
      }
    }

    const filteredDrafts = drafts
      .map((draft) => ({ ...draft, content: draft.content.trim() }))
      .filter((draft) => draft.content.length > 0)

    await this.databaseService.db
      .delete(dramaGraphIndexChunks)
      .where(eq(dramaGraphIndexChunks.graphId, input.graphId))

    if (!filteredDrafts.length) {
      return { chunk_count: 0, embedding_model: null }
    }

    const embeddingResult = await this.embeddingService.embedTexts(
      input.userId,
      filteredDrafts.map((draft) => draft.content),
    )
    const timestamp = new Date()
    const pgvectorEnabled = await this.isPgvectorEnabled()

    for (let index = 0; index < filteredDrafts.length; index += 1) {
      const draft = filteredDrafts[index]
      const vector = embeddingResult.vectors[index] || []
      const contentHash = hashChunkContent(draft.content)
      const metadataJson = JSON.stringify(draft.metadata || {})
      const embeddingJson = JSON.stringify(vector)

      const [inserted] = await this.databaseService.db
        .insert(dramaGraphIndexChunks)
        .values({
          graphId: input.graphId,
          dramaId: input.dramaId,
          userId: input.userId,
          chunkKind: draft.chunkKind,
          refId: draft.refId,
          refType: draft.refType,
          episodeNumber: draft.episodeNumber,
          title: draft.title,
          content: draft.content,
          contentHash,
          embeddingModel: embeddingResult.model,
          embeddingJson,
          metadataJson,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning()

      if (pgvectorEnabled && vector.length) {
        const literal = `[${vector.join(',')}]`
        await this.databaseService.db.execute(sql`
          UPDATE drama_graph_index_chunks
          SET embedding = ${literal}::vector
          WHERE id = ${inserted.id}
        `)
      }
    }

    const [graph] = await this.databaseService.db
      .select({ statsJson: dramaStoryGraphs.statsJson })
      .from(dramaStoryGraphs)
      .where(eq(dramaStoryGraphs.id, input.graphId))
      .limit(1)

    let stats: Record<string, unknown> = {}
    try {
      stats = JSON.parse(graph?.statsJson || '{}') as Record<string, unknown>
    } catch {
      stats = {}
    }

    await this.databaseService.db
      .update(dramaStoryGraphs)
      .set({
        statsJson: JSON.stringify({
          ...stats,
          search_index: {
            chunk_count: filteredDrafts.length,
            embedding_model: embeddingResult.model,
            updated_at: timestamp.toISOString(),
          },
        }),
        updatedAt: timestamp,
      })
      .where(eq(dramaStoryGraphs.id, input.graphId))

    return {
      chunk_count: filteredDrafts.length,
      embedding_model: embeddingResult.model,
    }
  }

  async search(input: {
    graphId: number
    dramaId: number
    userId: number
    query: string
    kinds?: string[]
    limit?: number
  }) {
    const query = String(input.query || '').trim()
    if (!query) {
      return {
        query,
        mode: 'empty' as const,
        embedding_model: null,
        items: [],
      }
    }

    const limit = Math.min(Math.max(input.limit || 12, 1), 40)
    const kinds = input.kinds?.length ? input.kinds : undefined
    const pgvectorEnabled = await this.isPgvectorEnabled()

    if (pgvectorEnabled) {
      try {
        const vectorResult = await this.searchWithPgvector(input, query, limit, kinds)
        if (vectorResult.items.length) return vectorResult
      } catch {
        // fall back to json cosine search
      }
    }

    const { vector, model } = await this.embeddingService.embedQuery(input.userId, query)
    const rows = await this.databaseService.db
      .select()
      .from(dramaGraphIndexChunks)
      .where(and(
        eq(dramaGraphIndexChunks.graphId, input.graphId),
        eq(dramaGraphIndexChunks.dramaId, input.dramaId),
        eq(dramaGraphIndexChunks.userId, input.userId),
        kinds ? inArray(dramaGraphIndexChunks.chunkKind, kinds) : undefined,
      ))

    const ranked = rows
      .map((row) => {
        const embedding = parseEmbeddingJson(row.embeddingJson)
        const semantic = embedding.length ? cosineSimilarity(vector, embedding) : 0
        const keyword = keywordScore(query, row.content)
        const score = blendSearchScore(semantic, keyword)
        const metadata = parseMetadataJson(row.metadataJson)
        return {
          chunk_id: row.id,
          chunk_kind: row.chunkKind,
          ref_id: row.refId,
          ref_type: row.refType,
          episode_number: row.episodeNumber,
          title: row.title,
          snippet: compactText(row.content, 220),
          score,
          entity_id: typeof metadata.entity_id === 'number' ? metadata.entity_id : null,
          relation_id: typeof metadata.relation_id === 'number' ? metadata.relation_id : null,
          event_id: typeof metadata.event_id === 'number' ? metadata.event_id : null,
        }
      })
      .filter((item) => item.score > 0.05)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)

    return {
      query,
      mode: ranked.length ? 'semantic' as const : 'keyword' as const,
      embedding_model: model,
      items: ranked,
    }
  }

  private async searchWithPgvector(
    input: {
      graphId: number
      dramaId: number
      userId: number
      kinds?: string[]
    },
    query: string,
    limit: number,
    kinds?: string[],
  ) {
    const { vector, model } = await this.embeddingService.embedQuery(input.userId, query)
    const literal = `[${vector.join(',')}]`
    const kindFilter = kinds?.length
      ? sql`AND chunk_kind IN (${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)})`
      : sql``

    const result = await this.databaseService.db.execute(sql`
      SELECT
        id,
        chunk_kind,
        ref_id,
        ref_type,
        episode_number,
        title,
        content,
        metadata_json,
        1 - (embedding <=> ${literal}::vector) AS score
      FROM drama_graph_index_chunks
      WHERE graph_id = ${input.graphId}
        AND drama_id = ${input.dramaId}
        AND user_id = ${input.userId}
        AND embedding IS NOT NULL
        ${kindFilter}
      ORDER BY embedding <=> ${literal}::vector
      LIMIT ${limit}
    `)

    const rows = Array.isArray(result.rows) ? result.rows : []
    const items = rows.map((row) => {
      const metadata = parseMetadataJson(String((row as Record<string, unknown>).metadata_json || '{}'))
      return {
        chunk_id: Number((row as Record<string, unknown>).id),
        chunk_kind: String((row as Record<string, unknown>).chunk_kind || ''),
        ref_id: Number((row as Record<string, unknown>).ref_id || 0) || null,
        ref_type: String((row as Record<string, unknown>).ref_type || '') || null,
        episode_number: Number((row as Record<string, unknown>).episode_number || 0) || null,
        title: String((row as Record<string, unknown>).title || '') || null,
        snippet: compactText(String((row as Record<string, unknown>).content || ''), 220),
        score: Number((row as Record<string, unknown>).score || 0),
        entity_id: typeof metadata.entity_id === 'number' ? metadata.entity_id : null,
        relation_id: typeof metadata.relation_id === 'number' ? metadata.relation_id : null,
        event_id: typeof metadata.event_id === 'number' ? metadata.event_id : null,
      }
    })

    return {
      query,
      mode: 'semantic' as const,
      embedding_model: model,
      items,
    }
  }

  private async isPgvectorEnabled() {
    try {
      const result = await this.databaseService.db.execute(sql`
        SELECT 1
        FROM pg_extension
        WHERE extname = 'vector'
        LIMIT 1
      `)
      return Array.isArray(result.rows) && result.rows.length > 0
    } catch {
      return false
    }
  }

  async loadWritingKnowledgeCards(writingId: number, userId: number) {
    return this.databaseService.db
      .select({
        id: writingKnowledgeCards.id,
        cardType: writingKnowledgeCards.cardType,
        title: writingKnowledgeCards.title,
        content: writingKnowledgeCards.content,
      })
      .from(writingKnowledgeCards)
      .where(and(
        eq(writingKnowledgeCards.writingId, writingId),
        eq(writingKnowledgeCards.userId, userId),
        isNull(writingKnowledgeCards.deletedAt),
      ))
  }
}
