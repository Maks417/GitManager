import { describe, expect, it } from 'vitest'
import { nextFocusIndex } from '../src/renderer/src/logic/focus-trap'

describe('nextFocusIndex', () => {
  it('wraps Tab from the last element to the first, and Shift+Tab from the first to the last', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0)
    expect(nextFocusIndex(3, 0, true)).toBe(2)
  })

  it('leaves moves between inner elements to the browser', () => {
    expect(nextFocusIndex(3, 0, false)).toBeNull()
    expect(nextFocusIndex(3, 1, true)).toBeNull()
  })

  it('brings focus that is not on a listed element to the first or last one', () => {
    expect(nextFocusIndex(3, -1, false)).toBe(0)
    expect(nextFocusIndex(3, -1, true)).toBe(2)
  })

  it('keeps focus on the dialog itself when nothing inside can take it', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1)
    expect(nextFocusIndex(0, -1, true)).toBe(-1)
  })
})
