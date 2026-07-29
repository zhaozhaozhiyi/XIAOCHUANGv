import { Test } from '@nestjs/testing'
import { describe, expect, it } from 'vitest'

import { DatabaseService } from '../../../db/database.service'
import { ExecutionPlanEngine } from './execution-plan.engine'
import { ExecutionPlanService } from './execution-plan.service'

describe('ExecutionPlanService dependency injection', () => {
  it('injects the plan engine when compiled by the runtime module loader', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ExecutionPlanService,
        ExecutionPlanEngine,
        { provide: DatabaseService, useValue: {} },
      ],
    }).compile()

    const service = moduleRef.get(ExecutionPlanService)
    expect((service as unknown as { engine?: ExecutionPlanEngine }).engine).toBeInstanceOf(ExecutionPlanEngine)
    expect(service.getExecutorModule('text-to-image')).toEqual({
      module: 'images',
      method: 'generate',
    })
    await moduleRef.close()
  })
})
