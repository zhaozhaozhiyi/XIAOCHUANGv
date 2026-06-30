import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'
import { and, desc, eq, isNull, or } from 'drizzle-orm'
import { z } from 'zod'

import { toSnakeCase } from '../../common/transform'
import { DatabaseService } from '../../db/database.service'
import { agentConfigs, aiServiceConfigs, aiVoices } from '../../db/schema'
import { CurrentUser } from '../auth/current-user.decorator'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import type { CurrentUser as CurrentUserType } from '../auth/auth.types'
import {
  AI_PROVIDER_CATALOG,
  buildProbe,
  fallbackVoicesForConfig,
  HUOBAO_AGENT_DEFAULTS,
  HUOBAO_AGENT_MODEL,
  HUOBAO_PRESET_SERVICES,
  extractLanguage,
  joinProviderUrl,
  parseVolcVoices,
  redactUrl,
  shouldKeepVoice,
} from './ai-configs.utils'
import { isMockAiConfigRow, isMockVoiceRow } from './ai-configs.mock'

const configListQuerySchema = z.object({
  service_type: z.string().trim().optional(),
})

const createConfigSchema = z.object({
  service_type: z.string().trim(),
  provider: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: z.string().trim().min(1),
  base_url: z.string().trim().min(1),
  api_key: z.string().trim().min(1),
  model: z.any(),
  settings: z.any().optional(),
  priority: z.coerce.number().optional(),
})

const updateConfigSchema = z.object({
  provider: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
  description: z.string().trim().min(1).optional(),
  base_url: z.string().trim().min(1).optional(),
  api_key: z.string().trim().optional(),
  model: z.any().optional(),
  settings: z.any().optional(),
  priority: z.coerce.number().optional(),
  is_active: z.coerce.boolean().optional(),
})

const aiConfigTestSchema = z.object({
  service_type: z.string().trim(),
  provider: z.string().trim(),
  base_url: z.string().trim(),
  model: z.any().optional(),
  api_key: z.string().trim().optional(),
  settings: z.any().optional(),
})

function maskApiKey(value: string | null) {
  const raw = String(value || '')
  if (!raw) return ''
  if (raw.length <= 8) return '*'.repeat(raw.length)
  return `${raw.slice(0, 4)}${'*'.repeat(Math.max(4, raw.length - 8))}${raw.slice(-4)}`
}

function parseModel(value: string | null) {
  return value ? JSON.parse(value) : []
}

function parseSettings(value: string | null) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizeAiConfig(row: typeof aiServiceConfigs.$inferSelect) {
  return toSnakeCase({
    ...row,
    apiKey: maskApiKey(row.apiKey),
    model: parseModel(row.model),
    settings: parseSettings(row.settings),
    isActive: row.isActive ?? true,
    isDefault: row.isDefault ?? false,
  } as unknown as Record<string, unknown>)
}

function toOptionalString(value: unknown) {
  return typeof value === 'string' ? value : null
}

function toOptionalNumber(value: unknown) {
  return typeof value === 'number' ? value : null
}

function toOptionalBoolean(value: unknown) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number' && (value === 0 || value === 1)) return Boolean(value)
  return null
}

function parsePayloadModel(value: unknown) {
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim()) return [value.trim()]
  return []
}

function now() {
  return new Date()
}

function configAccessFilter(userId: number) {
  return or(eq(aiServiceConfigs.userId, userId), isNull(aiServiceConfigs.userId))
}

@ApiTags('ai-configs')
@Controller('ai-configs')
@UseGuards(SessionAuthGuard)
export class AiConfigsController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get()
  async list(@Query() query: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const parsed = configListQuerySchema.parse(query)
    const filters = [configAccessFilter(currentUser.id)]
    if (parsed.service_type) {
      filters.push(eq(aiServiceConfigs.serviceType, parsed.service_type))
    }

    const rows = await this.databaseService.db
      .select()
      .from(aiServiceConfigs)
      .where(and(...filters))
      .orderBy(desc(aiServiceConfigs.priority), desc(aiServiceConfigs.updatedAt))
    return rows.filter((row) => !isMockAiConfigRow(row)).map(normalizeAiConfig)
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const payload = createConfigSchema.parse(body)
    const ts = now()
    const [result] = await this.databaseService.db
      .insert(aiServiceConfigs)
      .values({
        userId: currentUser.id,
        serviceType: payload.service_type,
        provider: payload.provider,
        name: payload.name,
        description: payload.description,
        baseUrl: payload.base_url,
        apiKey: payload.api_key,
        model: JSON.stringify(parsePayloadModel(payload.model)),
        settings: payload.settings ? JSON.stringify(payload.settings) : null,
        priority: payload.priority || 0,
        isActive: true,
        createdAt: ts,
        updatedAt: ts,
      })
      .returning()

    return normalizeAiConfig(result)
  }

  @Get(':id')
  async getOne(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const configId = Number(id)
    if (!Number.isInteger(configId) || configId <= 0) {
      return { error: 'invalid_ai_config_id' }
    }

    const [row] = await this.databaseService.db
      .select()
      .from(aiServiceConfigs)
      .where(and(eq(aiServiceConfigs.id, configId), or(eq(aiServiceConfigs.userId, currentUser.id), isNull(aiServiceConfigs.userId))))

    if (!row) {
      return { error: 'not_found' }
    }

    return normalizeAiConfig(row)
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const configId = Number(id)
    if (!Number.isInteger(configId) || configId <= 0) {
      return { error: 'invalid_ai_config_id' }
    }

    const payload = updateConfigSchema.parse(body)
    const updates: Partial<typeof aiServiceConfigs.$inferInsert> = { updatedAt: now() }
    let hasUpdates = false

    if ('provider' in payload && payload.provider !== undefined) {
      updates.provider = payload.provider
      hasUpdates = true
    }
    if ('name' in payload && payload.name !== undefined) {
      updates.name = payload.name
      hasUpdates = true
    }
    if ('description' in payload && payload.description !== undefined) {
      updates.description = payload.description
      hasUpdates = true
    }
    if ('base_url' in payload && payload.base_url !== undefined) {
      updates.baseUrl = payload.base_url
      hasUpdates = true
    }
    if ('api_key' in payload && payload.api_key !== undefined) {
      updates.apiKey = payload.api_key
      hasUpdates = true
    }
    if ('model' in payload && payload.model !== undefined) {
      updates.model = JSON.stringify(parsePayloadModel(payload.model))
      hasUpdates = true
    }
    if ('settings' in payload && payload.settings !== undefined) {
      updates.settings = payload.settings ? JSON.stringify(payload.settings) : null
      hasUpdates = true
    }
    if ('priority' in payload && payload.priority !== undefined) {
      updates.priority = payload.priority
      hasUpdates = true
    }
    if ('is_active' in payload && payload.is_active !== undefined) {
      updates.isActive = payload.is_active
      hasUpdates = true
    }

    if (!hasUpdates) {
      return { error: 'no_valid_fields' }
    }

    const [existing] = await this.databaseService.db
      .select()
      .from(aiServiceConfigs)
      .where(and(eq(aiServiceConfigs.id, configId), configAccessFilter(currentUser.id)))

    if (!existing) {
      return { error: 'not_found' }
    }

    if (existing.userId == null) {
      updates.userId = currentUser.id
    }

    const result = await this.databaseService.db
      .update(aiServiceConfigs)
      .set(updates)
      .where(eq(aiServiceConfigs.id, configId))
      .returning()

    const row = result[0]
    if (!row) {
      return { error: 'not_found' }
    }

    return normalizeAiConfig(row)
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserType) {
    const configId = Number(id)
    if (!Number.isInteger(configId) || configId <= 0) {
      return { error: 'invalid_ai_config_id' }
    }

    const result = await this.databaseService.db
      .delete(aiServiceConfigs)
      .where(and(eq(aiServiceConfigs.id, configId), configAccessFilter(currentUser.id)))
      .returning({ id: aiServiceConfigs.id })

    if (!result.length) {
      return { error: 'not_found' }
    }

    return { success: true }
  }

  @Post('test')
  async test(@Body() body: Record<string, unknown>) {
    const payload = aiConfigTestSchema.parse(body)
    const model = Array.isArray(payload.model) ? String(payload.model[0] || '') : String(payload.model || '')
    let probe
    try {
      const settings = payload.settings && typeof payload.settings === 'object' && !Array.isArray(payload.settings)
        ? payload.settings as Record<string, unknown>
        : undefined
      probe = buildProbe(payload.service_type, payload.provider, payload.base_url, model, payload.api_key, settings)
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Invalid AI config' }
    }
    const probeUrl = redactUrl(probe.url)

    if (probe.url.startsWith('wss://') || probe.url.startsWith('ws://')) {
      const WebSocketClient = require('ws') as any
      const wsResult = await new Promise<{ ok: boolean; statusText: string; message: string }>((resolve) => {
        let settled = false
        const socket = new WebSocketClient(probe.url, { headers: probe.headers, handshakeTimeout: 10000 })
        const timer = setTimeout(() => finish(false, 'TIMEOUT', 'WebSocket 握手超时，请检查端点和网络'), 12000)

        function finish(okValue: boolean, statusText: string, message: string) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          if (socket.readyState === WebSocketClient.OPEN || socket.readyState === WebSocketClient.CONNECTING) {
            socket.close()
          }
          resolve({ ok: okValue, statusText, message })
        }

        socket.once('open', () => finish(true, 'WEBSOCKET_OPEN', 'WebSocket 端点已完成握手'))
        socket.once('error', (error: Error) => finish(false, 'WEBSOCKET_ERROR', error.message || 'WebSocket 握手失败'))
        socket.once('unexpected-response', (_request: unknown, response: { statusCode?: number; statusMessage?: string }) => {
          const statusCode = response.statusCode || 0
          const statusMessage = response.statusMessage || 'Unexpected response'
          finish(false, `HTTP_${statusCode}`, `WebSocket 握手被拒绝：${statusCode} ${statusMessage}`)
        })
        socket.once('close', (code: number, reason: Buffer) => {
          if (settled) return
          const suffix = reason.length ? `：${reason.toString('utf8')}` : ''
          finish(false, `WEBSOCKET_CLOSE_${code}`, `WebSocket 握手关闭${suffix}`)
        })
      })

      return {
        ok: wsResult.ok,
        reachable: wsResult.ok,
        status: 0,
        status_text: wsResult.statusText,
        method: probe.method,
        url: probeUrl,
        message: wsResult.message,
        response_preview: '',
      }
    }

    try {
      const response = await fetch(probe.url, {
        method: probe.method,
        headers: probe.headers,
        body: probe.body ? JSON.stringify(probe.body) : undefined,
      })
      const text = await response.text()
      const reachable = [200, 204, 400, 401, 403].includes(response.status)

      return {
        ok: response.ok,
        reachable,
        status: response.status,
        status_text: response.statusText,
        method: probe.method,
        url: probeUrl,
        message: reachable
          ? (response.ok ? '端点可访问，认证与路径基本正常' : '端点已响应，请根据状态码判断认证或路径是否正确')
          : '端点未按预期响应，请检查 Base URL 和代理前缀',
        response_preview: text.slice(0, 240),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求失败'
      return {
        ok: false,
        reachable: false,
        method: probe.method,
        url: probeUrl,
        message,
        response_preview: '',
      }
    }
  }

  @Post('xiaochuang-preset')
  async xiaochuangPreset(@Body() body: Record<string, unknown>, @CurrentUser() currentUser: CurrentUserType) {
    const apiKey = String(body.api_key || '').trim()
    if (!apiKey) {
      return { error: 'api_key is required' }
    }

    const ts = now()

    for (const preset of HUOBAO_PRESET_SERVICES) {
      const [existing] = await this.databaseService.db
        .select()
        .from(aiServiceConfigs)
        .where(and(eq(aiServiceConfigs.serviceType, preset.serviceType), eq(aiServiceConfigs.userId, currentUser.id)))

      const values = {
        userId: currentUser.id,
        serviceType: preset.serviceType,
        provider: preset.provider,
        name: preset.name,
        description: preset.description,
        baseUrl: preset.baseUrl,
        apiKey,
        model: JSON.stringify([preset.model]),
        priority: preset.priority,
        isActive: true,
        settings: 'settings' in preset ? JSON.stringify(preset.settings) : null,
        updatedAt: ts,
      }

      if (existing) {
        await this.databaseService.db.update(aiServiceConfigs).set(values).where(eq(aiServiceConfigs.id, existing.id))
      } else {
        await this.databaseService.db.insert(aiServiceConfigs).values({ ...values, createdAt: ts })
      }
    }

    for (const agent of HUOBAO_AGENT_DEFAULTS) {
      const [existing] = await this.databaseService.db
        .select()
        .from(agentConfigs)
        .where(and(eq(agentConfigs.agentType, agent.agentType), eq(agentConfigs.userId, currentUser.id)))

      if (existing) {
        await this.databaseService.db.update(agentConfigs)
          .set({
            name: agent.name,
            model: HUOBAO_AGENT_MODEL,
            isActive: true,
            deletedAt: null,
            updatedAt: ts,
          })
          .where(eq(agentConfigs.id, existing.id))
      } else {
        await this.databaseService.db.insert(agentConfigs).values({
          userId: currentUser.id,
          agentType: agent.agentType,
          description: '',
          model: HUOBAO_AGENT_MODEL,
          name: agent.name,
          systemPrompt: '',
          temperature: 0.7,
          maxTokens: 4096,
          maxIterations: 10,
          isActive: true,
          createdAt: ts,
          updatedAt: ts,
        })
      }
    }

    const configs = (await this.databaseService.db.select().from(aiServiceConfigs))
      .filter((row) => !isMockAiConfigRow(row))
      .map(normalizeAiConfig)
    const agents = await this.databaseService.db.select().from(agentConfigs)

    return {
      configs,
      agents,
      agent_model: HUOBAO_AGENT_MODEL,
    }
  }
}

@ApiTags('ai-providers')
@Controller('ai-providers')
export class AiProvidersController {
  @Get()
  list() {
    return AI_PROVIDER_CATALOG.map((item, index) => ({
      id: index + 1,
      name: `${item.provider}-${item.serviceType}`,
      display_name: item.displayName,
      service_type: item.serviceType,
      provider: item.provider,
      default_url: item.defaultUrl,
      preset_models: [...item.presetModels],
      description: item.description,
      is_active: true,
    }))
  }
}

@ApiTags('ai-voices')
@Controller('ai-voices')
@UseGuards(SessionAuthGuard)
export class AiVoicesController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  private mapVoiceRows(rows: Array<typeof aiVoices.$inferSelect>) {
    return rows.map((row) => ({
      voice_id: row.voiceId,
      voice_name: row.voiceName,
      description: row.description ? JSON.parse(row.description) : [],
      language: row.language,
      provider: row.provider,
    }))
  }

  private async syncMinimaxVoices(config: typeof aiServiceConfigs.$inferSelect) {
    if (!config?.apiKey) return 0

    const response = await fetch(joinProviderUrl(config.baseUrl, '/v1', '/get_voice'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ voice_type: 'all' }),
    })

    if (!response.ok) {
      throw new Error(`MiniMax API error: ${response.status}`)
    }

    const result = (await response.json()) as {
      base_resp?: { status_code?: number; status_msg?: string }
      system_voice?: Array<{ voice_id: string; voice_name: string; description?: unknown[] }>
    }

    if (result.base_resp?.status_code !== 0) {
      throw new Error(result.base_resp?.status_msg || 'Failed to fetch voices')
    }

    const voices = (result.system_voice || []).filter((voice) => shouldKeepVoice({ voice_id: voice.voice_id, voice_name: voice.voice_name }))
    const ts = now()

    await this.databaseService.db.delete(aiVoices).where(eq(aiVoices.provider, 'minimax'))

    const insertRows = voices.map((voice) => ({
      voiceId: voice.voice_id,
      voiceName: voice.voice_name,
      description: JSON.stringify(voice.description || []),
      language: extractLanguage(voice.voice_id, voice.voice_name),
      provider: 'minimax',
      createdAt: ts,
    }))

    if (insertRows.length) {
      await this.databaseService.db.insert(aiVoices).values(insertRows)
    }

    return insertRows.length
  }

  @Get()
  async list(@Query('provider') requestedProvider?: string, @Query('config_id') requestedConfigId?: string) {
    const activeAudioConfigs = (await this.databaseService.db.select().from(aiServiceConfigs)
      .where(eq(aiServiceConfigs.serviceType, 'audio')))
      .filter((row) => row.isActive && !isMockAiConfigRow(row))
      .sort((a, b) => (Number(b.priority || 0) - Number(a.priority || 0)))

    // 解析目标配置：优先按 config_id，其次按请求的 provider，最后回退到最高优先级的激活配置。
    // 这样切换到“非当前默认”的服务商时，音色同步与回退也会基于该服务商的配置进行。
    const requestedConfigIdNum = Number(requestedConfigId)
    const targetConfig =
      (Number.isInteger(requestedConfigIdNum) && requestedConfigIdNum > 0
        ? activeAudioConfigs.find((row) => row.id === requestedConfigIdNum)
        : undefined)
      ?? (requestedProvider
        ? activeAudioConfigs.find((row) => row.provider === requestedProvider)
        : undefined)
      ?? activeAudioConfigs[0]

    const provider = requestedProvider || targetConfig?.provider || ''
    let rows = await this.databaseService.db.select().from(aiVoices).where(eq(aiVoices.provider, provider))

    if (
      !rows.some((row) => !row.voiceId.startsWith('mock-voice-'))
      && targetConfig?.provider === 'minimax'
    ) {
      try {
        await this.syncMinimaxVoices(targetConfig)
        rows = await this.databaseService.db.select().from(aiVoices).where(eq(aiVoices.provider, provider))
      } catch {
        // Fall back to configured voices if upstream sync fails.
      }
    }

    const compatibleRows = (provider === 'volcengine'
      ? rows.filter((row) => shouldKeepVoice({ voice_id: row.voiceId, voice_name: row.voiceName }))
      : rows.filter((row) => !isMockVoiceRow(row)))

    return compatibleRows.length
      ? this.mapVoiceRows(compatibleRows)
      : fallbackVoicesForConfig(targetConfig)
        .filter((voice) => voice.provider === provider)
        .map((voice) => ({
          voice_id: voice.voiceId,
          voice_name: voice.voiceName,
          description: voice.description,
          language: voice.language,
          provider: voice.provider,
        }))
  }

  @Post('sync')
  async sync() {
    const rows = (await this.databaseService.db.select().from(aiServiceConfigs).where(eq(aiServiceConfigs.serviceType, 'audio')))
      .filter((row) => row.isActive && !isMockAiConfigRow(row))
      .sort((a, b) => (Number(b.priority || 0) - Number(a.priority || 0)))

    const config = rows[0]
    if (!config) {
      return { error: 'No active audio config found' }
    }
    if (config.provider === 'volcengine') {
      const ts = now()
      const voices = parseVolcVoices(config)
      await this.databaseService.db.delete(aiVoices).where(eq(aiVoices.provider, 'volcengine'))
      if (voices.length) {
        await this.databaseService.db.insert(aiVoices).values(voices.map((voice) => ({
          voiceId: voice.voiceId,
          voiceName: voice.voiceName,
          description: JSON.stringify(voice.description),
          language: voice.language,
          provider: 'volcengine',
          createdAt: ts,
        })))
      }

      return { count: voices.length, message: `Synced ${voices.length} VolcEngine voices` }
    }

    if (config.provider !== 'minimax') {
      return { error: `Audio voice sync is not supported for provider: ${config.provider}` }
    }

    try {
      const count = await this.syncMinimaxVoices(config)
      return { count, message: `Synced ${count} voices` }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Failed to sync MiniMax voices' }
    }
  }
}
