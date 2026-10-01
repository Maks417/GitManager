import { describe, expect, it } from 'vitest'
import type { DiffHunk } from '@shared/ipc'
import {
  firstChangeLine,
  hunkAtLine,
  hunkLineRange,
  selectedChanges,
  selectionLines
} from '../src/renderer/src/logic/hunk-selection'

/** Old: a b c d e. New: a B c X d (b → B, X added, e removed at the end). */
const HUNK: DiffHunk = {
  oldStart: 1,
  oldLines: 5,
  newStart: 1,
  newLines: 5,
  lines: [
    { kind: 'context', oldLine: 1, newLine: 1 },
    { kind: 'del', oldLine: 2, newLine: null },
    { kind: 'add', oldLine: null, newLine: 2 },
    { kind: 'context', oldLine: 3, newLine: 3 },
    { kind: 'add', oldLine: null, newLine: 4 },
    { kind: 'context', oldLine: 4, newLine: 5 },
    { kind: 'del', oldLine: 5, newLine: null }
  ]
}

const LATER: DiffHunk = {
  oldStart: 20,
  oldLines: 3,
  newStart: 20,
  newLines: 2,
  lines: [
    { kind: 'context', oldLine: 20, newLine: 20 },
    { kind: 'del', oldLine: 21, newLine: null },
    { kind: 'context', oldLine: 22, newLine: 21 }
  ]
}

const range = (start: number, end: number, endColumn = 5) => ({
  startLineNumber: start,
  endLineNumber: end,
  endColumn,
  isEmpty: () => false
})

describe('hunk positions', () => {
  it('finds the hunk under a line and where its first change shows', () => {
    expect(hunkLineRange(HUNK)).toEqual({ start: 1, end: 5 })
    expect(hunkAtLine([HUNK, LATER], 3)).toBe(0)
    expect(hunkAtLine([HUNK, LATER], 21)).toBe(1)
    expect(hunkAtLine([HUNK, LATER], 10)).toBe(-1)
    expect(firstChangeLine(HUNK)).toBe(2)
    // A removal shows before the line that follows it.
    expect(firstChangeLine(LATER)).toBe(21)
  })

  it('treats a hunk that only removes lines as covering the line after them', () => {
    const removal: DiffHunk = { oldStart: 4, oldLines: 1, newStart: 3, newLines: 0, lines: [{ kind: 'del', oldLine: 4, newLine: null }] }
    expect(hunkLineRange(removal)).toEqual({ start: 4, end: 4 })
  })
})

describe('selectedChanges', () => {
  it('picks an added line and the line it replaced', () => {
    expect(selectedChanges([HUNK], new Set([2]), new Set())).toEqual({ oldLines: [2], newLines: [2] })
  })

  it('picks only added lines when nothing was removed before them', () => {
    expect(selectedChanges([HUNK], new Set([4]), new Set())).toEqual({ oldLines: [], newLines: [4] })
  })

  it('picks lines removed at the end of the file through the last line', () => {
    expect(selectedChanges([HUNK], new Set([5]), new Set())).toEqual({ oldLines: [5], newLines: [] })
  })

  it('picks removed lines from the old side directly, across hunks', () => {
    expect(selectedChanges([HUNK, LATER], new Set(), new Set([2, 21]))).toEqual({ oldLines: [2, 21], newLines: [] })
  })

  it('picks nothing for context lines alone', () => {
    expect(selectedChanges([HUNK], new Set([1, 3]), new Set())).toEqual({ oldLines: [], newLines: [] })
  })
})

describe('selectionLines', () => {
  it('ignores empty selections and a last line selected only up to its start', () => {
    expect([...selectionLines([range(2, 4, 1)])]).toEqual([2, 3])
    expect([...selectionLines([range(2, 2, 1)])]).toEqual([2])
    expect([...selectionLines([{ ...range(7, 7), isEmpty: () => true }])]).toEqual([])
  })
})
