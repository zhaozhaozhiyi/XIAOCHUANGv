import 'reflect-metadata'
import 'dotenv/config'

import { eq } from 'drizzle-orm'

import { isMockAiConfigRow, isMockVoiceRow } from './modules/ai-configs/ai-configs.mock'

function hasFlag(flag: string) {
  return process.argv.includes(flag)
}

async function main() {
  const dryRun = hasFlag('--dry-run')

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

    const [configRows, voiceRows] = await Promise.all([
      db.select().from(aiServiceConfigs),
      db.select().from(aiVoices),
    ])

    const mockConfigs = configRows.filter((row) => isMockAiConfigRow(row))
    const mockVoices = voiceRows.filter((row) => isMockVoiceRow(row))

    if (!dryRun) {
      const timestamp = new Date()
      for (const config of mockConfigs) {
        await db
          .update(aiServiceConfigs)
          .set({
            isActive: false,
            priority: -1,
            updatedAt: timestamp,
          })
          .where(eq(aiServiceConfigs.id, config.id))
      }
      for (const voice of mockVoices) {
        await db.delete(aiVoices).where(eq(aiVoices.id, voice.id))
      }
    }

    console.log(JSON.stringify({
      ok: true,
      dry_run: dryRun,
      disabled_configs: mockConfigs.map((row) => ({
        id: row.id,
        service_type: row.serviceType,
        provider: row.provider,
        name: row.name,
      })),
      deleted_voices: mockVoices.map((row) => ({
        id: row.id,
        provider: row.provider,
        voice_id: row.voiceId,
        voice_name: row.voiceName,
      })),
    }, null, 2))
  } finally {
    await app.close()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
