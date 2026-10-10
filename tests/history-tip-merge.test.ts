import { describe, expect, it } from 'vitest'
import { decorateCommitsWithColors } from '../src/history-core/layout'
import { mergeTipPage, reuseLoadedCommits, sameCommitList } from '../src/history-core/tip-merge'
import type { Commit } from '../src/shared/ipc'

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

describe('reuseLoadedCommits', () => {
  const commit = (sha: string, refs: Commit['refs'] = []): Commit => ({
    sha,
    shortSha: sha,
    subject: sha,
    body: '',
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    authoredAt: '2026-01-01T00:00:00Z',
    parents: [],
    refs
  })

  it('keeps the loaded objects of unchanged commits, so the list counts as unchanged', () => {
    const loaded = decorateCommitsWithColors([commit('b', [{ name: 'main', type: 'local' }]), commit('a')])
    const page = [commit('b', [{ name: 'main', type: 'local' }]), commit('a')]
    const next = reuseLoadedCommits(page, loaded)
    expect(sameCommitList(next, loaded)).toBe(true)
  })

  it('takes new commits and moved refs, keeping the color of each ref name', () => {
    const loaded = decorateCommitsWithColors([
      commit('b', [{ name: 'main', type: 'local' }]),
      commit('a', [{ name: 'v1', type: 'tag' }])
    ])
    const page = [commit('c', [{ name: 'main', type: 'local' }]), commit('b'), commit('a', [{ name: 'v1', type: 'tag' }])]
    const next = reuseLoadedCommits(page, loaded)
    expect(next.map((c) => c.sha)).toEqual(['c', 'b', 'a'])
    expect(next[2]).toBe(loaded[1])
    expect(next[1]).not.toBe(loaded[0])
    expect(next[1].refs).toEqual([])
    expect(next[0].refs[0].color).toBe(loaded[0].refs[0].color)
    expect(sameCommitList(next, loaded)).toBe(false)
  })
})
