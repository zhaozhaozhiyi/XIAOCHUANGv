import { Module } from '@nestjs/common'

import { AssetsModule } from '../assets/assets.module'
import { DramaProductionBackfillService } from './drama-production-backfill.service'

@Module({
  imports: [AssetsModule],
  providers: [DramaProductionBackfillService],
  exports: [DramaProductionBackfillService],
})
export class DramaProductionBackfillModule {}
