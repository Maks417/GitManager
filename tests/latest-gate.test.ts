import { describe, expect, it } from 'vitest'
import { createLatestGate } from '../src/renderer/src/logic/latest-gate'

describe('createLatestGate', () => {
  it('accepts only the most recently started request, whatever order results arrive in', () => {
    const gate = createLatestGate()
    const older = gate.begin()
    const newer = gate.begin()
    // The newer request finishes first and applies; the older one arrives later and is dropped.
    expect(gate.isLatest(newer)).toBe(true)
    expect(gate.isLatest(older)).toBe(false)
  })

  it('keeps gates independent', () => {
    const a = createLatestGate()
    const b = createLatestGate()
    const tokenA = a.begin()
    b.begin()
    b.begin()
    expect(a.isLatest(tokenA)).toBe(true)
  })
})
