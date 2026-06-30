import 'reflect-metadata'

import { and, eq } from 'drizzle-orm'

import { DEFAULT_MOCK_AI_PORT, MOCK_AI_CONFIG_PRESETS, MOCK_AI_VOICES, getMockAiBaseUrl } from './mock-ai.shared'

function hasFlag(flag: string) {
  return process.argv.includes(flag)
}

function ensureMockSetupExplicitlyAllowed() {
  const allowedByEnv = String(process.env.ALLOW_MOCK_AI_SETUP || '').trim() === '1'
  const allowedByFlag = hasFlag('--allow-mock-setup')
  if (allowedByEnv || allowedByFlag) return

  throw new Error(
    [
      'Mock AI 写库已被默认禁用，避免污染真实默认模型环境。',
      '如需显式写入 mock 配置，请使用以下任一方式：',
      '1. ALLOW_MOCK_AI_SETUP=1 npm run mock:ai:setup --workspace apps/backend',
      '2. npm run mock:ai:setup --workspace apps/backend -- --allow-mock-setup',
    ].join('\n'),
  )
}

function getSetupUserId() {
  const id = Number(process.env.AI_SETUP_USER_ID || '1')
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('AI_SETUP_USER_ID 须为正整数，请在 apps/backend/.env 中配置')
  }
  return id
}

function parsePort() {
  const arg = process.argv.find((item) => item.startsWith('--port='))
  const value = Number(arg?.slice('--port='.length) || process.env.MOCK_AI_PORT || DEFAULT_MOCK_AI_PORT)
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_MOCK_AI_PORT
}

async function main() {
  ensureMockSetupExplicitlyAllowed()
  const port = parsePort()
  const baseUrl = getMockAiBaseUrl(port)

  const healthResponse = await fetch(`${baseUrl}/health`).catch(() => null)
  if (!healthResponse?.ok) {
    throw new Error(`Mock AI server is not reachable: ${baseUrl}`)
  }

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
    const { aiServiceConfigs, aiVoices } = schema
    const setupUserId = getSetupUserId()
    const timestamp = new Date()
    const savedConfigIds: number[] = []

    for (const preset of MOCK_AI_CONFIG_PRESETS) {
      const rows = await db
        .select()
        .from(aiServiceConfigs)
        .where(and(eq(aiServiceConfigs.name, preset.name), eq(aiServiceConfigs.userId, setupUserId)))

      const [existing, ...duplicates] = rows
      for (const duplicate of duplicates) {
        await db.delete(aiServiceConfigs).where(eq(aiServiceConfigs.id, duplicate.id))
      }

      const values = {
        userId: setupUserId,
        serviceType: preset.serviceType,
        provider: preset.provider,
        name: preset.name,
        baseUrl: baseUrl,
        apiKey: preset.apiKey,
        model: JSON.stringify([preset.model]),
        priority: 900_000,
        isDefault: false,
        isActive: true,
        settings: null,
        updatedAt: timestamp,
      }

      if (existing) {
        const [updated] = await db
          .update(aiServiceConfigs)
          .set(values)
          .where(eq(aiServiceConfigs.id, existing.id))
          .returning({ id: aiServiceConfigs.id })
        if (updated?.id) savedConfigIds.push(updated.id)
      } else {
        const [created] = await db
          .insert(aiServiceConfigs)
          .values({ ...values, createdAt: timestamp })
          .returning({ id: aiServiceConfigs.id })
        if (created?.id) savedConfigIds.push(created.id)
      }
    }

    for (const voice of MOCK_AI_VOICES) {
      const [existing] = await db
        .select()
        .from(aiVoices)
        .where(eq(aiVoices.voiceId, voice.voiceId))

      const values = {
        voiceId: voice.voiceId,
        voiceName: voice.voiceName,
        description: JSON.stringify([...voice.description]),
        language: voice.language,
        provider: voice.provider,
      }

      if (existing) {
        await db
          .update(aiVoices)
          .set(values)
          .where(eq(aiVoices.id, existing.id))
      } else {
        await db
          .insert(aiVoices)
          .values({ ...values, createdAt: timestamp })
      }
    }

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      configs: savedConfigIds.length,
      voices: MOCK_AI_VOICES.length,
    }))
  } finally {
    await app.close()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
