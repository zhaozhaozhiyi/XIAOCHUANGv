import { Inject, Injectable } from '@nestjs/common'

import type { AIConfig } from '../ai-configs/ai-configs.resolver'
import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'
import { joinProviderUrl } from '../images/images.providers.url'
import { localHashEmbedding } from './drama-story-graph-embedding.utils'

const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_BATCH_SIZE = 24

@Injectable()
export class DramaStoryGraphEmbeddingService {
  constructor(
    @Inject(AiConfigResolverService) private readonly aiConfigResolver: AiConfigResolverService,
  ) {}

  async embedTexts(userId: number, texts: string[]) {
    const sanitized = texts.map((text) => String(text || '').trim())
    const config = await this.aiConfigResolver.getActiveConfig('text', userId)
    if (config) {
      try {
        const vectors = await this.embedWithProvider(config, sanitized)
        if (vectors.length === sanitized.length) {
          return {
            vectors,
            model: String(config.settings.embedding_model || DEFAULT_EMBEDDING_MODEL),
          }
        }
      } catch {
        // fall back to local hash embeddings
      }
    }

    return {
      vectors: sanitized.map((text) => localHashEmbedding(text)),
      model: 'local-hash-v1',
    }
  }

  async embedQuery(userId: number, query: string) {
    const result = await this.embedTexts(userId, [query])
    return {
      vector: result.vectors[0] || localHashEmbedding(query),
      model: result.model,
    }
  }

  private async embedWithProvider(config: AIConfig, texts: string[]) {
    const model = String(config.settings.embedding_model || DEFAULT_EMBEDDING_MODEL).trim()
    const url = joinProviderUrl(config.baseUrl, '/v1', '/embeddings')
    const vectors: number[][] = []

    for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
      const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE)
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: batch,
        }),
        signal: AbortSignal.timeout(60_000),
      })

      if (!response.ok) {
        const body = await response.text().catch(() => '')
        throw new Error(`embedding_request_failed:${response.status}:${body.slice(0, 180)}`)
      }

      const payload = await response.json() as {
        data?: Array<{ embedding?: number[]; index?: number }>
      }
      const rows = Array.isArray(payload.data) ? payload.data : []
      const sorted = rows
        .slice()
        .sort((left, right) => Number(left.index || 0) - Number(right.index || 0))
      for (const row of sorted) {
        if (!Array.isArray(row.embedding)) {
          throw new Error('embedding_response_invalid')
        }
        vectors.push(row.embedding)
      }
    }

    return vectors
  }
}
