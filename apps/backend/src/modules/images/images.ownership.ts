import { NotFoundException } from '@nestjs/common'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'

import type { DatabaseService } from '../../db/database.service'
import { characters, dramas, episodes, imageGenerations, scenes, storyboardCharacters, storyboards } from '../../db/schema'

export async function requireOwnedDrama(databaseService: DatabaseService, dramaId: number, userId: number) {
  const [drama] = await databaseService.db
    .select()
    .from(dramas)
    .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId), isNull(dramas.deletedAt)))
  if (!drama) throw new NotFoundException('drama_not_found')
  return drama
}

export async function requireOwnedEpisode(databaseService: DatabaseService, episodeId: number, userId: number) {
  const [episode] = await databaseService.db
    .select()
    .from(episodes)
    .where(and(eq(episodes.id, episodeId), eq(episodes.userId, userId), isNull(episodes.deletedAt)))
  if (!episode) throw new NotFoundException('episode_not_found')
  return episode
}

export async function requireOwnedScene(databaseService: DatabaseService, sceneId: number, userId: number) {
  const [scene] = await databaseService.db
    .select()
    .from(scenes)
    .where(and(eq(scenes.id, sceneId), eq(scenes.userId, userId), isNull(scenes.deletedAt)))
  if (!scene) throw new NotFoundException('scene_not_found')
  return scene
}

export async function requireOwnedCharacter(databaseService: DatabaseService, characterId: number, userId: number) {
  const [character] = await databaseService.db
    .select()
    .from(characters)
    .where(and(eq(characters.id, characterId), eq(characters.userId, userId), isNull(characters.deletedAt)))
  if (!character) throw new NotFoundException('character_not_found')
  return character
}

export async function requireOwnedStoryboard(databaseService: DatabaseService, storyboardId: number, userId: number) {
  const [storyboard] = await databaseService.db
    .select()
    .from(storyboards)
    .where(
      and(
        eq(storyboards.id, storyboardId),
        or(eq(storyboards.userId, userId), isNull(storyboards.userId)),
        isNull(storyboards.deletedAt),
      ),
    )
  if (!storyboard) throw new NotFoundException('storyboard_not_found')

  await requireOwnedEpisode(databaseService, storyboard.episodeId, userId)

  if (storyboard.userId == null) {
    await databaseService.db
      .update(storyboards)
      .set({ userId, updatedAt: new Date() })
      .where(eq(storyboards.id, storyboardId))
    storyboard.userId = userId
  }

  return storyboard
}

export async function loadOwnedImageGeneration(databaseService: DatabaseService, generationId: number, userId: number) {
  const [row] = await databaseService.db
    .select()
    .from(imageGenerations)
    .where(and(eq(imageGenerations.id, generationId), eq(imageGenerations.userId, userId)))
  return row || null
}

export async function loadStoryboardCharacterIdsMap(databaseService: DatabaseService, storyboardIds: number[]) {
  const map = new Map<number, number[]>()
  if (!storyboardIds.length) return map

  const links = await databaseService.db
    .select()
    .from(storyboardCharacters)
    .where(inArray(storyboardCharacters.storyboardId, storyboardIds))

  for (const link of links) {
    const current = map.get(link.storyboardId) || []
    current.push(link.characterId)
    map.set(link.storyboardId, current)
  }
  return map
}
