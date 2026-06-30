import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { and, eq, inArray, isNull, or } from 'drizzle-orm'
import { ApiTags } from '@nestjs/swagger'

import { toSnakeCaseArrayWithPublicMedia, toSnakeCaseWithPublicMedia } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import { episodeScenes, scenes } from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { requireOwnedDrama, requireOwnedEpisode, requireOwnedScene } from '../images/images.ownership'

const sceneMediaFields = { urlFields: ['imageUrl'] } as const

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

function toRequiredNumber(value: unknown, field: string) {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException(`${field} required`)
  }
  return parsed
}

function toOptionalNumber(value: unknown) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) {
    throw new BadRequestException('invalid number value')
  }
  return parsed
}

@ApiTags('scenes')
@Controller()
@UseGuards(SessionAuthGuard)
export class ScenesController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get('episodes/:id/scenes')
  async listEpisodeScenes(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parseId(id, 'episode id')
    await requireOwnedEpisode(this.databaseService, episodeId, currentUser.id)

    const links = await this.databaseService.db
      .select()
      .from(episodeScenes)
      .where(eq(episodeScenes.episodeId, episodeId))
    const sceneIds = links.map((link) => link.sceneId)
    if (!sceneIds.length) return []

    const rows = await this.databaseService.db
      .select()
      .from(scenes)
      .where(
        and(
          inArray(scenes.id, sceneIds),
          or(eq(scenes.userId, currentUser.id), isNull(scenes.userId)),
          isNull(scenes.deletedAt),
        ),
      )

    return toSnakeCaseArrayWithPublicMedia(rows as unknown as Record<string, unknown>[], sceneMediaFields)
  }

  @Get('scenes')
  async listScenes(
    @Query('drama_id') dramaId: string | undefined,
    @Query('episode_id') episodeId: string | undefined,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    let rows = await this.databaseService.db
      .select()
      .from(scenes)
      .where(and(eq(scenes.userId, currentUser.id), isNull(scenes.deletedAt)))

    if (dramaId) rows = rows.filter((row) => row.dramaId === Number(dramaId))
    if (episodeId) rows = rows.filter((row) => row.episodeId === Number(episodeId))

    return {
      items: toSnakeCaseArrayWithPublicMedia(rows as unknown as Record<string, unknown>[], sceneMediaFields),
      total: rows.length,
    }
  }

  @Post('scenes')
  async createScene(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = toRequiredNumber(body.drama_id, 'drama_id')
    const episodeId = toOptionalNumber(body.episode_id)
    const ts = now()

    await requireOwnedDrama(this.databaseService, dramaId, currentUser.id)
    if (episodeId != null) {
      const episode = await requireOwnedEpisode(this.databaseService, episodeId, currentUser.id)
      if (episode.dramaId !== dramaId) {
        throw new BadRequestException('episode_id 与 drama_id 不匹配')
      }
    }

    const [scene] = await this.databaseService.db
      .insert(scenes)
      .values({
        userId: currentUser.id,
        dramaId,
        episodeId,
        location: typeof body.location === 'string' ? body.location : '',
        time: typeof body.time === 'string' ? body.time : '',
        prompt: typeof body.prompt === 'string' ? body.prompt : typeof body.location === 'string' ? body.location : '',
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    if (episodeId != null) {
      const [existingLink] = await this.databaseService.db
        .select()
        .from(episodeScenes)
        .where(and(eq(episodeScenes.episodeId, episodeId), eq(episodeScenes.sceneId, scene.id)))

      if (!existingLink) {
        await this.databaseService.db
          .insert(episodeScenes)
          .values({ episodeId, sceneId: scene.id, createdAt: ts })
      }
    }

    return toSnakeCaseWithPublicMedia(scene as unknown as Record<string, unknown>, sceneMediaFields)
  }

  @Put('scenes/:id')
  async updateScene(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const sceneId = parseId(id, 'scene id')
    await requireOwnedScene(this.databaseService, sceneId, currentUser.id)

    const updates: Record<string, unknown> = { updatedAt: now() }
    let hasUpdates = false

    if (body.location !== undefined) {
      updates.location = body.location
      hasUpdates = true
    }
    if (body.time !== undefined) {
      updates.time = body.time
      hasUpdates = true
    }
    if (body.prompt !== undefined) {
      updates.prompt = body.prompt
      hasUpdates = true
    }

    if (!hasUpdates) {
      throw new BadRequestException('no valid fields')
    }

    await this.databaseService.db
      .update(scenes)
      .set(updates)
      .where(and(eq(scenes.id, sceneId), eq(scenes.userId, currentUser.id)))

    return null
  }

  @Delete('scenes/:id')
  async deleteScene(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const sceneId = parseId(id, 'scene id')
    const scene = await requireOwnedScene(this.databaseService, sceneId, currentUser.id)

    await this.databaseService.db
      .delete(episodeScenes)
      .where(eq(episodeScenes.sceneId, sceneId))

    await this.databaseService.db
      .update(scenes)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(eq(scenes.id, scene.id))

    return null
  }
}
