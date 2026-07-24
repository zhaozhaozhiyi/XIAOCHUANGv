import 'reflect-metadata'
import 'dotenv/config'

import { and, eq } from 'drizzle-orm'
import { getProviderPreset, type AIServiceType } from '@xiaochuang/contracts'
import { prepareAiConfigSecretForStorage } from './modules/ai-configs/ai-configs.crypto'

function getSetupUserId() {
  const id = Number(process.env.AI_SETUP_USER_ID || '1')
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('AI_SETUP_USER_ID 须为正整数，请在 apps/backend/.env 中配置')
  }
  return id
}

interface ProviderPreset {
  serviceType: 'text' | 'image' | 'video' | 'audio'
  provider: string
  name: string
  description: string
  baseUrl: string
  apiKeyEnv: string
  modelEnv: string
  priority: number
  settings?: Record<string, unknown> | null
}

type ProviderEnvBinding = {
  serviceType: AIServiceType
  provider: string
  apiKeyEnv: string
  modelEnv: string
  priority: number
  settings?: Record<string, unknown> | null
}

const PROVIDER_ENV_BINDINGS: ProviderEnvBinding[] = [
  { serviceType: 'text', provider: 'moonshot', apiKeyEnv: 'MOONSHOT_API_KEY', modelEnv: 'MOONSHOT_TEXT_MODEL', priority: 900_004 },
  { serviceType: 'text', provider: 'deepseek', apiKeyEnv: 'DEEPSEEK_API_KEY', modelEnv: 'DEEPSEEK_TEXT_MODEL', priority: 900_003 },
  { serviceType: 'text', provider: 'minimax', apiKeyEnv: 'MINIMAX_API_KEY', modelEnv: 'MINIMAX_TEXT_MODEL', priority: 900_002 },
  { serviceType: 'text', provider: 'ali', apiKeyEnv: 'ALI_API_KEY', modelEnv: 'ALI_TEXT_MODEL', priority: 900_001 },
  { serviceType: 'image', provider: 'minimax', apiKeyEnv: 'MINIMAX_API_KEY', modelEnv: 'MINIMAX_IMAGE_MODEL', priority: 900_010 },
  {
    serviceType: 'audio',
    provider: 'minimax',
    apiKeyEnv: 'MINIMAX_API_KEY',
    modelEnv: 'MINIMAX_AUDIO_MODEL',
    priority: 900_009,
    settings: {
      supportedLanguageTags: ['zh-CN'],
    },
  },
]

const PRESETS: ProviderPreset[] = PROVIDER_ENV_BINDINGS.map((binding) => {
  const preset = getProviderPreset(binding.serviceType, binding.provider)
  if (!preset) {
    throw new Error(`Missing shared provider preset for ${binding.provider}/${binding.serviceType}`)
  }

  return {
    serviceType: binding.serviceType,
    provider: binding.provider,
    name: preset.defaultName,
    description: preset.defaultDescription,
    baseUrl: preset.baseUrl,
    apiKeyEnv: binding.apiKeyEnv,
    modelEnv: binding.modelEnv,
    priority: binding.priority,
    settings: binding.settings ?? null,
  }
})

async function main() {
  const [{ NestFactory }, { AppModule }, { DatabaseService }, schema] = await Promise.all([
    import('@nestjs/core'),
    import('./app.module.js'),
    import('./db/database.service.js'),
    import('./db/schema.js'),
  ])

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })

  try {
    const databaseService = app.get(DatabaseService)
    const db = databaseService.db
    const { aiServiceConfigs } = schema
    const setupUserId = getSetupUserId()
    const timestamp = new Date()
    const saved: string[] = []
    const skipped: string[] = []

    for (const preset of PRESETS) {
      const apiKey = String(process.env[preset.apiKeyEnv] || '').trim()
      const model = String(process.env[preset.modelEnv] || '').trim()
      if (!apiKey || !model) {
        skipped.push(`${preset.provider}/${preset.serviceType}`)
        continue
      }

      await db
        .delete(aiServiceConfigs)
        .where(and(
          eq(aiServiceConfigs.userId, setupUserId),
          eq(aiServiceConfigs.provider, preset.provider),
          eq(aiServiceConfigs.serviceType, preset.serviceType),
        ))

      await db.insert(aiServiceConfigs).values({
        userId: setupUserId,
        serviceType: preset.serviceType,
        provider: preset.provider,
        name: preset.name,
        description: preset.description,
        baseUrl: preset.baseUrl,
        apiKey: prepareAiConfigSecretForStorage(apiKey),
        model: JSON.stringify([model]),
        priority: preset.priority,
        isDefault: false,
        isActive: true,
        settings: preset.settings ? JSON.stringify(preset.settings) : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })

      saved.push(`${preset.provider}/${preset.serviceType}`)
    }

    console.log(JSON.stringify({ ok: true, saved, skipped }))
  } finally {
    await app.close()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
