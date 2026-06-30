import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'

import { toSnakeCaseArrayWithPublicMedia, toSnakeCaseWithPublicMedia } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import {
  characters,
  episodeCharacters,
  episodes,
  episodeScenes,
  storyboardCharacters,
  storyboards,
} from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'

const storyboardMediaFields = {
  urlFields: ['composedImage', 'firstFrameImage', 'lastFrameImage', 'videoUrl', 'ttsAudioUrl', 'subtitleUrl', 'composedVideoUrl'],
  jsonArrayFields: ['referenceImages'],
} as const
const characterMediaFields = { urlFields: ['imageUrl', 'voiceSampleUrl'], jsonArrayFields: ['referenceImages'] } as const

function now() {
  return new Date()
}

function parseId(value: string, label: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException(`invalid ${label}`)
  }
  return id
}

function toOptionalString(value: unknown) {
  if (value == null || value === '') return null
  return String(value)
}

function toOptionalNumber(value: unknown) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('invalid number value')
  }
  return parsed
}

function toNumberArray(value: unknown) {
  if (value == null) return []
  if (!Array.isArray(value)) {
    throw new BadRequestException('character_ids must be an array')
  }

  return value
    .map((item) => {
      const parsed = typeof item === 'number' ? item : typeof item === 'string' ? Number(item) : NaN
      if (!Number.isFinite(parsed)) {
        throw new BadRequestException('character_ids must contain numbers')
      }
      return parsed
    })
    .filter((item, index, arr) => arr.indexOf(item) === index)
}

@ApiTags('storyboards')
@Controller()
@UseGuards(SessionAuthGuard)
export class StoryboardsController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  private async requireOwnedEpisode(episodeId: number, userId: number) {
    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), eq(episodes.userId, userId), isNull(episodes.deletedAt)))

    if (!episode) {
      throw new NotFoundException('episode_not_found')
    }

    return episode
  }

  private async requireOwnedStoryboard(storyboardId: number, userId: number) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(
        and(
          eq(storyboards.id, storyboardId),
          or(eq(storyboards.userId, userId), isNull(storyboards.userId)),
          isNull(storyboards.deletedAt),
        ),
      )

    if (!storyboard) {
      throw new NotFoundException('storyboard_not_found')
    }

    await this.requireOwnedEpisode(storyboard.episodeId, userId)

    if (storyboard.userId == null) {
      await this.databaseService.db
        .update(storyboards)
        .set({ userId, updatedAt: now() })
        .where(eq(storyboards.id, storyboardId))
      storyboard.userId = userId
    }

    return storyboard
  }

  private async syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
    await this.databaseService.db
      .delete(storyboardCharacters)
      .where(eq(storyboardCharacters.storyboardId, storyboardId))

    if (!characterIds.length) return

    await this.databaseService.db.insert(storyboardCharacters).values(
      characterIds.map((characterId) => ({
        storyboardId,
        characterId,
      })),
    )
  }

  private async getStoryboardCharacterIdsMap(storyboardIds: number[]) {
    const map = new Map<number, number[]>()
    if (!storyboardIds.length) return map

    const links = await this.databaseService.db
      .select()
      .from(storyboardCharacters)
      .where(inArray(storyboardCharacters.storyboardId, storyboardIds))

    for (const link of links) {
      const arr = map.get(link.storyboardId) || []
      arr.push(link.characterId)
      map.set(link.storyboardId, arr)
    }

    return map
  }

  private async validateStoryboardBindings(episodeId: number, sceneId: number | null, characterIds: number[]) {
    const [sceneLinks, characterLinks] = await Promise.all([
      this.databaseService.db
        .select()
        .from(episodeScenes)
        .where(eq(episodeScenes.episodeId, episodeId)),
      this.databaseService.db
        .select()
        .from(episodeCharacters)
        .where(eq(episodeCharacters.episodeId, episodeId)),
    ])

    const episodeSceneIds = new Set(sceneLinks.map((link) => link.sceneId))
    const episodeCharacterIds = new Set(characterLinks.map((link) => link.characterId))

    if (sceneId != null && !episodeSceneIds.has(sceneId)) {
      throw new BadRequestException('scene_id 必须来自当前集已关联场景')
    }

    const invalidCharacterIds = characterIds.filter((characterId) => !episodeCharacterIds.has(characterId))
    if (invalidCharacterIds.length) {
      throw new BadRequestException('character_ids 必须来自当前集已关联角色')
    }
  }

  @Get('episodes/:id/storyboards')
  async listEpisodeStoryboards(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parseId(id, 'episode id')
    await this.requireOwnedEpisode(episodeId, currentUser.id)

    const rows = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(
        and(
          eq(storyboards.episodeId, episodeId),
          or(eq(storyboards.userId, currentUser.id), isNull(storyboards.userId)),
          isNull(storyboards.deletedAt),
        ),
      )

    for (const row of rows) {
      if (row.userId == null) {
        await this.databaseService.db
          .update(storyboards)
          .set({ userId: currentUser.id, updatedAt: now() })
          .where(eq(storyboards.id, row.id))
        row.userId = currentUser.id
      }
    }

    rows.sort((a, b) => a.storyboardNumber - b.storyboardNumber)

    const [storyboardCharacterIds, episodeCharacterLinks] = await Promise.all([
      this.getStoryboardCharacterIdsMap(rows.map((row) => row.id)),
      this.databaseService.db
        .select()
        .from(episodeCharacters)
        .where(eq(episodeCharacters.episodeId, episodeId)),
    ])

    const episodeCharacterIdsSet = new Set(episodeCharacterLinks.map((link) => link.characterId))
    const allCharacters = (await this.databaseService.db
      .select()
      .from(characters)
      .where(and(eq(characters.userId, currentUser.id), isNull(characters.deletedAt))))
      .filter((character) => episodeCharacterIdsSet.has(character.id))

    return rows.map((row) => ({
      ...toSnakeCaseWithPublicMedia(row as unknown as Record<string, unknown>, storyboardMediaFields),
      character_ids: storyboardCharacterIds.get(row.id) || [],
      characters: toSnakeCaseArrayWithPublicMedia(
        allCharacters
          .filter((character) => (storyboardCharacterIds.get(row.id) || []).includes(character.id))
          .map((character) => character as unknown as Record<string, unknown>),
        characterMediaFields,
      ),
    }))
  }

  @Post('storyboards')
  async createStoryboard(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = toOptionalNumber(body.episode_id)
    const storyboardNumber = toOptionalNumber(body.storyboard_number ?? 1)

    if (episodeId == null) {
      throw new BadRequestException('episode_id required')
    }

    if (storyboardNumber == null) {
      throw new BadRequestException('storyboard_number required')
    }

    await this.requireOwnedEpisode(episodeId, currentUser.id)

    const characterIds = toNumberArray(body.character_ids)
    const sceneId = toOptionalNumber(body.scene_id)
    await this.validateStoryboardBindings(episodeId, sceneId, characterIds)

    const ts = now()
    const [storyboard] = await this.databaseService.db
      .insert(storyboards)
      .values({
        userId: currentUser.id,
        episodeId,
        storyboardNumber,
        title: toOptionalString(body.title),
        description: toOptionalString(body.description),
        shotType: toOptionalString(body.shot_type),
        angle: toOptionalString(body.angle),
        movement: toOptionalString(body.movement),
        action: toOptionalString(body.action),
        dialogue: toOptionalString(body.dialogue),
        duration: toOptionalNumber(body.duration) ?? 10,
        videoPrompt: toOptionalString(body.video_prompt),
        imagePrompt: toOptionalString(body.image_prompt),
        sceneId,
        location: toOptionalString(body.location),
        time: toOptionalString(body.time),
        atmosphere: toOptionalString(body.atmosphere),
        result: toOptionalString(body.result),
        bgmPrompt: toOptionalString(body.bgm_prompt),
        soundEffect: toOptionalString(body.sound_effect),
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    await this.syncStoryboardCharacters(storyboard.id, characterIds)

    return {
      ...toSnakeCaseWithPublicMedia(storyboard as unknown as Record<string, unknown>, storyboardMediaFields),
      character_ids: characterIds,
    }
  }

  @Put('storyboards/:id')
  async updateStoryboard(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const storyboardId = parseId(id, 'storyboard id')
    const storyboard = await this.requireOwnedStoryboard(storyboardId, currentUser.id)

    const updates: Record<string, unknown> = {
      updatedAt: now(),
    }
    let hasUpdates = false

    if (Object.prototype.hasOwnProperty.call(body, 'title')) {
      updates.title = toOptionalString(body.title)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'description')) {
      updates.description = toOptionalString(body.description)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'shot_type')) {
      updates.shotType = toOptionalString(body.shot_type)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'angle')) {
      updates.angle = toOptionalString(body.angle)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'movement')) {
      updates.movement = toOptionalString(body.movement)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'action')) {
      updates.action = toOptionalString(body.action)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'dialogue')) {
      updates.dialogue = toOptionalString(body.dialogue)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'duration')) {
      updates.duration = toOptionalNumber(body.duration)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'video_prompt')) {
      updates.videoPrompt = toOptionalString(body.video_prompt)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'image_prompt')) {
      updates.imagePrompt = toOptionalString(body.image_prompt)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'scene_id')) {
      updates.sceneId = toOptionalNumber(body.scene_id)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'location')) {
      updates.location = toOptionalString(body.location)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'time')) {
      updates.time = toOptionalString(body.time)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'atmosphere')) {
      updates.atmosphere = toOptionalString(body.atmosphere)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'result')) {
      updates.result = toOptionalString(body.result)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'bgm_prompt')) {
      updates.bgmPrompt = toOptionalString(body.bgm_prompt)
      hasUpdates = true
    }
    if (Object.prototype.hasOwnProperty.call(body, 'sound_effect')) {
      updates.soundEffect = toOptionalString(body.sound_effect)
      hasUpdates = true
    }

    if (Object.prototype.hasOwnProperty.call(body, 'dialogue')) {
      updates.ttsAudioUrl = null
      updates.subtitleUrl = null
    }

    const characterIds = Object.prototype.hasOwnProperty.call(body, 'character_ids')
      ? toNumberArray(body.character_ids)
      : (await this.getStoryboardCharacterIdsMap([storyboardId])).get(storyboardId) || []

    const sceneId = Object.prototype.hasOwnProperty.call(body, 'scene_id')
      ? toOptionalNumber(body.scene_id)
      : storyboard.sceneId

    await this.validateStoryboardBindings(storyboard.episodeId, sceneId, characterIds)

    if (!hasUpdates && !Object.prototype.hasOwnProperty.call(body, 'character_ids')) {
      throw new BadRequestException('no valid fields')
    }

    await this.databaseService.db
      .update(storyboards)
      .set(updates)
      .where(and(eq(storyboards.id, storyboardId), eq(storyboards.userId, currentUser.id)))

    if (Object.prototype.hasOwnProperty.call(body, 'character_ids')) {
      await this.syncStoryboardCharacters(storyboardId, characterIds)
    }

    return { success: true }
  }

  @Delete('storyboards/:id')
  async deleteStoryboard(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const storyboardId = parseId(id, 'storyboard id')
    await this.requireOwnedStoryboard(storyboardId, currentUser.id)

    await this.databaseService.db
      .delete(storyboardCharacters)
      .where(eq(storyboardCharacters.storyboardId, storyboardId))

    await this.databaseService.db
      .delete(storyboards)
      .where(and(eq(storyboards.id, storyboardId), eq(storyboards.userId, currentUser.id)))

    return { success: true }
  }
}
