import { BadRequestException } from '@nestjs/common'
import { and, eq, isNull, or } from 'drizzle-orm'

import { aiServiceConfigs, aiVoices, characters, episodeCharacters, episodes } from '../../../db/schema'
import { fallbackVoicesForConfig } from '../../ai-configs/ai-configs.utils'
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
import type { SkillHandler, SkillHandlerContext } from './types'

/**
 * voice_assigner — 角色音色分配
 *
 * 取代 AgentsService.buildVoiceAssignmentStream（已于本次收口删除硬编码 prompt）。
 *
 * 关键约束：
 *   - 必须基于 episode 当前关联的角色（episode_characters）做分配，不是整个 drama
 *   - 必须基于"当前音频 AI 配置"对应 provider 的可用音色做分配
 *   - AI 返回的 voice_id 必须出现在可用列表中，否则丢弃
 *   - 未被 AI 覆盖的角色由启发式规则兜底（性别池 round-robin + 保留已匹配音色）
 *
 * 写回 characters.voiceStyle 时同步把 voiceSampleUrl 置 NULL —— 换音色后旧试听
 * 已无效，前端在批量生成试听时会重新建立。
 */

interface VoiceOption {
  id: string
  name: string
  language: string
  provider: string
  gender: 'male' | 'female' | 'neutral'
  traits: string[]
}

interface VoiceAssignment {
  character_id: number
  voice_id: string
  reason?: string
}

interface VoiceAssignerParams {
  dramaId: number
  episodeId: number
  userId: number
  message: string
}

function parseParams(payload: any, userId: number): VoiceAssignerParams {
  const dramaId = Number(payload?.target?.drama_id)
  const episodeId = Number(payload?.target?.episode_id)
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    throw new BadRequestException('target.drama_id is required for skill=voice_assigner')
  }
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    throw new BadRequestException('target.episode_id is required for skill=voice_assigner')
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

function inferGenderFromText(text: string): 'male' | 'female' | 'neutral' {
  const source = text.toLowerCase()
  if (/[男|少年|青年|叔|爷|父|哥|王子|boy|man|male]/i.test(source)) return 'male'
  if (/[女|少女|御姐|妈|姨|姐|后|公主|girl|woman|female]/i.test(source)) return 'female'
  return 'neutral'
}

function normalizePersonName(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, '').trim()
}

function inferCharacterGender(character: {
  name: string
  role?: string | null
  description?: string | null
  personality?: string | null
}) {
  return inferGenderFromText([
    character.name,
    character.role || '',
    character.description || '',
    character.personality || '',
  ].join(' '))
}

function inferVoiceGender(args: { name: string; description: string[] }) {
  return inferGenderFromText(`${args.name} ${args.description.join(' ')}`)
}

function parseVoiceDescription(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean)
    }
  } catch {
    // ignore
  }
  return [String(value).trim()].filter(Boolean)
}

function buildHeuristicVoiceAssignments(args: {
  characters: Array<typeof characters.$inferSelect>
  voices: VoiceOption[]
  provider: string
  leadCharacterName?: string | null
  leadVoiceId?: string | null
}): VoiceAssignment[] {
  // Round-robin within a gender pool; falls back to "any voice" if the
  // gender pool is empty. Mirrors agents.service.ts:463 buildHeuristicVoiceAssignments.
  const exactPools = {
    male: args.voices.filter((voice) => voice.gender === 'male'),
    female: args.voices.filter((voice) => voice.gender === 'female'),
    neutral: args.voices.filter((voice) => voice.gender === 'neutral'),
  }
  const indices = new Map<string, number>()

  const pickFromPool = (poolKey: string, pool: VoiceOption[]) => {
    const list = pool.length ? pool : args.voices
    if (!list.length) throw new Error('当前没有可用音色')
    const next = indices.get(poolKey) || 0
    indices.set(poolKey, next + 1)
    return list[next % list.length]
  }

  return args.characters.map((character) => {
    const normalizedLeadName = safeString(args.leadCharacterName).replace(/\s+/g, '')
    const normalizedCharacterName = safeString(character.name).replace(/\s+/g, '')
    if (
      normalizedLeadName
      && normalizedLeadName === normalizedCharacterName
      && args.leadVoiceId
      && args.voices.some((voice) => voice.id === args.leadVoiceId)
    ) {
      return {
        character_id: character.id,
        voice_id: args.leadVoiceId,
        reason: '命中项目预设主角音色',
      }
    }

    const existing = args.voices.find((voice) => (
      voice.id === character.voiceStyle
      && (!character.voiceProvider || character.voiceProvider === args.provider)
    ))
    if (existing) {
      return {
        character_id: character.id,
        voice_id: existing.id,
        reason: '保留当前已匹配音色',
      }
    }

    const gender = inferCharacterGender(character)
    const pool = gender === 'male'
      ? exactPools.male
      : gender === 'female'
        ? exactPools.female
        : exactPools.neutral.length
          ? exactPools.neutral
          : args.voices

    const chosen = pickFromPool(gender, pool)
    return {
      character_id: character.id,
      voice_id: chosen.id,
      reason: '根据角色气质与可用音色做启发式匹配',
    }
  })
}

async function resolveEpisodeAudioConfig(
  ctx: SkillHandlerContext,
  episodeId: number,
) {
  const [episode] = await ctx.databaseService.db
    .select()
    .from(episodes)
    .where(eq(episodes.id, episodeId))
  if (!episode) return { episode: null, config: null }

  if (episode.audioConfigId) {
    const [config] = await ctx.databaseService.db
      .select()
      .from(aiServiceConfigs)
      .where(eq(aiServiceConfigs.id, episode.audioConfigId))
    if (config) return { episode, config }
  }

  const rows = await ctx.databaseService.db
    .select()
    .from(aiServiceConfigs)
    .where(eq(aiServiceConfigs.serviceType, 'audio'))

  const config = rows
    .filter((item) => item.isActive)
    .sort((a, b) => (b.priority || 0) - (a.priority || 0))[0] || null

  return { episode, config }
}

function buildVoiceAssignerUserMessage(args: {
  characters: Array<{
    id: number
    name: string
    role: string
    description: string
    personality: string
    current_voice: string
  }>
  voices: Array<{
    id: string
    name: string
    gender: string
    language: string
    traits: string[]
  }>
  message: string
}) {
  const request = args.message.trim() || '分配音色'
  return `【用户要求】${request}

【角色列表】
${JSON.stringify(args.characters)}

【可用音色】
${JSON.stringify(args.voices)}`
}

export const voiceAssignerHandler: SkillHandler = async (ctx) => {
  const params = parseParams(ctx.payload, ctx.currentUser.id)
  const drama = await requireOwnedDrama(ctx.databaseService, params.dramaId, params.userId)
  const episode = await requireOwnedEpisode(ctx.databaseService, params.episodeId, params.userId)
  if (episode.dramaId !== params.dramaId) {
    throw new BadRequestException('episode_id 与 drama_id 不匹配')
  }
  const projectDefaults = readProjectDefaults(drama.metadata)

  if (!ctx.stream) {
    const result = await runAssignment({ ctx, params, projectDefaults })
    return {
      response: {
        type: 'done' as const,
        text: result.statusText,
        references: [],
        actions: [],
      },
    }
  }

  const { stream, emitter } = createSseTransform()
  const taskHandle = await startAiRunTask(ctx.databaseService, {
    userId: ctx.currentUser.id,
    skillId: 'voice_assigner',
    mode: String(ctx.payload?.mode || 'assign'),
    scene: String(ctx.payload?.scene || 'workbench'),
    targetType: 'episode',
    targetId: params.episodeId,
    dramaId: params.dramaId,
    episodeId: params.episodeId,
    userMessage: params.message || '分配音色',
    assistantMessage: '',
  })

  void (async () => {
    try {
      await emitter.writeRaw(':ok\n\n')
      const result = await runAssignment({ ctx, params, emitter, projectDefaults, skipPersist: true })
      await completeAiRunTask(ctx.databaseService, taskHandle, {
        assistantMessage: result.statusText,
        resultSummary: {
          skill_id: 'voice_assigner',
          updated_count: result.updatedCount,
        },
      })
      await emitter.send({ type: 'status', text: result.statusText }, 'message').catch(() => undefined)
      await emitter.send({ type: 'done', task_id: taskHandle.taskId, tools_called: ['direct_voice_assignment'] }, 'message').catch(() => undefined)
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

async function runAssignment(args: {
  ctx: SkillHandlerContext
  params: VoiceAssignerParams
  projectDefaults: ReturnType<typeof readProjectDefaults>
  emitter?: { send: (data: unknown, event?: string) => Promise<void> }
  skipPersist?: boolean
}) {
  const { ctx, params, emitter, projectDefaults } = args
  await emitter?.send({ type: 'status', text: '正在读取角色与可用音色...' }, 'message')

  const characterLinks = await ctx.databaseService.db
    .select()
    .from(episodeCharacters)
    .where(eq(episodeCharacters.episodeId, params.episodeId))
  const characterIds = characterLinks.map((item) => item.characterId)
  if (!characterIds.length) {
    throw new Error('当前集还没有角色，请先提取角色与场景')
  }

  const episodeCharactersRows = (await ctx.databaseService.db
    .select()
    .from(characters)
    .where(
      and(
        eq(characters.dramaId, params.dramaId),
        or(eq(characters.userId, params.userId), isNull(characters.userId)),
        isNull(characters.deletedAt),
      ),
    ))
    .filter((item) => characterIds.includes(item.id))

  if (!episodeCharactersRows.length) {
    throw new Error('当前集还没有可分配音色的角色')
  }

  const { config } = await resolveEpisodeAudioConfig(ctx, params.episodeId)
  if (!config || !config.provider) {
    throw new Error('当前没有可用的音频配置，请先在设置中启用音频服务')
  }
  const provider = String(config.provider).trim()

  const storedVoices = await ctx.databaseService.db
    .select()
    .from(aiVoices)
    .where(eq(aiVoices.provider, provider))

  const voiceOptions: VoiceOption[] = (storedVoices.length
    ? storedVoices.map((voice) => {
        const traits = parseVoiceDescription(voice.description)
        return {
          id: voice.voiceId,
          name: voice.voiceName,
          language: voice.language || '中文',
          provider,
          gender: inferVoiceGender({ name: voice.voiceName, description: traits }),
          traits,
        }
      })
    : fallbackVoicesForConfig(config).map((voice) => ({
        id: voice.voiceId,
        name: voice.voiceName,
        language: voice.language || '中文',
        provider,
        gender: inferVoiceGender({
          name: voice.voiceName,
          description: Array.isArray(voice.description)
            ? voice.description.map((item) => String(item))
            : [],
        }),
        traits: Array.isArray(voice.description)
          ? voice.description.map((item) => String(item))
          : [],
      })))
    .filter((voice) => !!voice.id)

  if (!voiceOptions.length) {
    throw new Error(`当前音频配置(${provider})没有可用音色`)
  }

  let assignments: VoiceAssignment[] = []
  try {
    await emitter?.send({ type: 'status', text: '正在使用 AI 分配音色...' }, 'message')
    const userMessage = buildVoiceAssignerUserMessage({
      characters: episodeCharactersRows.map((character) => ({
        id: character.id,
        name: character.name,
        role: character.role || '',
        description: character.description || '',
        personality: character.personality || '',
        current_voice: character.voiceStyle || '',
      })),
      voices: voiceOptions.map((voice) => ({
        id: voice.id,
        name: voice.name,
        gender: voice.gender,
        language: voice.language,
        traits: voice.traits,
      })),
      message: params.message,
    })
    const parsed = await requestJsonObject<{ assignments?: VoiceAssignment[] }>({
      databaseService: ctx.databaseService,
      systemPrompt: ctx.skillPrompt,
      userMessage,
      temperature: 0.2,
      maxTokens: 8192,
      shape: '{"assignments":[...]}',
    })
    assignments = Array.isArray(parsed.assignments) ? parsed.assignments : []
  } catch {
    await emitter?.send({ type: 'status', text: 'AI 分配不可用，切换为规则分配...' }, 'message')
  }

  const validCharacterIds = new Set(episodeCharactersRows.map((item) => item.id))
  const validVoiceIds = new Set(voiceOptions.map((item) => item.id))
  const assignmentMap = new Map<number, VoiceAssignment>()

  for (const assignment of assignments) {
    if (!validCharacterIds.has(Number(assignment.character_id))) continue
    if (!validVoiceIds.has(String(assignment.voice_id || ''))) continue
    assignmentMap.set(Number(assignment.character_id), {
      character_id: Number(assignment.character_id),
      voice_id: String(assignment.voice_id),
      reason: safeString(assignment.reason),
    })
  }

  const normalizedLeadName = normalizePersonName(projectDefaults.lead_character_name)
  if (normalizedLeadName && projectDefaults.lead_voice_id && validVoiceIds.has(projectDefaults.lead_voice_id)) {
    const leadCharacter = episodeCharactersRows.find((character) => normalizePersonName(character.name) === normalizedLeadName)
    if (leadCharacter) {
      assignmentMap.set(leadCharacter.id, {
        character_id: leadCharacter.id,
        voice_id: projectDefaults.lead_voice_id,
        reason: '命中项目预设主角音色',
      })
    }
  }

  const missingCharacters = episodeCharactersRows.filter((character) => !assignmentMap.has(character.id))
  if (missingCharacters.length) {
    const fallbackAssignments = buildHeuristicVoiceAssignments({
      characters: missingCharacters,
      voices: voiceOptions,
      provider,
      leadCharacterName: projectDefaults.lead_character_name,
      leadVoiceId: projectDefaults.lead_voice_id,
    })
    for (const assignment of fallbackAssignments) {
      assignmentMap.set(assignment.character_id, assignment)
    }
  }

  await emitter?.send({ type: 'status', text: '正在写入角色音色配置...' }, 'message')
  const ts = new Date()
  for (const character of episodeCharactersRows) {
    const assignment = assignmentMap.get(character.id)
    if (!assignment) continue
    await ctx.databaseService.db
      .update(characters)
      .set({
        voiceStyle: assignment.voice_id,
        voiceProvider: provider,
        voiceSampleUrl: null,
        updatedAt: ts,
      })
      .where(eq(characters.id, character.id))
  }

  const statusText = `音色分配完成：已更新 ${assignmentMap.size} 个角色`

  if (!args.skipPersist) {
    await persistAiRun(ctx.databaseService, {
      userId: ctx.currentUser.id,
      skillId: 'voice_assigner',
      mode: String(ctx.payload?.mode || 'assign'),
      scene: String(ctx.payload?.scene || 'workbench'),
      targetType: 'episode',
      targetId: params.episodeId,
      userMessage: params.message || '分配音色',
      assistantMessage: statusText,
    })
  }

  return { statusText, updatedCount: assignmentMap.size }
}
