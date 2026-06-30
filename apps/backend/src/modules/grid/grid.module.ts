import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ImagesModule } from '../images/images.module'
import { GridController } from './grid.controller'
import { GridService } from './grid.service'

@Module({
  imports: [AuthModule, ImagesModule],
  controllers: [GridController],
  providers: [GridService],
  exports: [GridService],
})
export class GridModule {}
