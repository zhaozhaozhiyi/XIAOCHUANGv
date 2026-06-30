import { BadRequestException, Body, Controller, Get, Inject, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common'
import { and, eq, isNull, or } from 'drizzle-orm'
import { ApiTags } from '@nestjs/swagger'

import { toPublicMediaUrl } from '../../common/media-url'
import { toSnakeCaseArrayWithPublicMedia, toSnakeCaseWithPublicMedia } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import { characters, dramas, episodeCharacters, episodes, scenes, storyboards, videoMerges } from '../../db/schema'
import { resolveProjectConfigId } from '../dramas/drama-metadata'
import { CurrentUser } from '../auth/current-user.decorator'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import { SessionAuthGuard } from '../auth/session-auth.guard'

const episodeMediaFields = { urlFields: ['videoUrl', 'thumbnail'] } as const
const characterMediaFields = { urlFields: ['imageUrl', 'voiceSampleUrl'], jsonArrayFields: ['referenceImages'] } as const

function now() {
  return new Date()
}

function parseId(value: string) {
  const id = Number(value)
  if (!Number.isInteger(id) || id <= 0) {
    throw new BadRequestException('invalid episode id')
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
  return Number.isFinite(parsed) ? parsed : null
}

function toOptionalString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function stepStatus(done: boolean, partial?: boolean) {
  if (done) return 'done'
  if (partial) return 'partial'
  return 'pending'
}

@ApiTags('episodes')
@Controller('episodes')
@UseGuards(SessionAuthGuard)
export class EpisodesController {
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

  @Get(':id')
  async getEpisode(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parseId(id)
    const episode = await this.requireOwnedEpisode(episodeId, currentUser.id)
    return toSnakeCaseWithPublicMedia(episode as unknown as Record<string, unknown>, episodeMediaFields)
  }

  @Get(':id/characters')
  async listEpisodeCharacters(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parseId(id)
    await this.requireOwnedEpisode(episodeId, currentUser.id)

    const links = await this.databaseService.db
      .select()
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId))
    const characterIds = links.map((link) => link.characterId)
    if (!characterIds.length) return []

    const allCharacters = await this.databaseService.db
      .select()
      .from(characters)
      .where(
        and(
          or(eq(characters.userId, currentUser.id), isNull(characters.userId)),
          isNull(characters.deletedAt),
        ),
      )

    const result = allCharacters.filter((character) => characterIds.includes(character.id))
    return toSnakeCaseArrayWithPublicMedia(result as unknown as Record<string, unknown>[], characterMediaFields)
  }

  @Get(':id/pipeline-status')
  async getEpisodePipelineStatus(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parseId(id)
    const episode = await this.requireOwnedEpisode(episodeId, currentUser.id)

    const [dramaCharacters, dramaScenes, episodeStoryboards, merges] = await Promise.all([
      this.databaseService.db
        .select()
        .from(characters)
        .where(and(eq(characters.dramaId, episode.dramaId), eq(characters.userId, currentUser.id), isNull(characters.deletedAt))),
      this.databaseService.db
        .select()
        .from(scenes)
        .where(and(eq(scenes.dramaId, episode.dramaId), eq(scenes.userId, currentUser.id), isNull(scenes.deletedAt))),
      this.databaseService.db
        .select()
        .from(storyboards)
        .where(and(eq(storyboards.episodeId, episodeId), eq(storyboards.userId, currentUser.id), isNull(storyboards.deletedAt))),
      this.databaseService.db
        .select()
        .from(videoMerges)
        .where(and(eq(videoMerges.episodeId, episodeId), eq(videoMerges.userId, currentUser.id), isNull(videoMerges.deletedAt))),
    ])

    const charactersWithVoice = dramaCharacters.filter((character) => character.voiceStyle)
    const charactersWithSample = dramaCharacters.filter((character) => character.voiceSampleUrl)
    const storyboardsWithImage = episodeStoryboards.filter((storyboard) => storyboard.composedImage)
    const storyboardsWithVideo = episodeStoryboards.filter((storyboard) => storyboard.videoUrl)
    const composedStoryboards = episodeStoryboards.filter((storyboard) => storyboard.composedVideoUrl)
    const latestMerge = merges[merges.length - 1]

    return {
      episode_id: episodeId,
      steps: {
        script_rewrite: { status: episode.scriptContent ? 'done' : episode.content ? 'ready' : 'pending' },
        extract_characters: { status: stepStatus(dramaCharacters.length > 0), count: dramaCharacters.length },
        extract_scenes: { status: stepStatus(dramaScenes.length > 0), count: dramaScenes.length },
        assign_voices: {
          status: stepStatus(
            charactersWithVoice.length === dramaCharacters.length && dramaCharacters.length > 0,
            charactersWithVoice.length > 0,
          ),
          assigned: charactersWithVoice.length,
          total: dramaCharacters.length,
        },
        generate_voice_samples: {
          status: stepStatus(
            charactersWithSample.length === charactersWithVoice.length && charactersWithVoice.length > 0,
            charactersWithSample.length > 0,
          ),
          completed: charactersWithSample.length,
          total: charactersWithVoice.length,
        },
        extract_storyboards: { status: stepStatus(episodeStoryboards.length > 0), count: episodeStoryboards.length },
        generate_images: {
          status: stepStatus(
            storyboardsWithImage.length === episodeStoryboards.length && episodeStoryboards.length > 0,
            storyboardsWithImage.length > 0,
          ),
          completed: storyboardsWithImage.length,
          total: episodeStoryboards.length,
        },
        generate_videos: {
          status: stepStatus(
            storyboardsWithVideo.length === episodeStoryboards.length && episodeStoryboards.length > 0,
            storyboardsWithVideo.length > 0,
          ),
          completed: storyboardsWithVideo.length,
          total: episodeStoryboards.length,
        },
        compose_shots: {
          status: stepStatus(
            composedStoryboards.length === episodeStoryboards.length && episodeStoryboards.length > 0,
            composedStoryboards.length > 0,
          ),
          completed: composedStoryboards.length,
          total: episodeStoryboards.length,
        },
        merge_episode: {
          status: latestMerge?.status === 'completed' ? 'done' : latestMerge ? latestMerge.status : 'pending',
          merged_url: toPublicMediaUrl(latestMerge?.mergedUrl) || null,
        },
      },
    }
  }

  @Post()
  async createEpisode(
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const dramaId = toRequiredNumber(body.drama_id, 'drama_id')
    const imageConfigId = toOptionalNumber(body.image_config_id)
    const videoConfigId = toOptionalNumber(body.video_config_id)
    const audioConfigId = toOptionalNumber(body.audio_config_id)
    const ts = now()

    const [drama] = await this.databaseService.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, currentUser.id), isNull(dramas.deletedAt)))

    if (!drama) {
      throw new NotFoundException('drama_not_found')
    }

    const dramaEpisodes = await this.databaseService.db
      .select()
      .from(episodes)
      .where(and(eq(episodes.dramaId, dramaId), eq(episodes.userId, currentUser.id), isNull(episodes.deletedAt)))
      .orderBy(episodes.episodeNumber)

    const nextEpisodeNumber = dramaEpisodes.length
      ? Math.max(...dramaEpisodes.map((episode) => episode.episodeNumber)) + 1
      : 1

    const [episode] = await this.databaseService.db
      .insert(episodes)
      .values({
        userId: currentUser.id,
        dramaId,
        episodeNumber: nextEpisodeNumber,
        title: toOptionalString(body.title) || `第${nextEpisodeNumber}集`,
        imageConfigId: imageConfigId ?? resolveProjectConfigId(drama.metadata, 'image'),
        videoConfigId: videoConfigId ?? resolveProjectConfigId(drama.metadata, 'video'),
        audioConfigId: audioConfigId ?? resolveProjectConfigId(drama.metadata, 'audio'),
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    return {
      id: episode.id,
      drama_id: dramaId,
      episode_number: episode.episodeNumber,
      title: episode.title,
      image_config_id: episode.imageConfigId,
      video_config_id: episode.videoConfigId,
      audio_config_id: episode.audioConfigId,
    }
  }

  @Put(':id')
  async updateEpisode(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CurrentUser() currentUser: CurrentUserType,
  ) {
    const episodeId = parseId(id)
    await this.requireOwnedEpisode(episodeId, currentUser.id)

    const updates: Record<string, unknown> = { updatedAt: now() }
    let hasValidFields = false

    if (body.content !== undefined) {
      updates.content = body.content
      hasValidFields = true
    }
    if (body.script_content !== undefined) {
      updates.scriptContent = body.script_content
      hasValidFields = true
    }
    if (body.title !== undefined) {
      updates.title = body.title
      hasValidFields = true
    }
    if (body.description !== undefined) {
      updates.description = body.description
      hasValidFields = true
    }
    if (body.status !== undefined) {
      updates.status = body.status
      hasValidFields = true
    }
    if (body.image_config_id !== undefined) {
      updates.imageConfigId = typeof body.image_config_id === 'number'
        ? body.image_config_id
        : Number(body.image_config_id)
      hasValidFields = true
    }
    if (body.video_config_id !== undefined) {
      updates.videoConfigId = typeof body.video_config_id === 'number'
        ? body.video_config_id
        : Number(body.video_config_id)
      hasValidFields = true
    }
    if (body.audio_config_id !== undefined) {
      updates.audioConfigId = typeof body.audio_config_id === 'number'
        ? body.audio_config_id
        : Number(body.audio_config_id)
      hasValidFields = true
    }

    if (!hasValidFields) {
      throw new BadRequestException('no valid fields')
    }

    await this.databaseService.db
      .update(episodes)
      .set(updates)
      .where(and(eq(episodes.id, episodeId), eq(episodes.userId, currentUser.id)))

    return { success: true }
  }
}
