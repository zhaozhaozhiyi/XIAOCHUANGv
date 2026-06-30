import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { and, desc, eq, isNull, or } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { aiServiceConfigs } from '../../db/schema'
import { isMockAiConfigRow } from './ai-configs.mock'

export type ServiceType = 'text' | 'image' | 'video' | 'audio'

export interface AIConfig {
  id: number
  userId: number | null
  serviceType: ServiceType
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  modelList: string[]
  settings: Record<string, unknown>
}

export type AIConfigRow = typeof aiServiceConfigs.$inferSelect

function parseSettings(value: string | null) {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function parseModelList(value: string | null) {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || '').trim()).filter(Boolean)
    }
  } catch {
    // ignore and fall through
  }
  const raw = String(value || '').trim()
  return raw ? [raw] : []
}

function normalizeConfigRow(row: AIConfigRow | undefined): AIConfig | null {
  if (!row) return null

  const provider = String(row.provider || '').trim()
  const baseUrl = String(row.baseUrl || '').trim()
  const modelList = parseModelList(row.model)
  const serviceType = String(row.serviceType || '').trim() as ServiceType
  const fallbackApiKey =
    provider === 'volcengine' && serviceType === 'audio'
      ? String(process.env.VOLC_ACCESS_KEY || '').trim()
      : ''
  const apiKey = String(row.apiKey || fallbackApiKey).trim()

  const config: AIConfig = {
    id: row.id,
    userId: row.userId ?? null,
    serviceType,
    provider,
    baseUrl,
    apiKey,
    model: String(modelList[0] || '').trim(),
    modelList,
    settings: parseSettings(row.settings),
  }

  if (!config.provider || !config.baseUrl || !config.apiKey || !config.model) {
    return null
  }

  return config
}

@Injectable()
export class AiConfigResolverService {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  async getActiveRow(serviceType: ServiceType, userId?: number | null) {
    const rows = await this.listCandidateRows(serviceType, userId)
    return rows.find((row) => row.isActive) ?? null
  }

  async getActiveConfig(serviceType: ServiceType, userId?: number | null): Promise<AIConfig | null> {
    const row = await this.getActiveRow(serviceType, userId)
    return normalizeConfigRow(row ?? undefined)
  }

  async getConfigRowById(id: number, userId?: number | null) {
    const filters = [eq(aiServiceConfigs.id, id)]
    if (userId != null) {
      filters.push(or(eq(aiServiceConfigs.userId, userId), isNull(aiServiceConfigs.userId))!)
    }
    const [row] = await this.databaseService.db
      .select()
      .from(aiServiceConfigs)
      .where(and(...filters))
    return row?.isActive ? row : null
  }

  async getConfigById(id: number, userId?: number | null): Promise<AIConfig | null> {
    const row = await this.getConfigRowById(id, userId)
    return normalizeConfigRow(row ?? undefined)
  }

  async resolveConfig(serviceType: ServiceType, configId?: number | null, userId?: number | null): Promise<AIConfig> {
    const config = configId
      ? await this.getConfigById(configId, userId) || await this.getActiveConfig(serviceType, userId)
      : await this.getActiveConfig(serviceType, userId)
    if (!config) {
      throw new BadRequestException(`No active ${serviceType} AI config`)
    }
    return config
  }

  async resolveConfigRow(serviceType: ServiceType, configId?: number | null, userId?: number | null) {
    const row = configId
      ? await this.getConfigRowById(configId, userId) || await this.getActiveRow(serviceType, userId)
      : await this.getActiveRow(serviceType, userId)
    if (!row) {
      throw new BadRequestException(`No active ${serviceType} AI config`)
    }
    return row
  }

  private async listCandidateRows(serviceType: ServiceType, userId?: number | null) {
    const filters = [
      eq(aiServiceConfigs.serviceType, serviceType),
      eq(aiServiceConfigs.isActive, true),
    ]
    if (userId != null) {
      filters.push(or(eq(aiServiceConfigs.userId, userId), isNull(aiServiceConfigs.userId))!)
    }
    const rows = await this.databaseService.db
      .select()
      .from(aiServiceConfigs)
      .where(and(...filters))
      .orderBy(desc(aiServiceConfigs.priority), desc(aiServiceConfigs.updatedAt))
    return rows.filter((row) => !isMockAiConfigRow(row))
  }
}
