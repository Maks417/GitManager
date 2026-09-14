import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DIFF_SETTLE_TIMEOUT_MS,
  disposeWhenDiffSettled,
  nextContentVersion,
  type SettlingDiffEditor
} from '../src/renderer/src/logic/monaco-lifecycle'

/** A diff editor whose diff is either ready or arrives when `arrive()` is called. */
function fakeEditor(calls: string[], diffReady: boolean): SettlingDiffEditor & { arrive(): void; listeners: number } {
  let ready = diffReady
  const listeners = new Set<() => void>()
  return {
    getLineChanges: () => (ready ? [] : null),
    onDidUpdateDiff: (listener) => {
      listeners.add(listener)
      return { dispose: () => void listeners.delete(listener) }
    },
    dispose: () => void calls.push('dispose editor'),
    arrive() {
      ready = true
      for (const listener of [...listeners]) listener()
    },
    get listeners() {
      return listeners.size
    }
  }
}

const models = (calls: string[]) => [
  { dispose: () => void calls.push('dispose original') },
  { dispose: () => void calls.push('dispose modified') }
]

describe('disposeWhenDiffSettled', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('disposes the editor, then its models, at once when the diff has arrived', () => {
    const calls: string[] = []
    disposeWhenDiffSettled(fakeEditor(calls, true), models(calls))
    expect(calls).toEqual(['dispose editor', 'dispose original', 'dispose modified'])
  })

  it('keeps everything alive while the diff is still queued in the worker', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const editor = fakeEditor(calls, false)
    disposeWhenDiffSettled(editor, models(calls))
    vi.advanceTimersByTime(DIFF_SETTLE_TIMEOUT_MS - 1)
    expect(calls).toEqual([])

    editor.arrive()
    expect(calls).toEqual(['dispose editor', 'dispose original', 'dispose modified'])
    expect(editor.listeners).toBe(0)
    vi.runAllTimers()
    expect(calls).toHaveLength(3)
  })

  it('gives up waiting after the timeout and never disposes twice', () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const editor = fakeEditor(calls, false)
    disposeWhenDiffSettled(editor, models(calls))
    vi.advanceTimersByTime(DIFF_SETTLE_TIMEOUT_MS)
    expect(calls).toEqual(['dispose editor', 'dispose original', 'dispose modified'])

    editor.arrive()
    expect(calls).toHaveLength(3)
  })
})

describe('nextContentVersion', () => {
  it('keeps the version while the text is unchanged and bumps it when either side changes', () => {
    const first = nextContentVersion(null, 'a', 'b')
    expect(first.version).toBe(0)
    expect(nextContentVersion(first, 'a', 'b')).toBe(first)
    const second = nextContentVersion(first, 'a', 'c')
    expect(second.version).toBe(1)
    expect(nextContentVersion(second, 'x', 'c').version).toBe(2)
  })
})
