import { describe, expect, it } from 'vitest'
import { virtualWindow } from '../src/renderer/src/logic/virtual-window'

describe('virtualWindow', () => {
  it('returns an empty window when there are no rows', () => {
    expect(virtualWindow(120, 400, 0, 34, 12)).toEqual({
      startIndex: 0,
      endIndex: 0,
      offsetY: 0
    })
  })

  it('starts at zero with overscan when the list is at the top', () => {
    expect(virtualWindow(0, 340, 100, 34, 12)).toEqual({
      startIndex: 0,
      endIndex: 34,
      offsetY: 0
    })
  })

  it('shifts the window by scroll position and keeps overscan on both sides', () => {
    // Row 20 is at the top of the viewport (20 * 34 = 680); overscan 12 starts at 8.
    expect(virtualWindow(680, 340, 100, 34, 12)).toEqual({
      startIndex: 8,
      endIndex: 42,
      offsetY: 8 * 34
    })
  })

  it('clamps the end of the window to the last row', () => {
    // Near the bottom of a 50-row list: floor(1700 / 34) = 50, minus overscan 12 → 38.
    expect(virtualWindow(1700, 340, 50, 34, 12)).toEqual({
      startIndex: 38,
      endIndex: 50,
      offsetY: 38 * 34
    })
  })

  it('treats a negative scroll as the top of the list', () => {
    expect(virtualWindow(-40, 200, 10, 34, 2).startIndex).toBe(0)
  })
})
