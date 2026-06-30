import { BadRequestException, Body, Controller, Delete, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'
import { ApiTags } from '@nestjs/swagger'

import { DatabaseService } from '../../db/database.service'
import { characters, episodes } from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { ImagesService } from '../images/images.service'

function now() {
  return new Date()
}

function parseId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException('invalid character id')
  }
  return id
}

const characterFields = ['name', 'role', 'description', 'appearance', 'personality', 'voiceStyle', 'voiceProvider', 'imageUrl'] as const
@ApiTags('characters')
@Controller('characters')
@UseGuards(SessionAuthGuard)
export class CharactersController {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly imagesService: ImagesService,
  ) {}

  @Post('batch-generate-images')
  async batchGenerateCharacterImages(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const ids = Array.isArray(body.character_ids)
      ? body.character_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
      : []
    const episodeId = Number(body.episode_id)

    if (!Number.isInteger(episodeId) || episodeId <= 0) {
      throw new BadRequestException('episode_id is required')
    }

    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.id, episodeId), eq(episodes.userId, currentUser.id), isNull(episodes.deletedAt)))

    if (!episode) {
      throw new NotFoundException('episode_not_found')
    }

    const startedIds: number[] = []
    for (const characterId of ids) {
      const [character] = await this.databaseService.db
        .select()
        .from(characters)
        .where(and(eq(characters.id, characterId), eq(characters.userId, currentUser.id), isNull(characters.deletedAt)))

      if (!character) continue

      const params = await this.imagesService.buildImageRequest({
        episode_id: episodeId,
        character_id: characterId,
      }, currentUser.id)

      const generationId = await this.imagesService.enqueueImageGeneration(params)
      startedIds.push(generationId)
    }

    return {
      count: startedIds.length,
      ids: startedIds,
      status: 'queued',
    }
  }

  @Put(':id')
  async updateCharacter(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const characterId = parseId(id)

    const [character] = await this.databaseService.db
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.userId, currentUser.id), isNull(characters.deletedAt)))

    if (!character) {
      throw new NotFoundException('Character not found')
    }

    const updates: Record<string, unknown> = { updatedAt: now() }
    let hasUpdates = false

    for (const key of characterFields) {
      const snakeKey = key.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`)
      if (Object.prototype.hasOwnProperty.call(body, snakeKey)) {
        updates[key] = body[snakeKey]
        hasUpdates = true
      } else if (Object.prototype.hasOwnProperty.call(body, key)) {
        updates[key] = body[key]
        hasUpdates = true
      }
    }

    if (Object.prototype.hasOwnProperty.call(body, 'voice_style') || Object.prototype.hasOwnProperty.call(body, 'voiceStyle')) {
      updates.voiceSampleUrl = null
    }

    if (!hasUpdates) {
      throw new BadRequestException('no valid fields')
    }

    await this.databaseService.db
      .update(characters)
      .set(updates)
      .where(eq(characters.id, characterId))

    return { success: true }
  }

  @Delete(':id')
  async deleteCharacter(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const characterId = parseId(id)

    const [character] = await this.databaseService.db
      .select()
      .from(characters)
      .where(and(eq(characters.id, characterId), eq(characters.userId, currentUser.id), isNull(characters.deletedAt)))

    if (!character) {
      throw new NotFoundException('Character not found')
    }

    await this.databaseService.db
      .update(characters)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(characters.id, characterId))

    return { success: true }
  }
}
