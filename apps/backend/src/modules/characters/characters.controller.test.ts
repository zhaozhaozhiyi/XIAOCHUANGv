import 'reflect-metadata'

import { Test } from '@nestjs/testing'
import { describe, expect, it, vi } from 'vitest'

import { DatabaseService } from '../../db/database.service'
import { AuthService } from '../auth/auth.service'
import { ImagesService } from '../images/images.service'
import { CharactersController } from './characters.controller'

describe('CharactersController', () => {
  it('injects its services and updates a character voice', async () => {
    const selectWhere = vi.fn(async () => [{ id: 1, name: '萧炎' }])
    const updateWhere = vi.fn(async () => undefined)
    const updateSet = vi.fn(() => ({ where: updateWhere }))
    const databaseService = {
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({ where: selectWhere })),
        })),
        update: vi.fn(() => ({ set: updateSet })),
      },
    }
    const imagesService = {}
    const moduleRef = await Test.createTestingModule({
      controllers: [CharactersController],
      providers: [
        { provide: DatabaseService, useValue: databaseService },
        { provide: ImagesService, useValue: imagesService },
        { provide: AuthService, useValue: {} },
      ],
    }).compile()
    const controller = moduleRef.get(CharactersController)

    await expect(controller.updateCharacter(
      '1',
      { voice_style: 'Chinese (Mandarin)_Reliable_Executive' },
      { id: 1 } as never,
    )).resolves.toEqual({ success: true })

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      voiceStyle: 'Chinese (Mandarin)_Reliable_Executive',
      voiceSampleUrl: null,
      updatedAt: expect.any(Date),
    }))
    expect(updateWhere).toHaveBeenCalledOnce()

    await moduleRef.close()
  })
})
