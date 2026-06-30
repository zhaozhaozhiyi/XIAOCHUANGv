import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

import * as schema from './schema'

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name)
  private readonly pool: Pool
  readonly db: NodePgDatabase<typeof schema>

  constructor(@Inject(ConfigService) private readonly configService: ConfigService) {
    this.pool = new Pool({
      connectionString: this.configService.getOrThrow<string>('DATABASE_URL'),
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 2_000,
    })

    this.pool.on('error', (error) => {
      this.logger.error(`Unexpected database pool error: ${error.message}`, error.stack)
    })

    this.db = drizzle(this.pool, { schema })
  }

  get poolInstance() {
    return this.pool
  }

  async ping() {
    await this.pool.query('select 1')
  }

  async onModuleDestroy() {
    await this.pool.end()
  }
}
