import { describe, expect, it } from 'vitest'
import { nextListIndex } from '../src/renderer/src/logic/list-nav'
import { nextPaneIndex } from '../src/renderer/src/logic/pane-cycle'
import { nextSizeForKey } from '../src/renderer/src/logic/resize-keys'

describe('nextListIndex', () => {
  it('moves one item with the arrows and stops at the ends', () => {
    expect(nextListIndex('ArrowDown', 2, 5)).toBe(3)
    expect(nextListIndex('ArrowUp', 2, 5)).toBe(1)
    expect(nextListIndex('ArrowDown', 4, 5)).toBe(4)
    expect(nextListIndex('ArrowUp', 0, 5)).toBe(0)
  })

  it('starts at the first or last item when nothing is selected', () => {
    expect(nextListIndex('ArrowDown', -1, 5)).toBe(0)
    expect(nextListIndex('ArrowUp', -1, 5)).toBe(4)
    expect(nextListIndex('PageDown', -1, 5)).toBe(0)
    expect(nextListIndex('PageUp', -1, 5)).toBe(4)
  })

  it('moves a page, and to either end', () => {
    expect(nextListIndex('PageDown', 3, 100, { pageSize: 20 })).toBe(23)
    expect(nextListIndex('PageDown', 90, 100, { pageSize: 20 })).toBe(99)
    expect(nextListIndex('PageUp', 10, 100, { pageSize: 20 })).toBe(0)
    expect(nextListIndex('Home', 42, 100)).toBe(0)
    expect(nextListIndex('End', 42, 100)).toBe(99)
  })

  it('goes round with wrap, as in a menu', () => {
    expect(nextListIndex('ArrowDown', 2, 3, { wrap: true })).toBe(0)
    expect(nextListIndex('ArrowUp', 0, 3, { wrap: true })).toBe(2)
    expect(nextListIndex('ArrowDown', 0, 3, { wrap: true })).toBe(1)
  })

  it('ignores other keys and empty lists', () => {
    expect(nextListIndex('Enter', 1, 5)).toBeNull()
    expect(nextListIndex('ArrowLeft', 1, 5)).toBeNull()
    expect(nextListIndex('ArrowDown', -1, 0)).toBeNull()
  })
})

describe('nextSizeForKey', () => {
  const width = { size: 200, min: 140, max: 480, axis: 'x' as const }

  it('moves a width 10 px with ←/→ and 50 px with Shift', () => {
    expect(nextSizeForKey('ArrowRight', width)).toBe(210)
    expect(nextSizeForKey('ArrowLeft', width)).toBe(190)
    expect(nextSizeForKey('ArrowRight', { ...width, shift: true })).toBe(250)
    expect(nextSizeForKey('ArrowDown', width)).toBeNull()
  })

  it('follows the handle for a pane that grows the other way', () => {
    expect(nextSizeForKey('ArrowLeft', { ...width, reverse: true })).toBe(210)
    const height = { size: 300, min: 180, max: 600, axis: 'y' as const, reverse: true }
    expect(nextSizeForKey('ArrowUp', height)).toBe(310)
    expect(nextSizeForKey('ArrowDown', height)).toBe(290)
    expect(nextSizeForKey('ArrowLeft', height)).toBeNull()
  })

  it('stays within the limits and jumps to them with Home and End', () => {
    expect(nextSizeForKey('ArrowLeft', { ...width, size: 145, shift: true })).toBe(140)
    expect(nextSizeForKey('ArrowRight', { ...width, size: 475 })).toBe(480)
    expect(nextSizeForKey('Home', width)).toBe(140)
    expect(nextSizeForKey('End', width)).toBe(480)
    expect(nextSizeForKey('Enter', width)).toBeNull()
  })
})

describe('nextPaneIndex', () => {
  it('goes round the panes in both directions', () => {
    expect(nextPaneIndex(0, 4, false)).toBe(1)
    expect(nextPaneIndex(3, 4, false)).toBe(0)
    expect(nextPaneIndex(0, 4, true)).toBe(3)
  })

  it('starts at the first or last pane when focus is elsewhere', () => {
    expect(nextPaneIndex(-1, 3, false)).toBe(0)
    expect(nextPaneIndex(-1, 3, true)).toBe(2)
    expect(nextPaneIndex(0, 0, false)).toBeNull()
  })
})
