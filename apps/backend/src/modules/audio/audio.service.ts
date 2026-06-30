import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'

import { toPublicMediaUrl } from '../../common/media-url'
import { AssetsService } from '../assets/assets.service'
import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'
import { defaultVolcVoiceForConfig, isVolcVoiceCompatibleWithConfig } from '../ai-configs/ai-configs.utils'
import { DatabaseService } from '../../db/database.service'
import { characters, dramas, episodes, storyboards, tasks } from '../../db/schema'
import { readProjectDefaults, resolveProjectConfigId } from '../dramas/drama-metadata'
import { TaskQueueService } from '../queue/task-queue.service'
import { StorageService } from '../storage/storage.service'
import { getStoryboardTtsDialogue, isNarratorSpeaker, parseDialogueForTTS } from './audio.dialogue'
import { getTTSAdapter } from './audio.providers.registry'
import { saveBufferFile } from './audio.storage'
import type { AIConfig } from './audio.config'

function mimeTypeFromPath(path: string) {
  if (path.endsWith('.wav')) return 'audio/wav'
  if (path.endsWith('.ogg')) return 'audio/ogg'
  return 'audio/mpeg'
}

function parseConfigId(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function isVolcResourceMismatch(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '')
  return message.includes('resource ID is mismatched with speaker related resource')
}

function trimText(value: unknown, maxLength: number) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length <= maxLength) return text
  if (maxLength <= 3) return text.slice(0, maxLength)
  return `${text.slice(0, maxLength - 3)}...`
}

function sanitizePayload(payload: Record<string, unknown> | null | undefined) {
  if (!payload) return null
  const cleanEntries = Object.entries(payload).filter(([, value]) => value !== undefined)
  if (!cleanEntries.length) return null
  return JSON.stringify(Object.fromEntries(cleanEntries))
}

type StoryboardTtsTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled'

@Injectable()
export class AudioService {
  constructor(
    @Inject(DatabaseService) private readonly databaseService: DatabaseService,
    @Inject(AiConfigResolverService) private readonly aiConfigResolver: AiConfigResolverService,
    @Inject(AssetsService) private readonly assetsService: AssetsService,
    @Inject(StorageService) private readonly storageService: StorageService,
    @Inject(TaskQueueService) private readonly taskQueueService: TaskQueueService,
  ) {}

  private now() {
    return new Date()
  }

  private async resolveAudioConfig(configId?: number | null) {
    return this.aiConfigResolver.resolveConfig('audio', configId)
  }

  private async resolveEpisodeProjectDefaults(episodeId: number) {
    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(eq(episodes.id, episodeId))
    if (!episode) return { episode: null, drama: null, defaults: null as ReturnType<typeof readProjectDefaults> | null }

    const [drama] = episode.dramaId == null
      ? [null]
      : await this.databaseService.db
          .select()
          .from(dramas)
          .where(eq(dramas.id, episode.dramaId))

    return {
      episode,
      drama: drama || null,
      defaults: drama ? readProjectDefaults(drama.metadata) : null,
    }
  }

  private defaultVoiceForConfig(config: AIConfig) {
    if (config.provider === 'volcengine') {
      return defaultVolcVoiceForConfig({
        id: 0,
        userId: null,
        serviceType: 'audio',
        provider: config.provider,
        name: '',
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: JSON.stringify([config.model]),
        endpoint: null,
        queryEndpoint: null,
        priority: 0,
        isDefault: false,
        isActive: true,
        settings: JSON.stringify(config.settings || {}),
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any)[0]?.voiceId || 'alloy'
    }
    return 'alloy'
  }

  private isVoiceCompatible(config: AIConfig, voiceId: string) {
    if (config.provider !== 'volcengine') return true
    return isVolcVoiceCompatibleWithConfig(voiceId, {
      id: 0,
      userId: null,
      serviceType: 'audio',
      provider: config.provider,
      name: '',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: JSON.stringify([config.model]),
      endpoint: null,
      queryEndpoint: null,
      priority: 0,
      isDefault: false,
      isActive: true,
      settings: JSON.stringify(config.settings || {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any)
  }

  private async syncStoryboardTtsTask(args: {
    userId: number | null
    storyboardId: number
    episodeId: number
    dramaId: number | null
    aiConfigId: number | null
    title: string | null
    payload: Record<string, unknown> | null
    status: StoryboardTtsTaskStatus
    errorMessage?: string | null
  }) {
    const [existing] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.domainTable, 'storyboard_tts'), eq(tasks.domainId, args.storyboardId)))

    const updatedAt = this.now()
    const createdAt = existing?.createdAt || updatedAt
    const isTerminal = ['completed', 'failed', 'canceled'].includes(args.status)

    const values = {
      userId: args.userId,
      type: 'audio' as const,
      status: args.status,
      title: args.title || `storyboard_tts_${args.storyboardId}`,
      progress: args.status === 'completed' ? 100 : args.status === 'queued' ? 0 : existing?.progress ?? null,
      sourceType: 'drama_storyboard_tts' as const,
      dramaId: args.dramaId,
      episodeId: args.episodeId,
      storyboardId: args.storyboardId,
      aiConfigId: args.aiConfigId,
      domainTable: 'storyboard_tts',
      domainId: args.storyboardId,
      providerTaskId: existing?.providerTaskId ?? null,
      attemptCount: existing?.attemptCount ?? 0,
      payloadJson: sanitizePayload(args.payload) ?? existing?.payloadJson ?? null,
      resultSummaryJson: null,
      errorKind:
        args.status === 'failed'
          ? 'provider'
          : args.status === 'canceled'
            ? 'canceled'
            : null,
      errorMessage:
        args.status === 'failed' || args.status === 'canceled'
          ? trimText(args.errorMessage || (args.status === 'canceled' ? 'Canceled by user' : 'Task failed'), 240)
          : null,
      errorDetailsJson:
        args.status === 'failed' || args.status === 'canceled'
          ? JSON.stringify({
            error_kind: args.status === 'canceled' ? 'canceled' : 'provider',
            raw_error: args.errorMessage || null,
          })
          : null,
      createdAt,
      updatedAt,
      startedAt: args.status === 'queued' ? existing?.startedAt ?? null : existing?.startedAt ?? updatedAt,
      completedAt: isTerminal ? updatedAt : null,
      deletedAt: existing?.deletedAt ?? null,
    }

    if (existing) {
      await this.databaseService.db
        .update(tasks)
        .set(values)
        .where(eq(tasks.id, existing.id))
      return existing.id
    }

    const [created] = await this.databaseService.db
      .insert(tasks)
      .values(values)
      .returning({ id: tasks.id })

    return created?.id ?? null
  }

  async generateTTS(params: {
    text: string
    voice: string
    model?: string
    speed?: number
    emotion?: string
    configId?: number | null
  }) {
    const config = await this.resolveAudioConfig(params.configId)
    const adapter = getTTSAdapter(config.provider)
    const defaultVoice = this.defaultVoiceForConfig(config)
    let effectiveVoice = this.isVoiceCompatible(config, params.voice) ? params.voice : defaultVoice

    if (adapter.generate) {
      let parsed
      try {
        parsed = await adapter.generate(config, {
          text: params.text,
          voice: effectiveVoice,
          model: params.model || config.model,
          speed: params.speed,
          emotion: params.emotion,
        })
      } catch (error) {
        if (config.provider !== 'volcengine' || effectiveVoice === defaultVoice || !isVolcResourceMismatch(error)) {
          throw error
        }
        effectiveVoice = defaultVoice
        parsed = await adapter.generate(config, {
          text: params.text,
          voice: effectiveVoice,
          model: params.model || config.model,
          speed: params.speed,
          emotion: params.emotion,
        })
      }

      const buffer = Buffer.from(parsed.audioHex, 'hex')
      const storedFile = await saveBufferFile(
        this.storageService,
        buffer,
        'audio',
        parsed.format || 'mp3',
        parsed.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      )
      return {
        url: storedFile.url,
        voiceId: effectiveVoice,
        provider: config.provider,
        model: config.model,
      }
    }

    const { url, method, headers, body } = adapter.buildGenerateRequest(config, {
      text: params.text,
      voice: effectiveVoice,
      model: params.model || config.model,
      speed: params.speed,
      emotion: params.emotion,
    })

    const response = await fetch(url, {
      method,
      headers,
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`TTS API error ${response.status}: ${errorText}`)
    }

    const result = await response.json() as any
    const parsed = adapter.parseResponse(result)
    const buffer = Buffer.from(parsed.audioHex, 'hex')
    const storedFile = await saveBufferFile(
      this.storageService,
      buffer,
      'audio',
      parsed.format || 'mp3',
      parsed.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
    )

    return {
      url: storedFile.url,
      voiceId: effectiveVoice,
      provider: config.provider,
      model: config.model,
    }
  }

  async generateQuickAudio(args: {
    userId: number
    text: string
    configId?: number | null
    requestedVoiceId?: string
    speed?: number
    emotion?: string
    preview?: boolean
  }) {
    const config = await this.resolveAudioConfig(args.configId)
    const defaultVoiceId = this.defaultVoiceForConfig(config)
    const voiceId = config.provider === 'volcengine' && args.requestedVoiceId && !this.isVoiceCompatible(config, args.requestedVoiceId)
      ? defaultVoiceId
      : args.requestedVoiceId || defaultVoiceId

    const generated = await this.generateTTS({
      text: args.text,
      voice: voiceId,
      speed: args.speed,
      emotion: args.emotion,
      configId: args.configId,
    })

    const publicUrl = toPublicMediaUrl(generated.url)
    if (args.preview) {
      return {
        audio_url: publicUrl,
        asset_id: null,
      }
    }

    const title = args.text.length > 36 ? `${args.text.slice(0, 36)}…` : args.text
    const asset = await this.assetsService.createQuickAudioAsset({
      userId: args.userId,
      provider: generated.provider,
      title,
      mimeType: mimeTypeFromPath(generated.url),
      url: publicUrl,
      metadataJson: JSON.stringify({
        text: args.text,
        voice_id: generated.voiceId,
        speed: args.speed,
        emotion: args.emotion || undefined,
        model: generated.model,
      }),
    })

    return {
      audio_url: publicUrl,
      asset_id: asset.id,
    }
  }

  async generateVoiceSample(args: {
    userId: number
    characterId: number
    episodeId: number
  }) {
    const [character] = await this.databaseService.db
      .select()
      .from(characters)
      .where(eq(characters.id, args.characterId))
    if (!character || character.userId !== args.userId || character.deletedAt) {
      throw new BadRequestException('角色不存在')
    }
    if (!character.voiceStyle) {
      throw new BadRequestException('请先分配音色')
    }

    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(eq(episodes.id, args.episodeId))
    if (!episode || episode.userId !== args.userId || episode.deletedAt) {
      throw new BadRequestException('episode_id is required')
    }

    const sampleText = `你好，我是${character.name}。很高兴认识你，这是我的声音试听。`
    const generated = await this.generateTTS({
      text: sampleText,
      voice: character.voiceStyle,
      configId: episode.audioConfigId ?? resolveProjectConfigId((await this.resolveEpisodeProjectDefaults(episode.id)).drama?.metadata, 'audio') ?? undefined,
    })

    await this.databaseService.db
      .update(characters)
      .set({
        voiceSampleUrl: generated.url,
        updatedAt: this.now(),
      })
      .where(eq(characters.id, character.id))

    return { voice_sample_url: generated.url }
  }

  async generateStoryboardTts(args: {
    userId: number
    storyboardId: number
  }) {
    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, args.storyboardId))
    if (!storyboard || storyboard.deletedAt) {
      throw new BadRequestException('storyboard_not_found')
    }

    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(eq(episodes.id, storyboard.episodeId))
    if (!episode || episode.userId !== args.userId || episode.deletedAt) {
      throw new BadRequestException('storyboard_not_found')
    }

    const ttsDialogue = getStoryboardTtsDialogue(storyboard)
    const parsedDialogue = parseDialogueForTTS(ttsDialogue)
    if (parsedDialogue.ignorable) {
      throw new BadRequestException('该镜头没有可生成的对白或旁白')
    }

    let voiceId = 'alloy'
    const episodeDefaults = episode ? await this.resolveEpisodeProjectDefaults(episode.id) : null
    const projectDefaults = episodeDefaults?.defaults
    if (projectDefaults?.lead_voice_id) {
      voiceId = projectDefaults.lead_voice_id
    }
    if (parsedDialogue.speaker && !isNarratorSpeaker(parsedDialogue.speaker)) {
      const rows = await this.databaseService.db
        .select()
        .from(characters)
        .where(eq(characters.dramaId, episode.dramaId))
      const matched = rows.find((row) => row.name === parsedDialogue.speaker)
      if (matched?.voiceStyle) voiceId = matched.voiceStyle
    }

    if (!parsedDialogue.pureText) {
      throw new BadRequestException('未提取到可合成的文本')
    }

    const taskPayload = {
      storyboard_id: storyboard.id,
      episode_id: episode.id,
      drama_id: episode.dramaId,
      text: parsedDialogue.pureText,
      voice_id: voiceId,
      config_id: episode.audioConfigId ?? resolveProjectConfigId(episodeDefaults?.drama?.metadata, 'audio') ?? null,
    }

    const taskTitle = trimText(storyboard.dialogue || storyboard.title || storyboard.description, 40)

    const taskId = await this.syncStoryboardTtsTask({
      userId: args.userId,
      storyboardId: storyboard.id,
      episodeId: episode.id,
      dramaId: episode.dramaId ?? null,
      aiConfigId: episode.audioConfigId ?? resolveProjectConfigId(episodeDefaults?.drama?.metadata, 'audio') ?? null,
      title: taskTitle,
      payload: taskPayload,
      status: 'queued',
    })

    if (taskId != null) {
      await this.taskQueueService.enqueueTask(taskId)
    }

    return {
      task_id: taskId,
      storyboard_id: storyboard.id,
      status: 'queued',
    }
  }

  async processStoryboardTtsTask(taskId: number) {
    const [task] = await this.databaseService.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.domainTable, 'storyboard_tts')))
    if (!task) {
      throw new BadRequestException('storyboard_tts_task_not_found')
    }

    const payload = task.payloadJson
      ? JSON.parse(task.payloadJson) as Record<string, unknown>
      : {}

    const text = String(payload.text || '').trim()
    const voiceId = String(payload.voice_id || payload.voice || 'alloy').trim() || 'alloy'
    const configId = parseConfigId(payload.config_id)
    if (!text) {
      throw new BadRequestException('storyboard_tts_text_missing')
    }

    const [storyboard] = await this.databaseService.db
      .select()
      .from(storyboards)
      .where(eq(storyboards.id, task.domainId))
    if (!storyboard || storyboard.deletedAt) {
      throw new BadRequestException('storyboard_not_found')
    }

    const [episode] = await this.databaseService.db
      .select()
      .from(episodes)
      .where(eq(episodes.id, storyboard.episodeId))
    if (!episode || episode.deletedAt) {
      throw new BadRequestException('storyboard_not_found')
    }

    const episodeDefaults = await this.resolveEpisodeProjectDefaults(episode.id)
    const projectAudioConfigId = resolveProjectConfigId(episodeDefaults.drama?.metadata, 'audio')
    const title = trimText(storyboard.dialogue || storyboard.title || storyboard.description, 40)
    await this.syncStoryboardTtsTask({
      userId: task.userId ?? episode.userId ?? null,
      storyboardId: storyboard.id,
      episodeId: episode.id,
      dramaId: episode.dramaId ?? null,
      aiConfigId: configId ?? episode.audioConfigId ?? projectAudioConfigId ?? null,
      title,
      payload,
      status: 'running',
    })

    try {
      const generated = await this.generateTTS({
        text,
        voice: voiceId,
        configId: configId ?? episode.audioConfigId ?? projectAudioConfigId ?? undefined,
      })

      await this.databaseService.db
        .update(storyboards)
        .set({
          ttsAudioUrl: generated.url,
          updatedAt: this.now(),
        })
        .where(eq(storyboards.id, storyboard.id))

      await this.syncStoryboardTtsTask({
        userId: task.userId ?? episode.userId ?? null,
        storyboardId: storyboard.id,
        episodeId: episode.id,
        dramaId: episode.dramaId ?? null,
        aiConfigId: configId ?? episode.audioConfigId ?? projectAudioConfigId ?? null,
        title,
        payload,
        status: 'completed',
      })

      try {
        await this.assetsService.ensureAssetFromTask(task.id)
      } catch (error) {
        console.error('[AudioService] Failed to auto-create asset from storyboard tts task', task.id, error)
      }

      return {
        audio_url: toPublicMediaUrl(generated.url),
        storyboard_id: storyboard.id,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TTS generation failed'
      await this.syncStoryboardTtsTask({
        userId: task.userId ?? episode.userId ?? null,
        storyboardId: storyboard.id,
        episodeId: episode.id,
        dramaId: episode.dramaId ?? null,
        aiConfigId: configId ?? episode.audioConfigId ?? projectAudioConfigId ?? null,
        title,
        payload,
        status: 'failed',
        errorMessage: message,
      })
      throw error
    }
  }

  parseQuickAudioRequest(body: Record<string, unknown>) {
    const text = String(body.text ?? body.prompt ?? '').trim()
    const configId = parseConfigId(body.config_id)
    const requestedVoiceId = String(body.voice_id ?? body.voice ?? '').trim()
    const speed = parseNumber(body.speed)
    const emotion = typeof body.emotion === 'string' ? body.emotion.trim() : ''
    const preview = body.preview === true

    if (!text) {
      throw new BadRequestException('text is required')
    }

    return {
      text,
      configId,
      requestedVoiceId,
      speed,
      emotion,
      preview,
    }
  }
}
