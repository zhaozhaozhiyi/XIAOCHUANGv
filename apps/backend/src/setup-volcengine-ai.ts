import 'reflect-metadata'
// 直接从 apps/backend/.env 载入环境变量：NestJS ConfigModule 的 schema 会
// 过滤未知键，导致 VOLC_* 无法透传，因此这里显式加载一次。
import 'dotenv/config'

import { and, eq } from 'drizzle-orm'

function getSetupUserId() {
  const id = Number(process.env.AI_SETUP_USER_ID || '1')
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('AI_SETUP_USER_ID 须为正整数，请在 apps/backend/.env 中配置')
  }
  return id
}

// 把火山方舟（Volcengine Ark）模型写入当前用户的 AI 服务配置。
// 密钥与接入点 ID 全部来自 apps/backend/.env（已被 .gitignore 忽略），
// 本脚本不含任何明文密钥，可安全提交到 git。
// 运行：npm run volc:setup（在 apps/backend 下）

// 优先级高于 Mock 预设（900_000），确保默认走真实模型。
const TEXT_PRIORITY_PRO = 1_000_002
const TEXT_PRIORITY_DEEPSEEK = 1_000_001
const TEXT_PRIORITY_MINI = 1_000_000
const VIDEO_PRIORITY = 1_000_000

interface VolcPreset {
  serviceType: 'text' | 'video'
  name: string
  description: string
  model: string | undefined
  priority: number
}

function buildPresets(): VolcPreset[] {
  return [
    {
      serviceType: 'text',
      name: 'Doubao-Seed-2.0-pro',
      description: '文本 · 豆包 Seed 2.0 Pro，Agent 对话',
      model: process.env.VOLC_TEXT_MODEL_PRO,
      priority: TEXT_PRIORITY_PRO,
    },
    {
      serviceType: 'text',
      name: 'DeepSeek-V3.2',
      description: '文本 · DeepSeek V3.2（火山接入点）',
      model: process.env.VOLC_TEXT_MODEL_DEEPSEEK,
      priority: TEXT_PRIORITY_DEEPSEEK,
    },
    {
      serviceType: 'text',
      name: 'Doubao-Seed-2.0-mini',
      description: '文本 · 豆包 Seed 2.0 Mini，轻量对话',
      model: process.env.VOLC_TEXT_MODEL_MINI,
      priority: TEXT_PRIORITY_MINI,
    },
    {
      serviceType: 'video',
      name: 'Doubao-Seedance-2.0',
      description: '视频 · 豆包 Seedance 2.0，镜头视频生成',
      model: process.env.VOLC_VIDEO_MODEL_SEEDANCE,
      priority: VIDEO_PRIORITY,
    },
  ]
}

async function main() {
  // 先创建应用上下文：ConfigModule 会把 apps/backend/.env 载入 process.env，
  // 因此所有自定义环境变量必须在这一步之后读取。
  const [{ NestFactory }, { AppModule }, { DatabaseService }, schema] = await Promise.all([
    import('@nestjs/core'),
    import('./app.module.js'),
    import('./db/database.service.js'),
    import('./db/schema.js'),
  ])

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false })

  try {
    const apiKey = String(process.env.VOLC_ARK_API_KEY || '').trim()
    const baseUrl = String(process.env.VOLC_ARK_BASE_URL || 'https://ark.cn-beijing.volces.com').trim()

    if (!apiKey) {
      throw new Error('VOLC_ARK_API_KEY 未配置，请在 apps/backend/.env 中填写后重试')
    }

    const presets = buildPresets().filter((preset) => {
      if (!preset.model || !preset.model.trim()) {
        console.warn(`跳过 ${preset.name}：未配置对应的接入点 ID`)
        return false
      }
      return true
    })

    if (!presets.length) {
      throw new Error('没有可写入的火山方舟模型，请检查 .env 中的接入点 ID')
    }

    const databaseService = app.get(DatabaseService)
    const db = databaseService.db
    const { aiServiceConfigs } = schema
    const setupUserId = getSetupUserId()
    const timestamp = new Date()
    const savedConfigIds: number[] = []

    // 幂等：先清理本脚本管理的当前用户火山方舟配置，
    // 仅限本次写入涉及的 serviceType（text / video），避免遗留重复行。
    const managedServiceTypes = Array.from(new Set(presets.map((preset) => preset.serviceType)))
    for (const serviceType of managedServiceTypes) {
      await db
        .delete(aiServiceConfigs)
        .where(and(
          eq(aiServiceConfigs.userId, setupUserId),
          eq(aiServiceConfigs.provider, 'volcengine'),
          eq(aiServiceConfigs.serviceType, serviceType),
        ))
    }

    for (const preset of presets) {
      const [created] = await db
        .insert(aiServiceConfigs)
        .values({
          userId: setupUserId,
          serviceType: preset.serviceType,
          provider: 'volcengine',
          name: preset.name,
          description: preset.description,
          baseUrl,
          apiKey,
          model: JSON.stringify([String(preset.model).trim()]),
          priority: preset.priority,
          isDefault: false,
          isActive: true,
          settings: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
        .returning({ id: aiServiceConfigs.id })
      if (created?.id) savedConfigIds.push(created.id)
    }

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      configs: savedConfigIds.length,
      names: presets.map((preset) => preset.name),
    }))
  } finally {
    await app.close()
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
