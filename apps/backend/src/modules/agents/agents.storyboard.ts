import { eq } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import {
  characters,
  dramas,
  episodeCharacters,
  episodes,
  episodeScenes,
  scenes,
  storyboardCharacters,
  storyboards,
} from '../../db/schema'
import type { StoryboardSaveInput } from './agents.types'

const DRAMA_STYLE_PROMPT_HINTS: Record<string, string> = {
  realistic: 'cinematic realistic style, photo-realistic rendering, natural lighting, high detail',
  anime: 'anime style, japanese 2D illustration, cel shading, clean line art, vibrant colors',
  ghibli: 'Studio Ghibli inspired, hand-drawn anime, soft watercolor backgrounds, warm palette, nostalgic atmosphere',
  cinematic: 'cinematic film still, dramatic lighting, shallow depth of field, filmic color grading, high production value',
  comic: 'comic book style, bold ink lines, vibrant flat colors, halftone shading, dynamic composition',
  watercolor: 'watercolor painting, soft brush strokes, artistic washes, paper texture, gentle color bleed',
}

function now() {
  return new Date()
}

function dramaStylePromptHint(style: string | null | undefined) {
  return DRAMA_STYLE_PROMPT_HINTS[String(style || '').trim()] || DRAMA_STYLE_PROMPT_HINTS.realistic
}

function getEpisodeSceneIds(links: Array<typeof episodeScenes.$inferSelect>) {
  return new Set(links.map((link) => link.sceneId))
}

function getEpisodeCharacterIds(links: Array<typeof episodeCharacters.$inferSelect>) {
  return new Set(links.map((link) => link.characterId))
}

function hasText(value: string | null | undefined) {
  return typeof value === 'string' && value.trim().length > 0
}

function autoFillStoryboardDefaults(storyboard: StoryboardSaveInput): StoryboardSaveInput {
  const desc = storyboard.description?.trim() || ''
  const action = storyboard.action?.trim() || ''
  const atmosphere = storyboard.atmosphere?.trim() || ''
  const title = storyboard.title?.trim() || ''
  const sceneText = desc || action || title

  return {
    ...storyboard,
    title: title || `镜头 ${storyboard.shot_number}`,
    shot_type: storyboard.shot_type?.trim() || '中景',
    action: action || desc,
    description: desc || action,
    result: storyboard.result?.trim() || desc || action,
    atmosphere: atmosphere || '自然',
    image_prompt: storyboard.image_prompt?.trim() || (sceneText ? `cinematic scene, high quality, ${sceneText}` : 'cinematic scene, high quality'),
    video_prompt: storyboard.video_prompt?.trim() || sceneText,
    bgm_prompt: storyboard.bgm_prompt?.trim() || (atmosphere ? `${atmosphere}风格配乐` : '轻柔背景音乐'),
    sound_effect: storyboard.sound_effect?.trim() || '环境音',
  }
}

function validateStoryboardContent(storyboard: StoryboardSaveInput) {
  if (!hasText(storyboard.description) && !hasText(storyboard.action)) {
    throw new Error(`分镜 ${storyboard.shot_number} 缺少核心字段: description 或 action`)
  }
}

async function syncStoryboardCharacters(
  databaseService: DatabaseService,
  storyboardId: number,
  characterIds: number[],
) {
  await databaseService.db
    .delete(storyboardCharacters)
    .where(eq(storyboardCharacters.storyboardId, storyboardId))

  const uniqueIds = [...new Set(characterIds.filter(Boolean))]
  if (!uniqueIds.length) return

  await databaseService.db.insert(storyboardCharacters).values(
    uniqueIds.map((characterId) => ({
      storyboardId,
      characterId,
    })),
  )
}

export async function readStoryboardContext(
  databaseService: DatabaseService,
  episodeId: number,
  dramaId: number,
) {
  const [episode] = await databaseService.db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))

  if (!episode) return { error: 'Episode not found' }

  const script = episode.scriptContent || episode.content
  if (!script) return { error: 'Episode has no script' }

  const [drama] = await databaseService.db
    .select()
    .from(dramas)
    .where(eq(dramas.id, dramaId))

  const dramaStyle = drama?.style || 'realistic'
  const styleHint = dramaStylePromptHint(dramaStyle)

  const [episodeCharacterLinks, episodeSceneLinks, allCharacters, allScenes, existingStoryboards] = await Promise.all([
    databaseService.db
      .select()
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId)),
    databaseService.db
      .select()
      .from(episodeScenes)
      .where(eq(episodeScenes.episodeId, episodeId)),
    databaseService.db
      .select()
      .from(characters)
      .where(eq(characters.dramaId, dramaId)),
    databaseService.db
      .select()
      .from(scenes)
      .where(eq(scenes.dramaId, dramaId)),
    databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episodeId)),
  ])

  const linkedCharacterIds = getEpisodeCharacterIds(episodeCharacterLinks)
  const linkedSceneIds = getEpisodeSceneIds(episodeSceneLinks)

  return {
    episode: {
      id: episode.id,
      title: episode.title,
      episode_number: episode.episodeNumber,
      description: episode.description || '',
    },
    drama: {
      id: dramaId,
      title: drama?.title || '',
      style: dramaStyle,
    },
    style_hint: styleHint,
    script,
    characters: allCharacters
      .filter((character) => !character.deletedAt)
      .filter((character) => !linkedCharacterIds.size || linkedCharacterIds.has(character.id))
      .map((character) => ({
        id: character.id,
        name: character.name,
        role: character.role || '',
        description: (character.description || '').slice(0, 200),
        appearance: (character.appearance || '').slice(0, 150),
        personality: (character.personality || '').slice(0, 150),
      })),
    scenes: allScenes
      .filter((scene) => !scene.deletedAt)
      .filter((scene) => !linkedSceneIds.size || linkedSceneIds.has(scene.id))
      .map((scene) => ({
        id: scene.id,
        location: scene.location,
        time: scene.time,
        prompt: (scene.prompt || '').slice(0, 200),
      })),
    existing_storyboards: existingStoryboards
      .filter((storyboard) => !storyboard.deletedAt)
      .map((storyboard) => ({
        id: storyboard.id,
        shot_number: storyboard.storyboardNumber,
        title: storyboard.title || '',
        scene_id: storyboard.sceneId,
        shot_type: storyboard.shotType || '',
        duration: storyboard.duration || 0,
      })),
  }
}

export async function saveStoryboardsForEpisode(
  databaseService: DatabaseService,
  episodeId: number,
  dramaId: number,
  storyboardsInput: StoryboardSaveInput[],
) {
  if (!storyboardsInput.length) {
    throw new Error('未生成有效分镜：storyboards 为空，未执行保存')
  }

  const [episode] = await databaseService.db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))

  if (!episode) {
    throw new Error('Episode not found')
  }

  const [sceneLinks, characterLinks, existing] = await Promise.all([
    databaseService.db
      .select()
      .from(episodeScenes)
      .where(eq(episodeScenes.episodeId, episodeId)),
    databaseService.db
      .select()
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, episodeId)),
    databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.episodeId, episodeId)),
  ])

  const episodeSceneIds = getEpisodeSceneIds(sceneLinks)
  const episodeCharacterIds = getEpisodeCharacterIds(characterLinks)

  const validatedStoryboards = storyboardsInput.map((storyboard) => {
    const filled = autoFillStoryboardDefaults(storyboard)
    validateStoryboardContent(filled)

    if (filled.scene_id != null && !episodeSceneIds.has(filled.scene_id)) {
      throw new Error(`scene_id ${filled.scene_id} 不属于当前集`)
    }

    const invalidCharacterIds = (filled.character_ids || []).filter((id) => !episodeCharacterIds.has(id))
    if (invalidCharacterIds.length) {
      throw new Error(`character_ids 不属于当前集: ${invalidCharacterIds.join(', ')}`)
    }

    return {
      ...filled,
      title: filled.title?.trim(),
      shot_type: filled.shot_type?.trim(),
      angle: filled.angle?.trim(),
      movement: filled.movement?.trim(),
      location: filled.location?.trim(),
      time: filled.time?.trim(),
      action: filled.action?.trim(),
      dialogue: filled.dialogue?.trim(),
      description: filled.description?.trim(),
      result: filled.result?.trim(),
      atmosphere: filled.atmosphere?.trim(),
      image_prompt: filled.image_prompt?.trim(),
      video_prompt: filled.video_prompt?.trim(),
      bgm_prompt: filled.bgm_prompt?.trim(),
      sound_effect: filled.sound_effect?.trim(),
    }
  })

  for (const storyboard of existing) {
    await databaseService.db
      .delete(storyboardCharacters)
      .where(eq(storyboardCharacters.storyboardId, storyboard.id))
  }

  await databaseService.db
    .delete(storyboards)
    .where(eq(storyboards.episodeId, episodeId))

  const ts = now()
  let totalDuration = 0

  for (const storyboard of validatedStoryboards) {
    const [inserted] = await databaseService.db
      .insert(storyboards)
      .values({
        userId: episode.userId || null,
        episodeId,
        storyboardNumber: storyboard.shot_number,
        title: storyboard.title,
        shotType: storyboard.shot_type,
        angle: storyboard.angle,
        movement: storyboard.movement,
        location: storyboard.location,
        time: storyboard.time,
        action: storyboard.action,
        dialogue: storyboard.dialogue,
        description: storyboard.description,
        result: storyboard.result,
        atmosphere: storyboard.atmosphere,
        imagePrompt: storyboard.image_prompt,
        videoPrompt: storyboard.video_prompt,
        bgmPrompt: storyboard.bgm_prompt,
        soundEffect: storyboard.sound_effect,
        sceneId: storyboard.scene_id ?? null,
        duration: storyboard.duration || 10,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning({ id: storyboards.id })

    await syncStoryboardCharacters(databaseService, inserted.id, storyboard.character_ids || [])
    totalDuration += storyboard.duration || 10
  }

  await databaseService.db
    .update(episodes)
    .set({ duration: Math.ceil(totalDuration / 60), updatedAt: ts })
    .where(eq(episodes.id, episodeId))

  return {
    message: `Saved ${storyboardsInput.length} storyboards`,
    count: storyboardsInput.length,
    total_duration: totalDuration,
  }
}
