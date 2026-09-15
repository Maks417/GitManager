import { describe, expect, it } from 'vitest'
import type { StatusEntry } from '../src/shared/ipc'
import { fileStatusLabel, statusKindFor } from '../src/renderer/src/logic/file-status'

/** A tracked file's entry from its porcelain `XY` pair, e.g. `.M` or `AM`. */
function tracked(xy: string): StatusEntry {
  return {
    path: 'file.txt',
    indexStatus: xy[0],
    workTreeStatus: xy[1],
    staged: xy[0] !== '.',
    unstaged: xy[1] !== '.',
    untracked: false,
    conflicted: false
  }
}

describe('statusKindFor', () => {
  it('shows the index side under Staged and the work-tree side under Changes', () => {
    expect(statusKindFor(tracked('.M'), 'unstaged')).toBe('modified')
    expect(statusKindFor(tracked('M.'), 'staged')).toBe('modified')
    expect(statusKindFor(tracked('AM'), 'staged')).toBe('added')
    expect(statusKindFor(tracked('AM'), 'unstaged')).toBe('modified')
    expect(statusKindFor(tracked('AD'), 'unstaged')).toBe('deleted')
  })

  it('names deletions, renames, copies and type changes', () => {
    expect(statusKindFor(tracked('D.'), 'staged')).toBe('deleted')
    expect(statusKindFor(tracked('.D'), 'unstaged')).toBe('deleted')
    expect(statusKindFor(tracked('R.'), 'staged')).toBe('renamed')
    expect(statusKindFor(tracked('C.'), 'staged')).toBe('copied')
    expect(statusKindFor(tracked('.T'), 'unstaged')).toBe('typechange')
    // `git add --intent-to-add`
    expect(statusKindFor(tracked('.A'), 'unstaged')).toBe('added')
  })

  it('tells new and conflicted files by their flags', () => {
    const untracked = { ...tracked('??'), staged: false, unstaged: true, untracked: true }
    const conflicted = { ...tracked('UU'), staged: false, unstaged: true, conflicted: true }
    expect(statusKindFor(untracked, 'unstaged')).toBe('untracked')
    expect(statusKindFor(conflicted, 'unstaged')).toBe('unmerged')
  })
})

describe('fileStatusLabel', () => {
  it('names the status, and where a rename or copy came from', () => {
    expect(fileStatusLabel('renamed', 'src/old.ts')).toBe('Renamed from src/old.ts')
    expect(fileStatusLabel('copied', 'src/old.ts')).toBe('Copied from src/old.ts')
    expect(fileStatusLabel('renamed')).toBe('Renamed')
    expect(fileStatusLabel('modified', 'src/old.ts')).toBe('Modified')
    expect(fileStatusLabel('typechange')).toBe('Type changed')
    expect(fileStatusLabel('unmerged')).toBe('Conflicted')
  })
})
