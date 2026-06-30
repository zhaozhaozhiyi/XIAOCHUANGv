import type { DatabaseService } from '../../db/database.service'
import { AiConfigResolverService } from '../ai-configs/ai-configs.resolver'
import type { AIConfig, ServiceType } from '../ai-configs/ai-configs.resolver'

function createResolver(databaseService: DatabaseService) {
  return new AiConfigResolverService(databaseService)
}

export async function getActiveConfig(
  databaseService: DatabaseService,
  serviceType: ServiceType,
  userId?: number | null,
): Promise<AIConfig | null> {
  return createResolver(databaseService).getActiveConfig(serviceType, userId)
}

export async function getConfigById(
  databaseService: DatabaseService,
  id: number,
  userId?: number | null,
): Promise<AIConfig | null> {
  return createResolver(databaseService).getConfigById(id, userId)
}

export type { AIConfig, ServiceType }
