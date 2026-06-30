import type { DatabaseService } from '../../db/database.service'
import type { AIConfig } from '../audio/audio.config'
import { getActiveConfig, getConfigById } from '../audio/audio.config'

export async function getActiveImageConfig(databaseService: DatabaseService): Promise<AIConfig | null> {
  return getActiveConfig(databaseService, 'image')
}

export async function getImageConfigById(databaseService: DatabaseService, id: number): Promise<AIConfig | null> {
  return getConfigById(databaseService, id)
}
