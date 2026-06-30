import { Controller, Get, Inject } from '@nestjs/common'
import { ApiTags } from '@nestjs/swagger'

import { DatabaseService } from '../../db/database.service'

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@Inject(DatabaseService) private readonly databaseService: DatabaseService) {}

  @Get()
  async getHealth() {
    await this.databaseService.ping()

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        database: 'ok',
      },
    }
  }
}
