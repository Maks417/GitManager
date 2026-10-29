import { describe, expect, it } from 'vitest'
import { createHistoryLoadTracker } from '../src/renderer/src/logic/history-load-tracker'

describe('history load tracker', () => {
  it('starts no second load for a list whose load will still apply', () => {
    const loads = createHistoryLoadTracker()
    const a = loads.begin('A')
    expect(loads.needsLoad('A')).toBe(false)
    expect(loads.isLatest(a)).toBe(true)
  })

  it('loads a list again when its running load was superseded by another list (A → B → A)', () => {
    const loads = createHistoryLoadTracker()
    const a1 = loads.begin('A')
    const b = loads.begin('B')
    // Back on A: its first load will be dropped as stale, so A needs one of its own.
    expect(loads.needsLoad('A')).toBe(true)
    const a2 = loads.begin('A')
    expect(loads.isLatest(a1)).toBe(false)
    expect(loads.isLatest(b)).toBe(false)
    expect(loads.isLatest(a2)).toBe(true)
    // The stale load finishing does not forget the newer one.
    loads.finish('A', a1)
    expect(loads.needsLoad('A')).toBe(false)
    loads.finish('A', a2)
    expect(loads.needsLoad('A')).toBe(true)
  })

  it('lets a jump replace older loads only once it applies', () => {
    const loads = createHistoryLoadTracker()
    const load = loads.begin('A')
    const jump = loads.beginReveal()
    // Not found yet: the load started before it still applies.
    expect(loads.isLatest(load)).toBe(true)
    expect(loads.isLatest(jump)).toBe(true)
    loads.supersede()
    expect(loads.isLatest(load)).toBe(false)
  })

  it('drops a tip refresh when a load started after it', () => {
    const loads = createHistoryLoadTracker()
    const tip = loads.current()
    loads.begin('A')
    expect(loads.isLatest(tip)).toBe(false)
  })
})
