import { describe, expect, it } from 'vitest'
import { mergeTipPage } from '../src/history-core/tip-merge'

const commits = (...shas: string[]): Array<{ sha: string }> => shas.map((sha) => ({ sha }))

describe('mergeTipPage', () => {
  it('uses the page alone when it is the whole history or nothing is loaded', () => {
    expect(mergeTipPage(commits('b', 'a'), commits('c', 'b', 'a'), false)).toEqual(commits('c', 'b', 'a'))
    expect(mergeTipPage([], commits('b', 'a'), true)).toEqual(commits('b', 'a'))
  })

  it('keeps already loaded older commits below new ones', () => {
    const loaded = commits('d', 'c', 'b', 'a')
    expect(mergeTipPage(loaded, commits('e', 'd'), true)).toEqual(commits('e', 'd', 'c', 'b', 'a'))
  })

  it('refuses to splice when a loaded commit disappeared (amend, rebase, reset)', () => {
    const loaded = commits('d', 'c', 'b', 'a')
    expect(mergeTipPage(loaded, commits('d2', 'c'), true)).toBeNull()
  })

  it('refuses to splice when the page no longer reaches the loaded list', () => {
    expect(mergeTipPage(commits('d', 'c'), commits('y', 'x'), true)).toBeNull()
  })

  it('never duplicates commits', () => {
    const loaded = commits('c', 'b', 'a')
    expect(mergeTipPage(loaded, commits('c', 'a'), true)).toBeNull()
    expect(mergeTipPage(loaded, commits('d', 'c'), true)).toEqual(commits('d', 'c', 'b', 'a'))
  })
})
