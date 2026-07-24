import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm'

import type { DatabaseService } from '../../db/database.service'
import {
  dramaEntityAliases,
  dramaGraphEntities,
  dramaGraphEvents,
  dramaGraphRelations,
  dramaStoryGraphs,
} from '../../db/schema'

function parseJsonArray(value: string | null | undefined) {
  if (!value) return [] as unknown[]
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function loadEpisodeCastGraphContext(
  databaseService: DatabaseService,
  dramaId: number,
  episodeNumber: number,
) {
  const [graph] = await databaseService.db
    .select()
    .from(dramaStoryGraphs)
    .where(and(
      eq(dramaStoryGraphs.dramaId, dramaId),
      isNull(dramaStoryGraphs.deletedAt),
      eq(dramaStoryGraphs.status, 'ready'),
    ))
    .orderBy(desc(dramaStoryGraphs.version), desc(dramaStoryGraphs.updatedAt))
    .limit(1)

  if (!graph) return null

  const eventRows = await databaseService.db
    .select({ involvedEntityIdsJson: dramaGraphEvents.involvedEntityIdsJson })
    .from(dramaGraphEvents)
    .where(and(eq(dramaGraphEvents.graphId, graph.id), eq(dramaGraphEvents.episodeNumber, episodeNumber)))

  const entityIds = Array.from(new Set(
    eventRows.flatMap((row) => parseJsonArray(row.involvedEntityIdsJson) as number[]),
  ))

  const entityRows = entityIds.length
    ? await databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(and(
        eq(dramaGraphEntities.graphId, graph.id),
        eq(dramaGraphEntities.entityType, 'character'),
        isNull(dramaGraphEntities.deletedAt),
        inArray(dramaGraphEntities.id, entityIds),
      ))
    : await databaseService.db
      .select()
      .from(dramaGraphEntities)
      .where(and(
        eq(dramaGraphEntities.graphId, graph.id),
        eq(dramaGraphEntities.entityType, 'character'),
        isNull(dramaGraphEntities.deletedAt),
      ))
      .orderBy(desc(dramaGraphEntities.importance))
      .limit(12)

  const ids = entityRows.map((row) => row.id)
  const relationRows = ids.length
    ? await databaseService.db
      .select()
      .from(dramaGraphRelations)
      .where(and(
        eq(dramaGraphRelations.graphId, graph.id),
        isNull(dramaGraphRelations.deletedAt),
        or(
          inArray(dramaGraphRelations.subjectEntityId, ids),
          inArray(dramaGraphRelations.objectEntityId, ids),
        ),
      ))
    : []

  const aliasRows = ids.length
    ? await databaseService.db
      .select()
      .from(dramaEntityAliases)
      .where(and(eq(dramaEntityAliases.graphId, graph.id), inArray(dramaEntityAliases.entityId, ids)))
    : []

  const aliasesByEntity = new Map<number, string[]>()
  for (const alias of aliasRows) {
    const bucket = aliasesByEntity.get(alias.entityId) || []
    bucket.push(alias.alias)
    aliasesByEntity.set(alias.entityId, bucket)
  }

  return {
    graph_id: graph.id,
    episode_number: episodeNumber,
    characters: entityRows.map((row) => ({
      entity_id: row.id,
      character_id: row.linkedCharacterId,
      name: row.canonicalName,
      role: row.role,
      aliases: aliasesByEntity.get(row.id) || [],
    })),
    relations: relationRows.map((row) => ({
      subject_entity_id: row.subjectEntityId,
      object_entity_id: row.objectEntityId,
      predicate: row.predicate,
      relation_type: row.relationType,
    })),
  }
}
