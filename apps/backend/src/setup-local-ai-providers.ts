import 'reflect-metadata'
import 'dotenv/config'

import { and, eq } from 'drizzle-orm'

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

const PRESETS: ProviderPreset[] = [
  {
    serviceType: 'text',
    provider: 'moonshot',
    name: '月之暗面',
    description: '文本 · Kimi，Agent 对话',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    modelEnv: 'MOONSHOT_TEXT_MODEL',
    priority: 900_004,
  },
  {
    serviceType: 'text',
    provider: 'deepseek',
    name: 'DeepSeek',
    description: '文本 · 高性价比推理',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    modelEnv: 'DEEPSEEK_TEXT_MODEL',
    priority: 900_003,
  },
  {
    serviceType: 'text',
    provider: 'minimax',
    name: 'MiniMax',
    description: '文本 · abab，Agent 对话',
    baseUrl: 'https://api.minimaxi.com/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    modelEnv: 'MINIMAX_TEXT_MODEL',
    priority: 900_002,
  },
  {
    serviceType: 'text',
    provider: 'ali',
    name: '阿里云',
    description: '文本 · 通义 Qwen，Agent 对话',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'ALI_API_KEY',
    modelEnv: 'ALI_TEXT_MODEL',
    priority: 900_001,
  },
  {
    serviceType: 'image',
    provider: 'minimax',
    name: 'MiniMax',
    description: '图片 · image-01，角色与场景图',
    baseUrl: 'https://api.minimaxi.com',
    apiKeyEnv: 'MINIMAX_API_KEY',
    modelEnv: 'MINIMAX_IMAGE_MODEL',
    priority: 900_010,
  },
  {
    serviceType: 'audio',
    provider: 'minimax',
    name: 'MiniMax',
    description: '音频 · 高清 TTS',
    baseUrl: 'https://api.minimaxi.com',
    apiKeyEnv: 'MINIMAX_API_KEY',
    modelEnv: 'MINIMAX_AUDIO_MODEL',
    priority: 900_009,
  },
]

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
        apiKey,
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
