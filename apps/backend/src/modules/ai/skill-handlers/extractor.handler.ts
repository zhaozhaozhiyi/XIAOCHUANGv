import { BadRequestException } from '@nestjs/common'
import { and, eq, isNull, or } from 'drizzle-orm'

import { characters, episodeCharacters, episodeScenes, scenes } from '../../../db/schema'
import { readProjectDefaults } from '../../dramas/drama-metadata'
import { requireOwnedDrama, requireOwnedEpisode } from '../../images/images.ownership'
import {
  completeAiRunTask,
  createSseTransform,
  failAiRunTask,
  persistAiRun,
  requestJsonObject,
  sendSseReply,
  startAiRunTask,
} from './_shared'
import type { SkillHandler } from './types'

/**
 * extractor — 角色与场景提取
 *
 * 取代 AgentsService.buildExtractionStream（已于本次收口删除硬编码 prompt）。
 * 与 script_rewriter 不同，本 skill 不流式吐文字 —— 它要么成功落库后发一条
 * status + done，要么 AI 解析失败时回退到启发式（按对白冒号扫角色，按场次
 * 头扫场景），保证前端永远拿到"可用结果"。
 *
 * 写库行为是关键：handler 同时维护 characters / scenes 主表 + episode_characters
 * / episode_scenes 关联表，按 name / location@@time 去重并合并字段。这部分
 * 逻辑完全照搬旧实现，避免行为漂移。
 */

interface ExtractionCharacter {
  name: string
  role?: string
  description?: string
  appearance?: string
  personality?: string
}

interface ExtractionScene {
  location: string
  time?: string
  prompt?: string
}

interface ExtractorParams {
  dramaId: number
  episodeId: number
  userId: number
  message: string
}

function parseParams(payload: any, userId: number): ExtractorParams {
  const dramaId = Number(payload?.target?.drama_id)
  const episodeId = Number(payload?.target?.episode_id)
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    throw new BadRequestException('target.drama_id is required for skill=extractor')
  }
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    throw new BadRequestException('target.episode_id is required for skill=extractor')
  }
  return {
    dramaId,
    episodeId,
    userId,
    message: typeof payload?.input?.message === 'string' ? payload.input.message : '',
  }
}

function safeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeName(value: string) {
  return String(value || '').replace(/\s+/g, '').trim()
}

function normalizeSceneKey(location: string, time: string) {
  return `${String(location || '').trim()}@@${String(time || '').trim()}`
}

function parseSceneHeader(header: string) {
  // Mirror of agents.service.ts parseSceneHeader. Format: "## S## | INT/EXT · 地点 | 时间段"
  const parts = header.split('|').map((item) => item.trim())
  const locationPart = parts[1] || ''
  const time = parts[2] || ''
  const location = locationPart.split('·').map((item) => item.trim()).filter(Boolean).pop() || locationPart
  return { location: location.trim(), time: time.trim() }
}

function promptForScene(scene: ExtractionScene) {
  const location = safeString(scene.location)
  const time = safeString(scene.time)
  if (location && time) return `${time}的${location}，短剧场景，适合影视化出图`
  if (location) return `${location}，短剧场景，适合影视化出图`
  return '短剧场景，适合影视化出图'
}

function dedupeCharacters(input: ExtractionCharacter[]) {
  const map = new Map<string, ExtractionCharacter>()
  for (const entry of input) {
    const name = normalizeName(entry.name)
    if (!name) continue
    const existing = map.get(name)
    if (existing) {
      existing.role = safeString(existing.role) || safeString(entry.role)
      existing.description = safeString(existing.description) || safeString(entry.description)
      existing.appearance = safeString(existing.appearance) || safeString(entry.appearance)
      existing.personality = safeString(existing.personality) || safeString(entry.personality)
      continue
    }
    map.set(name, {
      name,
      role: safeString(entry.role),
      description: safeString(entry.description),
      appearance: safeString(entry.appearance),
      personality: safeString(entry.personality),
    })
  }
  return [...map.values()]
}

function dedupeScenes(input: ExtractionScene[]) {
  const map = new Map<string, ExtractionScene>()
  for (const entry of input) {
    const location = safeString(entry.location)
    const time = safeString(entry.time)
    if (!location) continue
    const key = normalizeSceneKey(location, time)
    if (!map.has(key)) {
      map.set(key, {
        location,
        time,
        prompt: safeString(entry.prompt) || promptForScene({ location, time }),
      })
    }
  }
  return [...map.values()]
}

function extractCharactersHeuristically(script: string): ExtractionCharacter[] {
  // Fallback when AI is unreachable / JSON unparseable. Catches "角色名：" or
  // "角色名:" lines as a minimum-viable character list. Mirrors agents.service.ts.
  const banned = new Set(['旁白', '画外音', '字幕', '音效', '系统', 'OS', 'VO', 'BGM', 'SFX'])
  const matches = script.matchAll(/^([^\s：:()（）]{1,16})\s*[：:]/gm)
  const names: ExtractionCharacter[] = []
  for (const match of matches) {
    const rawName = normalizeName(match[1] || '')
    if (!rawName || banned.has(rawName)) continue
    if (/^S\d+$/i.test(rawName)) continue
    names.push({ name: rawName, role: '', description: '', appearance: '', personality: '' })
  }
  return dedupeCharacters(names)
}

function extractScenesHeuristically(script: string): ExtractionScene[] {
  const matches = script.matchAll(/^##\s*S\d+\s*\|([^\n]+)$/gm)
  const extracted: ExtractionScene[] = []
  for (const match of matches) {
    const parsed = parseSceneHeader(`## S |${match[1] || ''}`)
    if (!parsed.location) continue
    extracted.push({
      location: parsed.location,
      time: parsed.time,
      prompt: promptForScene(parsed),
    })
  }
  return dedupeScenes(extracted)
}

function buildExtractionUserMessage(args: {
  script: string
  existingCharacters: Array<{ id: number; name: string; role: string | null }>
  existingScenes: Array<{ id: number; location: string; time: string }>
  message: string
}) {
  const request = args.message.trim() || '提取角色和场景'
  return `【用户要求】${request}

【已有角色】
${JSON.stringify(args.existingCharacters.slice(0, 200))}

【已有场景】
${JSON.stringify(args.existingScenes.slice(0, 200))}

【剧本】
${args.script.slice(0, 12000)}`
}

export const extractorHandler: SkillHandler = async (ctx) => {
  const params = parseParams(ctx.payload, ctx.currentUser.id)

  await requireOwnedDrama(ctx.databaseService, params.dramaId, params.userId)
  const episode = await requireOwnedEpisode(ctx.databaseService, params.episodeId, params.userId)
  if (episode.dramaId !== params.dramaId) {
    throw new BadRequestException('episode_id 与 drama_id 不匹配')
  }
  const script = String(episode.scriptContent || episode.content || '').trim()
  if (!script) {
    throw new BadRequestException('当前集没有可提取的剧本内容')
  }

  // For non-stream callers (e.g. CLI tests), execute synchronously and return
  // the same final shape AiService.nonStreamChat would return.
  if (!ctx.stream) {
    const summary = await runExtraction({ ctx, params, script })
    return {
      response: {
        type: 'done' as const,
        text: summary.statusText,
        references: [],
        actions: [],
      },
    }
  }

  const { stream, emitter } = createSseTransform()
  const taskHandle = await startAiRunTask(ctx.databaseService, {
    userId: ctx.currentUser.id,
    skillId: 'extractor',
    mode: String(ctx.payload?.mode || 'extract'),
    scene: String(ctx.payload?.scene || 'workbench'),
    targetType: 'episode',
    targetId: params.episodeId,
    dramaId: params.dramaId,
    episodeId: params.episodeId,
    userMessage: params.message || '提取角色和场景',
    assistantMessage: '',
  })

  void (async () => {
    try {
      await emitter.writeRaw(':ok\n\n')
      const result = await runExtraction({ ctx, params, script, emitter, skipPersist: true })
      await completeAiRunTask(ctx.databaseService, taskHandle, {
        assistantMessage: result.statusText,
        resultSummary: {
          skill_id: 'extractor',
          created_characters: result.createdCharacters,
          merged_characters: result.mergedCharacters,
          created_scenes: result.createdScenes,
          reused_scenes: result.reusedScenes,
        },
      })
      await emitter.send({ type: 'status', text: result.statusText }, 'message').catch(() => undefined)
      await emitter.send({ type: 'done', task_id: taskHandle.taskId, tools_called: ['direct_extraction_save'] }, 'message').catch(() => undefined)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'AI execution failed'
      await failAiRunTask(ctx.databaseService, taskHandle, error)
      try {
        await emitter.send({ type: 'error', message }, 'message')
      } catch {
        // ignore
      }
    } finally {
      await emitter.close()
    }
  })()

  return { response: sendSseReply(ctx.reply, stream) }
}

async function runExtraction(args: {
  ctx: Parameters<SkillHandler>[0]
  params: ExtractorParams
  script: string
  emitter?: {
    send: (data: unknown, event?: string) => Promise<void>
  }
  skipPersist?: boolean
}) {
  const { ctx, params, script, emitter } = args
  await emitter?.send({ type: 'status', text: '正在读取剧本、角色和场景...' }, 'message')

  const [existingCharacters, existingScenes, linkedCharacterRows, linkedSceneRows] = await Promise.all([
    ctx.databaseService.db
      .select()
      .from(characters)
      .where(
        and(
          eq(characters.dramaId, params.dramaId),
          or(eq(characters.userId, params.userId), isNull(characters.userId)),
          isNull(characters.deletedAt),
        ),
      ),
    ctx.databaseService.db
      .select()
      .from(scenes)
      .where(
        and(
          eq(scenes.dramaId, params.dramaId),
          or(eq(scenes.userId, params.userId), isNull(scenes.userId)),
          isNull(scenes.deletedAt),
        ),
      ),
    ctx.databaseService.db
      .select()
      .from(episodeCharacters)
      .where(eq(episodeCharacters.episodeId, params.episodeId)),
    ctx.databaseService.db
      .select()
      .from(episodeScenes)
      .where(eq(episodeScenes.episodeId, params.episodeId)),
  ])
  const drama = await requireOwnedDrama(ctx.databaseService, params.dramaId, params.userId)
  const projectDefaults = readProjectDefaults(drama.metadata)

  let extractedCharacters: ExtractionCharacter[] = []
  let extractedScenes: ExtractionScene[] = []

  try {
    await emitter?.send({ type: 'status', text: '正在使用 AI 提取角色和场景...' }, 'message')
    const userMessage = buildExtractionUserMessage({
      script,
      existingCharacters: existingCharacters.map((item) => ({ id: item.id, name: item.name, role: item.role })),
      existingScenes: existingScenes.map((item) => ({ id: item.id, location: item.location, time: item.time })),
      message: params.message,
    })
    const parsed = await requestJsonObject<{
      characters?: ExtractionCharacter[]
      scenes?: ExtractionScene[]
    }>({
      databaseService: ctx.databaseService,
      systemPrompt: ctx.skillPrompt,
      userMessage,
      temperature: 0.2,
      maxTokens: 8192,
      shape: '{"characters":[...],"scenes":[...]}',
    })
    extractedCharacters = dedupeCharacters(Array.isArray(parsed.characters) ? parsed.characters : [])
    extractedScenes = dedupeScenes(Array.isArray(parsed.scenes) ? parsed.scenes : [])
  } catch {
    // AI unreachable / response unparseable — fall back to rule-based extraction
    // so the workbench still moves forward. Frontend differentiates via the
    // counts in the final status message.
    await emitter?.send({ type: 'status', text: 'AI 提取不可用，切换为规则提取...' }, 'message')
  }

  if (!extractedCharacters.length) extractedCharacters = extractCharactersHeuristically(script)
  if (!extractedScenes.length) extractedScenes = extractScenesHeuristically(script)

  const linkedCharacterIds = new Set(linkedCharacterRows.map((item) => item.characterId))
  const linkedSceneIds = new Set(linkedSceneRows.map((item) => item.sceneId))
  const ts = new Date()
  const characterMap = new Map(existingCharacters.map((item) => [normalizeName(item.name), item] as const))
  const sceneMap = new Map(existingScenes.map((item) => [normalizeSceneKey(item.location, item.time), item] as const))

  await emitter?.send({ type: 'status', text: '正在保存角色和场景...' }, 'message')

  let createdCharacters = 0
  let mergedCharacters = 0

  for (const draft of extractedCharacters) {
    const key = normalizeName(draft.name)
    if (!key) continue
    const existing = characterMap.get(key)

    if (existing) {
      const isLeadCharacter = projectDefaults.lead_character_name
        && normalizeName(projectDefaults.lead_character_name) === key
      await ctx.databaseService.db
        .update(characters)
        .set({
          role: safeString(draft.role) || existing.role,
          description: safeString(draft.description) || existing.description || (isLeadCharacter ? projectDefaults.lead_character_description : null),
          appearance: safeString(draft.appearance) || existing.appearance,
          personality: safeString(draft.personality) || existing.personality,
          voiceStyle: existing.voiceStyle || (isLeadCharacter ? projectDefaults.lead_voice_id : null),
          userId: existing.userId || params.userId,
          updatedAt: ts,
        })
        .where(eq(characters.id, existing.id))

      if (!linkedCharacterIds.has(existing.id)) {
        await ctx.databaseService.db
          .insert(episodeCharacters)
          .values({ episodeId: params.episodeId, characterId: existing.id, createdAt: ts })
        linkedCharacterIds.add(existing.id)
      }
      mergedCharacters += 1
      continue
    }

    const [inserted] = await ctx.databaseService.db
      .insert(characters)
      .values({
        userId: params.userId,
        dramaId: params.dramaId,
        name: key,
        role: safeString(draft.role),
        description: safeString(draft.description) || (
          projectDefaults.lead_character_name
          && normalizeName(projectDefaults.lead_character_name) === key
            ? projectDefaults.lead_character_description
            : ''
        ),
        appearance: safeString(draft.appearance),
        personality: safeString(draft.personality),
        voiceStyle: (
          projectDefaults.lead_character_name
          && normalizeName(projectDefaults.lead_character_name) === key
            ? projectDefaults.lead_voice_id
            : null
        ),
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    await ctx.databaseService.db
      .insert(episodeCharacters)
      .values({ episodeId: params.episodeId, characterId: inserted.id, createdAt: ts })

    linkedCharacterIds.add(inserted.id)
    characterMap.set(key, inserted)
    createdCharacters += 1
  }

  let createdScenes = 0
  let reusedScenes = 0

  for (const draft of extractedScenes) {
    const location = safeString(draft.location)
    if (!location) continue
    const time = safeString(draft.time)
    const key = normalizeSceneKey(location, time)
    const existing = sceneMap.get(key)

    if (existing) {
      if (!linkedSceneIds.has(existing.id)) {
        await ctx.databaseService.db
          .insert(episodeScenes)
          .values({ episodeId: params.episodeId, sceneId: existing.id, createdAt: ts })
        linkedSceneIds.add(existing.id)
      }
      reusedScenes += 1
      continue
    }

    const [inserted] = await ctx.databaseService.db
      .insert(scenes)
      .values({
        userId: params.userId,
        dramaId: params.dramaId,
        episodeId: params.episodeId,
        location,
        time,
        prompt: safeString(draft.prompt) || promptForScene({ location, time }),
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    await ctx.databaseService.db
      .insert(episodeScenes)
      .values({ episodeId: params.episodeId, sceneId: inserted.id, createdAt: ts })

    linkedSceneIds.add(inserted.id)
    sceneMap.set(key, inserted)
    createdScenes += 1
  }

  const statusText = `提取完成：角色新增 ${createdCharacters} / 合并 ${mergedCharacters}，场景新增 ${createdScenes} / 复用 ${reusedScenes}`

  if (!args.skipPersist) {
    await persistAiRun(ctx.databaseService, {
      userId: ctx.currentUser.id,
      skillId: 'extractor',
      mode: String(ctx.payload?.mode || 'extract'),
      scene: String(ctx.payload?.scene || 'workbench'),
      targetType: 'episode',
      targetId: params.episodeId,
      userMessage: params.message || '提取角色和场景',
      assistantMessage: statusText,
    })
  }

  return {
    statusText,
    createdCharacters,
    mergedCharacters,
    createdScenes,
    reusedScenes,
  }
}
