import { describe, expect, it, vi } from 'vitest'

import { TaskDomainRegistry } from './task-domain.registry'

function createUpdateDb(setPayloads: Array<Record<string, unknown>>) {
  return {
    update: vi.fn(() => ({
      set: vi.fn((payload: Record<string, unknown>) => {
        setPayloads.push(payload)
        return {
          where: vi.fn(() => Promise.resolve()),
        }
      }),
    })),
  }
}

function createHandler(domainTable: string) {
  return {
    domainTable,
    retry: vi.fn(),
    cancel: vi.fn(),
    refreshPresentation: vi.fn(),
    markCanceled: vi.fn(),
    markFailed: vi.fn(),
    execute: vi.fn(),
  }
}

describe('TaskDomainRegistry unsupported domains', () => {
  it('marks unknown domain execution as a terminal failed task', async () => {
    const setPayloads: Array<Record<string, unknown>> = []
    const registry = new TaskDomainRegistry(
      { db: createUpdateDb(setPayloads) } as any,
      createHandler('image_generations') as any,
      createHandler('video_generations') as any,
      createHandler('storyboard_tts') as any,
      createHandler('storyboard_compose') as any,
      createHandler('video_merges') as any,
      createHandler('drama_sources') as any,
      createHandler('drama_adaptation_briefs') as any,
      createHandler('drama_episode_blueprints') as any,
      createHandler('drama_pilot_scripts') as any,
    )

    const result = await registry.execute({
      id: 42,
      domainTable: 'legacy_tasks',
      domainId: 1001,
    } as any)

    expect(result).toBe('unknown_domain_failed')
    expect(setPayloads).toHaveLength(1)
    expect(setPayloads[0]).toMatchObject({
      status: 'failed',
      errorKind: 'unsupported_domain',
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })
    expect(JSON.parse(String(setPayloads[0].errorDetailsJson))).toMatchObject({
      error_kind: 'unsupported_domain',
      domain_table: 'legacy_tasks',
      domain_id: 1001,
    })
  })

  it('marks unknown domain cancellation as a terminal canceled task', async () => {
    const setPayloads: Array<Record<string, unknown>> = []
    const registry = new TaskDomainRegistry(
      { db: createUpdateDb(setPayloads) } as any,
      createHandler('image_generations') as any,
      createHandler('video_generations') as any,
      createHandler('storyboard_tts') as any,
      createHandler('storyboard_compose') as any,
      createHandler('video_merges') as any,
      createHandler('drama_sources') as any,
      createHandler('drama_adaptation_briefs') as any,
      createHandler('drama_episode_blueprints') as any,
      createHandler('drama_pilot_scripts') as any,
    )

    await expect(registry.markCanceled({
      id: 43,
      domainTable: 'legacy_tasks',
      domainId: 1002,
    } as any)).resolves.toBe(true)

    expect(setPayloads[0]).toMatchObject({
      status: 'canceled',
      errorKind: 'canceled',
      lockedBy: null,
      lockedAt: null,
      lockExpiresAt: null,
    })
  })
})
