import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'

import { DatabaseService } from '../../db/database.service'
import { ImagesService } from '../images/images.service'
import { StorageService } from '../storage/storage.service'
import { GridService } from './grid.service'

describe('GridService', () => {
  it('receives its runtime dependencies through explicit injection tokens', async () => {
    const databaseService = {}
    const imagesService = {}
    const storageService = {}
    const moduleRef = await Test.createTestingModule({
      providers: [
        GridService,
        { provide: DatabaseService, useValue: databaseService },
        { provide: ImagesService, useValue: imagesService },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile()
    const service = moduleRef.get(GridService) as unknown as {
      databaseService: unknown
      imagesService: unknown
      storageService: unknown
    }

    expect(service.databaseService).toBe(databaseService)
    expect(service.imagesService).toBe(imagesService)
    expect(service.storageService).toBe(storageService)

    await moduleRef.close()
  })
})
