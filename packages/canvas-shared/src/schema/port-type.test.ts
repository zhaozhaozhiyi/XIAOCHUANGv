import { describe, expect, it } from 'vitest'
import { isCompatible, PORT_COMPATIBILITY, type PortType } from './port-type.js'

describe('PortType compatibility', () => {
  const allTypes: PortType[] = ['text', 'image', 'video', 'audio', 'character', 'scene', 'storyboard']

  it('same type is always compatible', () => {
    for (const t of allTypes) {
      expect(isCompatible(t, t)).toBe(true)
    }
  })

  it('different types are not compatible (v0.2.0 strict matching)', () => {
    for (const a of allTypes) {
      for (const b of allTypes) {
        if (a === b) continue
        expect(isCompatible(a, b)).toBe(false)
      }
    }
  })

  it('every type has an entry in PORT_COMPATIBILITY', () => {
    for (const t of allTypes) {
      expect(PORT_COMPATIBILITY[t]).toBeDefined()
    }
  })
})
