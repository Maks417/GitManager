import { describe, expect, it } from 'vitest'
import {
  createRepoRefreshScheduler,
  shouldRefreshHistoryTip
} from '../src/renderer/src/logic/repo-refresh-scheduler'

describe('createRepoRefreshScheduler', () => {
  it('runs the first request immediately', () => {
    const scheduler = createRepoRefreshScheduler()
    expect(scheduler.request('status')).toEqual({ run: true, scope: 'status', generation: 0 })
    expect(scheduler.inFlight).toBe(true)
  })

  it('coalesces overlapping requests and promotes status to meta', () => {
    const scheduler = createRepoRefreshScheduler()
    const first = scheduler.request('status')
    expect(first.run).toBe(true)
    expect(scheduler.request('status')).toEqual({ run: false, scope: 'status', generation: 0 })
    expect(scheduler.request('meta')).toEqual({ run: false, scope: 'meta', generation: 0 })
    expect(scheduler.complete(first.generation)).toEqual({ run: true, scope: 'meta', generation: 0 })
    expect(scheduler.complete(first.generation)).toEqual({ run: false, scope: 'status', generation: 0 })
  })

  it('keeps a trailing status refresh when only status arrived while busy', () => {
    const scheduler = createRepoRefreshScheduler()
    const first = scheduler.request('meta')
    scheduler.request('status')
    expect(scheduler.complete(first.generation)).toEqual({ run: true, scope: 'status', generation: 0 })
  })

  it('resets in-flight and pending work', () => {
    const scheduler = createRepoRefreshScheduler()
    const stale = scheduler.request('status')
    scheduler.request('meta')
    scheduler.reset()
    expect(scheduler.inFlight).toBe(false)
    const current = scheduler.request('status')
    expect(current).toEqual({ run: true, scope: 'status', generation: 1 })
    expect(scheduler.complete(stale.generation)).toEqual({
      run: false,
      scope: 'status',
      generation: 1
    })
    expect(scheduler.inFlight).toBe(true)
    expect(scheduler.complete(current.generation).run).toBe(false)
  })
})

describe('shouldRefreshHistoryTip', () => {
  it('skips when the history fingerprint is unchanged', () => {
    expect(shouldRefreshHistoryTip('abc', 'abc')).toBe(false)
    expect(shouldRefreshHistoryTip(null, null)).toBe(false)
  })

  it('refreshes when the fingerprint changes or appears', () => {
    expect(shouldRefreshHistoryTip(null, 'abc')).toBe(true)
    expect(shouldRefreshHistoryTip('abc', 'def')).toBe(true)
  })
})
