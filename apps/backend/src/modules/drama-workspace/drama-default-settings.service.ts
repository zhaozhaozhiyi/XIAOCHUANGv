import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { and, eq, isNull } from 'drizzle-orm'

import { DatabaseService } from '../../db/database.service'
import { dramas } from '../../db/schema'
import { AiConfigResolverService, type ServiceType } from '../ai-configs/ai-configs.resolver'
import { readProjectDefaults, withProjectDefaults } from '../dramas/drama-metadata'

type DefaultSettingsPatch = Partial<{
  text_config_id: number | null
  image_config_id: number | null
  video_config_id: number | null
  audio_config_id: number | null
  visual_style: string | null
  aspect_ratio: string | null
  reference_asset_ids: number[]
  character_consistency: string | null
  scene_consistency: string | null
  lead_character_name: string | null
  lead_character_description: string | null
  lead_voice_id: string | null
  voice_notes: string | null
}>

function now() {
  return new Date()
}

function toOptionalNumber(value: unknown) {
  if (value == null || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new BadRequestException('invalid_config_id')
  return parsed
}

function toOptionalString(value: unknown) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

function toNumberArray(value: unknown) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new BadRequestException('invalid_reference_asset_ids')
  return value.map((item) => toOptionalNumber(item)).filter((item): item is number => item != null)
}

function sanitizePatch(raw: Record<string, unknown>): DefaultSettingsPatch {
  const patch: DefaultSettingsPatch = {}
  const numberFields = ['text_config_id', 'image_config_id', 'video_config_id', 'audio_config_id'] as const
  const stringFields = [
    'visual_style',
    'aspect_ratio',
    'character_consistency',
    'scene_consistency',
    'lead_character_name',
    'lead_character_description',
    'lead_voice_id',
    'voice_notes',
  ] as const

  for (const field of numberFields) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) patch[field] = toOptionalNumber(raw[field])
  }
  for (const field of stringFields) {
    if (Object.prototype.hasOwnProperty.call(raw, field)) patch[field] = toOptionalString(raw[field])
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'reference_asset_ids')) {
    patch.reference_asset_ids = toNumberArray(raw.reference_asset_ids)
  }
  return patch
}

@Injectable()
export class DramaDefaultSettingsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AiConfigResolverService) private readonly aiConfigResolver: AiConfigResolverService,
  ) {}

  async getResolvedSettings(dramaId: number, userId: number) {
    const drama = await this.requireOwnedDrama(dramaId, userId)
    const settings = readProjectDefaults(drama.metadata)
    const resolved = {
      text: await this.resolveConfigSummary('text', settings.text_config_id, userId),
      image: await this.resolveConfigSummary('image', settings.image_config_id, userId),
      video: await this.resolveConfigSummary('video', settings.video_config_id, userId),
      audio: await this.resolveConfigSummary('audio', settings.audio_config_id, userId),
      visual_style: settings.visual_style ?? drama.style ?? null,
      aspect_ratio: settings.aspect_ratio ?? null,
      reference_asset_ids: settings.reference_asset_ids,
      character_consistency: settings.character_consistency ?? null,
      scene_consistency: settings.scene_consistency ?? null,
    }

    return {
      settings,
      resolved,
      version: drama.updatedAt?.toISOString() ?? '',
      updated_at: drama.updatedAt?.toISOString() ?? '',
    }
  }

  async updateSettings(dramaId: number, userId: number, rawPatch: Record<string, unknown>, version?: string | null) {
    const drama = await this.requireOwnedDrama(dramaId, userId)
    const currentVersion = drama.updatedAt?.toISOString() ?? ''
    if (version && version !== currentVersion) {
      throw new ConflictException('drama_metadata_version_conflict')
    }

    const patch = sanitizePatch(rawPatch)
    const metadata = withProjectDefaults(drama.metadata, patch)
    const [updated] = await this.db.db
      .update(dramas)
      .set({ metadata: JSON.stringify(metadata), updatedAt: now() })
      .where(eq(dramas.id, drama.id))
      .returning()

    return this.getResolvedSettings(updated.id, userId)
  }

  private async resolveConfigSummary(serviceType: ServiceType, configId: number | null, userId: number) {
    const row = configId
      ? await this.aiConfigResolver.getConfigRowById(configId, userId)
      : await this.aiConfigResolver.getActiveRow(serviceType, userId)
    if (!row) {
      return {
        config_id: configId ?? null,
        inherited: configId == null,
        available: false,
        provider: null,
        model: null,
        name: null,
      }
    }
    return {
      config_id: row.id,
      inherited: configId == null,
      available: true,
      provider: row.provider,
      model: row.model,
      name: row.name,
    }
  }

  private async requireOwnedDrama(dramaId: number, userId: number) {
    const [drama] = await this.db.db
      .select()
      .from(dramas)
      .where(and(eq(dramas.id, dramaId), eq(dramas.userId, userId), isNull(dramas.deletedAt)))

    if (!drama) throw new NotFoundException('drama_not_found')
    return drama
  }
}
