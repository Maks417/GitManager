import { describe, expect, it } from 'vitest'
import {
  appendLayoutCommitGraph,
  decorateCommitsWithColors,
  layoutCommitGraph,
  layoutCommitGraphWithCheckpoint,
  type LayoutCommit
} from '../src/history-core/layout'
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

describe('appendLayoutCommitGraph', () => {
  it('matches a full layout when pages are appended', () => {
    const all = mergedFeatureBranches(40)
    const full = layoutCommitGraphWithCheckpoint(all)
    const first = layoutCommitGraphWithCheckpoint(all.slice(0, 15))
    const second = appendLayoutCommitGraph(first.checkpoint, all.slice(15, 30))
    const third = appendLayoutCommitGraph(second.checkpoint, all.slice(30))
    const merged = [...first.nodes, ...second.nodes, ...third.nodes]
    expect(merged).toEqual(full.nodes)
    expect(third.checkpoint).toEqual(full.checkpoint)
    expect(Math.max(first.maxLane, second.maxLane, third.maxLane)).toBe(full.maxLane)
    expectContinuity(merged)
  })

  it('keeps the prefix nodes identical after an append', () => {
    const all = [
      { sha: 'M4', parents: ['M3', 'F2'] },
      { sha: 'F2', parents: ['F1'] },
      { sha: 'M3', parents: ['M2'] },
      { sha: 'F1', parents: ['M1'] },
      { sha: 'M2', parents: ['M1'] },
      { sha: 'M1', parents: [] }
    ]
    const prefix = layoutCommitGraphWithCheckpoint(all.slice(0, 3))
    const appended = appendLayoutCommitGraph(prefix.checkpoint, all.slice(3))
    const full = layoutCommitGraph(all)
    expect(prefix.nodes).toEqual(full.slice(0, 3))
    expect([...prefix.nodes, ...appended.nodes]).toEqual(full)
    expectContinuity([...prefix.nodes, ...appended.nodes])
  })

  it('starts from an empty checkpoint like a full layout', () => {
    const commits = mergedFeatureBranches(8)
    expect(appendLayoutCommitGraph([], commits)).toEqual(layoutCommitGraphWithCheckpoint(commits))
  })
})

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

describe('unlinked layout (searches that skip commits)', () => {
  /** Search results: every commit's parent is a commit the search skipped. */
  const results = (n: number): LayoutCommit[] =>
    Array.from({ length: n }, (_, i) => ({ sha: `r${i}`, parents: [`skipped${i}`] }))

  it('keeps a thousand results in one lane, where a linked layout opens a lane per result', () => {
    expect(layoutCommitGraphWithCheckpoint(results(50)).maxLane).toBeGreaterThan(40)
    const flat = layoutCommitGraphWithCheckpoint(results(1000), { unlinked: true })
    expect(flat.maxLane).toBe(0)
    expect(flat.checkpoint).toEqual([])
    expect(flat.nodes.every((n) => n.lane === 0 && n.connections.length === 0 && n.passThrough.length === 0)).toBe(true)
  })

  it('stays one lane wide when pages are appended', () => {
    const first = layoutCommitGraphWithCheckpoint(results(200), { unlinked: true })
    const more = appendLayoutCommitGraph(first.checkpoint, results(400).slice(200), { unlinked: true })
    expect(more.maxLane).toBe(0)
  })
})

describe('decorateCommitsWithColors', () => {
  it('continues the colors of commits already shown', () => {
    const shown = decorateCommitsWithColors([
      commit('a', [{ name: 'main', type: 'local' }]),
      commit('b', [{ name: 'dev', type: 'local' }])
    ])
    const all = decorateCommitsWithColors([...shown, commit('c', [{ name: 'dev', type: 'local' }, { name: 'v2', type: 'tag' }])])
    const appended = decorateCommitsWithColors([commit('c', [{ name: 'dev', type: 'local' }, { name: 'v2', type: 'tag' }])], shown)
    expect(appended[0].refs).toEqual(all[2].refs)
  })

  it('gives every ref a color, the same color for the same ref name', () => {
    const decorated = decorateCommitsWithColors([
      commit('abc1234ffff', [{ name: 'main', type: 'local' }]),
      commit('def5678ffff', [{ name: 'main', type: 'local' }, { name: 'v1', type: 'tag' }])
    ])
    expect(decorated[0].refs[0].color).toBeTruthy()
    expect(decorated[1].refs[0].color).toBe(decorated[0].refs[0].color)
    expect(decorated[1].refs[1].color).not.toBe(decorated[0].refs[0].color)
  })
})
