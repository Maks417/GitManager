import { describe, expect, it } from 'vitest'
import { decorateCommitsWithColors, filterCommits, findCommitIndex, layoutCommitGraph } from '../src/history-core/layout'
import type { Commit } from '../src/shared/ipc'

describe('layoutCommitGraph', () => {
  it('assigns lanes for a linear history', () => {
    const nodes = layoutCommitGraph([
      { sha: 'c3', parents: ['c2'] },
      { sha: 'c2', parents: ['c1'] },
      { sha: 'c1', parents: [] }
    ])
    expect(nodes).toHaveLength(3)
    expect(nodes[0].lane).toBe(0)
    expect(nodes[1].lane).toBe(0)
    expect(nodes[2].lane).toBe(0)
  })

  it('creates a merge connection for second parents', () => {
    const nodes = layoutCommitGraph([
      { sha: 'm', parents: ['a', 'b'] },
      { sha: 'a', parents: ['root'] },
      { sha: 'b', parents: ['root'] },
      { sha: 'root', parents: [] }
    ])
    expect(nodes[0].connections.some((c) => c.type === 'merge')).toBe(true)
    expect(nodes[0].lane).toBe(0)
  })
})

describe('filterCommits', () => {
  const sample: Commit[] = [
    {
      sha: 'abc1234ffff',
      shortSha: 'abc1234',
      subject: 'Fix login timeout',
      body: '',
      authorName: 'Ada',
      authorEmail: 'ada@example.com',
      authoredAt: '2026-01-01T00:00:00Z',
      parents: ['000'],
      refs: [{ name: 'main', type: 'local' }]
    },
    {
      sha: 'def5678ffff',
      shortSha: 'def5678',
      subject: 'Merge branch feature',
      body: '',
      authorName: 'Bob',
      authorEmail: 'bob@example.com',
      authoredAt: '2026-01-02T00:00:00Z',
      parents: ['111', '222'],
      refs: []
    }
  ]

  it('filters by search text across subject and sha', () => {
    expect(filterCommits(sample, { search: 'login' })).toHaveLength(1)
    expect(filterCommits(sample, { search: 'def5678' })).toHaveLength(1)
  })

  it('filters merges only', () => {
    expect(filterCommits(sample, { mergesOnly: true })).toHaveLength(1)
  })

  it('finds commit by prefix', () => {
    expect(findCommitIndex(sample, 'abc')).toBe(0)
  })

  it('decorates refs with colors', () => {
    const decorated = decorateCommitsWithColors(sample)
    expect(decorated[0].refs[0].color).toBeTruthy()
  })
})
