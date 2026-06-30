import { DatabaseService } from '../../db/database.service'
import type { AIConfig } from '../ai-configs/ai-configs.resolver'
import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'

export function getTextProviderBaseUrl(config: AIConfig) {
  const provider = config.provider.toLowerCase()
  const base = config.baseUrl.replace(/\/+$/, '')

  if (provider === 'openai' || provider === 'openrouter' || provider === 'chatfire'
    || provider === 'moonshot' || provider === 'deepseek' || provider === 'minimax') {
    return base.endsWith('/v1') ? base : `${base}/v1`
  }

  if (provider === 'volcengine') {
    return `${base}/api/v3`
  }

  if (provider === 'ali') {
    if (base.includes('compatible-mode')) {
      return base.endsWith('/v1') ? base : `${base}/v1`
    }
    return `${base}/api/v1`
  }

  return config.baseUrl
}

export async function getTextConfig(databaseService: DatabaseService, userId?: number | null): Promise<AIConfig> {
  const resolver = new AiConfigResolverService(databaseService)
  const config = await resolver.getActiveConfig('text', userId)
  if (!config) {
    throw new Error('No active text AI config')
  }
  return config
}
