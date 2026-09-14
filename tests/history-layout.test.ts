import { describe, expect, it } from 'vitest'
import { decorateCommitsWithColors, layoutCommitGraph, type LayoutCommit } from '../src/history-core/layout'
import type { Commit, GraphNode } from '../src/shared/ipc'

const byNumber = (a: number, b: number): number => a - b

/** Every line leaving a row's bottom edge must enter the next row's top edge in the same lane. */
function expectContinuity(nodes: GraphNode[]): void {
  for (let i = 0; i + 1 < nodes.length; i++) {
    const below = new Set([...nodes[i].passThrough, ...nodes[i].connections.map((c) => c.toLane)])
    const next = nodes[i + 1]
    const above = new Set([...next.passThrough, ...next.joins, ...(next.hasIncoming ? [next.lane] : [])])
    expect([...below].sort(byNumber), `rows ${i} → ${i + 1}`).toEqual([...above].sort(byNumber))
  }
}

function maxLane(nodes: GraphNode[]): number {
  return Math.max(0, ...nodes.flatMap((n) => n.lanes))
}

/** `main` with N merged one-commit feature branches, in `git log --date-order` order. */
function mergedFeatureBranches(n: number): LayoutCommit[] {
  const commits: LayoutCommit[] = []
  for (let i = n; i >= 1; i--) {
    commits.push({ sha: `M${i}`, parents: [`M${i - 1}`, `F${i}`] })
    commits.push({ sha: `F${i}`, parents: [`M${i - 1}`] })
  }
  commits.push({ sha: 'M0', parents: [] })
  return commits
}

describe('layoutCommitGraph', () => {
  it('assigns lanes for a linear history', () => {
    const nodes = layoutCommitGraph([
      { sha: 'c3', parents: ['c2'] },
      { sha: 'c2', parents: ['c1'] },
      { sha: 'c1', parents: [] }
    ])
    expect(nodes.map((n) => n.lane)).toEqual([0, 0, 0])
    expect(nodes[0].hasIncoming).toBe(false)
    expect(nodes[2].connections).toEqual([])
    expectContinuity(nodes)
  })

  it('closes the side lane where a merged branch meets its fork point', () => {
    const nodes = layoutCommitGraph([
      { sha: 'm', parents: ['a', 'b'] },
      { sha: 'a', parents: ['root'] },
      { sha: 'b', parents: ['root'] },
      { sha: 'root', parents: [] }
    ])
    expect(nodes[0].connections).toEqual([
      { fromLane: 0, toLane: 0, type: 'parent' },
      { fromLane: 0, toLane: 1, type: 'merge' }
    ])
    expect(nodes[3]).toMatchObject({ lane: 0, joins: [1], passThrough: [], connections: [] })
    expect(maxLane(nodes)).toBe(1)
    expectContinuity(nodes)
  })

  it('stays two lanes wide no matter how many feature branches were merged', () => {
    const nodes = layoutCommitGraph(mergedFeatureBranches(150))
    expect(maxLane(nodes)).toBe(1)
    const last = nodes[nodes.length - 1]
    expect(last.passThrough).toEqual([])
    expect(last.connections).toEqual([])
    expectContinuity(nodes)
  })

  it('keeps a long-lived branch in its own lane until it rejoins', () => {
    const nodes = layoutCommitGraph([
      { sha: 'M4', parents: ['M3', 'F2'] },
      { sha: 'F2', parents: ['F1'] },
      { sha: 'M3', parents: ['M2'] },
      { sha: 'F1', parents: ['M1'] },
      { sha: 'M2', parents: ['M1'] },
      { sha: 'M1', parents: [] }
    ])
    expect(nodes.map((n) => n.lane)).toEqual([0, 1, 0, 1, 0, 0])
    expect(nodes[5].joins).toEqual([1])
    expectContinuity(nodes)
  })

  it('handles octopus merges and unrelated histories', () => {
    const nodes = layoutCommitGraph([
      { sha: 'o', parents: ['a', 'b', 'c'] },
      { sha: 'a', parents: ['base'] },
      { sha: 'b', parents: ['base'] },
      { sha: 'c', parents: ['base'] },
      { sha: 'base', parents: [] },
      { sha: 'orphan-tip', parents: ['orphan-root'] },
      { sha: 'orphan-root', parents: [] }
    ])
    expect(maxLane(nodes)).toBe(2)
    expect(nodes[4].joins).toEqual([1, 2])
    expect(nodes[5]).toMatchObject({ lane: 0, hasIncoming: false })
    expectContinuity(nodes)
  })
})

describe('decorateCommitsWithColors', () => {
  it('gives every ref a color, the same color for the same ref name', () => {
    const commit = (sha: string, refs: Commit['refs']): Commit => ({
      sha,
      shortSha: sha.slice(0, 7),
      subject: sha,
      body: '',
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      authoredAt: '2026-01-01T00:00:00Z',
      parents: [],
      refs
    })
    const decorated = decorateCommitsWithColors([
      commit('abc1234ffff', [{ name: 'main', type: 'local' }]),
      commit('def5678ffff', [{ name: 'main', type: 'local' }, { name: 'v1', type: 'tag' }])
    ])
    expect(decorated[0].refs[0].color).toBeTruthy()
    expect(decorated[1].refs[0].color).toBe(decorated[0].refs[0].color)
    expect(decorated[1].refs[1].color).not.toBe(decorated[0].refs[0].color)
  })
})
