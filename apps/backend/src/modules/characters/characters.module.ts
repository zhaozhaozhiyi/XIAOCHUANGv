import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { ImagesModule } from '../images/images.module'
import { CharactersController } from './characters.controller'

@Module({
  imports: [AuthModule, ImagesModule],
  controllers: [CharactersController],
})
export class CharactersModule {}
