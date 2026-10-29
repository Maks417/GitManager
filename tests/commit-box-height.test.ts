import { describe, expect, it } from 'vitest'
import {
  COMMIT_BOX_MAX,
  COMMIT_BOX_MIN,
  commitBoxHeight,
  commitBoxMax
} from '../src/renderer/src/logic/commit-box-height'
import {
  COMMIT_BODY_MAX,
  COMMIT_BODY_MIN,
  commitBodyMax,
  commitBodyMaxHeight
} from '../src/renderer/src/logic/commit-body-height'

describe('commitBoxHeight', () => {
  const size = { content: 40, resting: 72, room: 800, pinned: false }

  it('keeps the resting height for a short message', () => {
    expect(commitBoxHeight(size)).toBe(72)
  })

  it('grows with the message up to half the room it shares with the file list, then scrolls', () => {
    expect(commitBoxHeight({ ...size, content: 250 })).toBe(250)
    expect(commitBoxHeight({ ...size, content: 2000 })).toBe(400)
  })

  it('never grows below a resting height taller than half the room', () => {
    expect(commitBoxHeight({ ...size, resting: 450, content: 2000 })).toBe(450)
  })

  it('keeps a size dragged smaller than the message', () => {
    expect(commitBoxHeight({ ...size, resting: 100, content: 300, pinned: true })).toBe(100)
  })

  it('leaves the file list its share of a short room', () => {
    expect(commitBoxHeight({ ...size, resting: 500, room: 300 })).toBe(180)
  })

  it('shows the resting height before the room is measured', () => {
    expect(commitBoxHeight({ ...size, content: 500, room: 0 })).toBe(72)
  })
})

describe('commitBoxMax', () => {
  it('leaves the file list 120px within the saved limits', () => {
    expect(commitBoxMax(500)).toBe(380)
    expect(commitBoxMax(5000)).toBe(COMMIT_BOX_MAX)
    expect(commitBoxMax(50)).toBe(COMMIT_BOX_MIN)
    expect(commitBoxMax(0)).toBe(COMMIT_BOX_MAX)
  })
})

describe('commit message in the Inspector', () => {
  it('stops the splitter at the whole message and leaves room below', () => {
    expect(commitBodyMax(800, 300)).toBe(300)
    expect(commitBodyMax(400, 2000)).toBe(300)
    expect(commitBodyMax(0, 5000)).toBe(COMMIT_BODY_MAX)
    expect(commitBodyMax(100, 20)).toBe(COMMIT_BODY_MIN)
  })

  it('shows the saved height within the room', () => {
    expect(commitBodyMaxHeight(60, 800)).toBe(60)
    expect(commitBodyMaxHeight(700, 500)).toBe(400)
    expect(commitBodyMaxHeight(700, 0)).toBe(700)
  })
})
