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

  if (episode.dramaId !== dramaId) {
    throw new Error('episode_id 与 drama_id 不匹配')
  }

  const [sceneLinks, characterLinks, existing, projectCharacters, projectScenes] = await Promise.all([
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
    databaseService.db
      .select()
      .from(characters)
      .where(eq(characters.dramaId, dramaId)),
    databaseService.db
      .select()
      .from(scenes)
      .where(eq(scenes.dramaId, dramaId)),
  ])

  const episodeSceneIds = getEpisodeSceneIds(sceneLinks)
  const episodeCharacterIds = getEpisodeCharacterIds(characterLinks)
  const projectSceneIds = new Set(
    projectScenes.filter((scene) => !scene.deletedAt).map((scene) => scene.id),
  )
  const projectCharacterIds = new Set(
    projectCharacters.filter((character) => !character.deletedAt).map((character) => character.id),
  )
  const requestedSceneIds = new Set(
    storyboardsInput
      .map((storyboard) => storyboard.scene_id)
      .filter((sceneId): sceneId is number =>
        typeof sceneId === 'number' && Number.isInteger(sceneId) && sceneId > 0,
      ),
  )
  const requestedCharacterIds = new Set(
    storyboardsInput.flatMap((storyboard) => storyboard.character_ids || [])
      .filter((characterId) => Number.isInteger(characterId) && characterId > 0),
  )
  const invalidSceneIds = Array.from(requestedSceneIds).filter((sceneId) => !projectSceneIds.has(sceneId))
  if (invalidSceneIds.length) {
    throw new Error(`scene_id 不属于当前项目: ${invalidSceneIds.join(', ')}`)
  }
  const invalidCharacterIds = Array.from(requestedCharacterIds)
    .filter((characterId) => !projectCharacterIds.has(characterId))
  if (invalidCharacterIds.length) {
    throw new Error(`character_ids 不属于当前项目: ${invalidCharacterIds.join(', ')}`)
  }

  const validatedStoryboards = storyboardsInput.map((storyboard) => {
    const filled = autoFillStoryboardDefaults(storyboard)
    validateStoryboardContent(filled)

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

  // The model receives project assets from the graph-backed context. Any
  // valid asset it actually uses becomes an explicit episode association
  // before the storyboard rows are written.
  const ts = now()
  const missingSceneLinks = Array.from(requestedSceneIds)
    .filter((sceneId) => !episodeSceneIds.has(sceneId))
    .map((sceneId) => ({ episodeId, sceneId, createdAt: ts }))
  const missingCharacterLinks = Array.from(requestedCharacterIds)
    .filter((characterId) => !episodeCharacterIds.has(characterId))
    .map((characterId) => ({ episodeId, characterId, createdAt: ts }))
  if (missingSceneLinks.length) {
    await databaseService.db.insert(episodeScenes).values(missingSceneLinks)
  }
  if (missingCharacterLinks.length) {
    await databaseService.db.insert(episodeCharacters).values(missingCharacterLinks)
  }

  for (const storyboard of existing) {
    await databaseService.db
      .delete(storyboardCharacters)
      .where(eq(storyboardCharacters.storyboardId, storyboard.id))
  }

  await databaseService.db
    .delete(storyboards)
    .where(eq(storyboards.episodeId, episodeId))

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
    .set({
      duration: Math.ceil(totalDuration / 60),
      reviewStatus: 'storyboard_ready',
      updatedAt: ts,
    })
    .where(eq(episodes.id, episodeId))

  return {
    message: `Saved ${storyboardsInput.length} storyboards`,
    count: storyboardsInput.length,
    total_duration: totalDuration,
  }
}
