import { describe, expect, it } from 'vitest'
import { BRANCH_FILTER_LIMIT, buildBranchRows, filterBranchNames, folderChain } from '../src/renderer/src/logic/branch-tree'

const names = ['main', 'feature/login', 'feature/ui/dark', 'feature/ui/light', 'bugfix/crash', 'release']
const label = (rows: ReturnType<typeof buildBranchRows>): string[] =>
  rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'folder' ? `${r.label}/ (${r.count})${r.open ? '' : ' +'}` : r.label}`)

describe('buildBranchRows', () => {
  it('lists folders before branches and leaves closed folders shut', () => {
    expect(label(buildBranchRows(names, () => false))).toEqual(['feature/ (3) +', 'bugfix/ (1) +', 'main', 'release'])
  })

  it('nests the branches of open folders by depth', () => {
    expect(label(buildBranchRows(names, () => true))).toEqual([
      'feature/ (3)',
      '  ui/ (2)',
      '    dark',
      '    light',
      '  login',
      'bugfix/ (1)',
      '  crash',
      'main',
      'release'
    ])
  })

  it('keys folders by path and branches by full name', () => {
    const rows = buildBranchRows(names, (key) => key === 'feature')
    expect(rows.map((r) => r.key)).toEqual(['feature', 'feature/ui', 'feature/login', 'bugfix', 'main', 'release'])
    expect(rows.find((r) => r.key === 'feature/login')).toMatchObject({ kind: 'branch', name: 'feature/login', label: 'login' })
  })

  it('makes each remote the top folder of its branches', () => {
    const rows = buildBranchRows(['origin/main', 'origin/feature/x', 'upstream/main'], (key) => !key.includes('/'))
    expect(label(rows)).toEqual(['origin/ (2)', '  feature/ (1) +', '  main', 'upstream/ (1)', '  main'])
  })
})

describe('folderChain', () => {
  it('names every folder above a branch', () => {
    expect(folderChain('a/b/c')).toEqual(['a', 'a/b'])
    expect(folderChain('main')).toEqual([])
  })
})

describe('filterBranchNames', () => {
  it('keeps names holding every word, marking each match', () => {
    const result = filterBranchNames('UI fea', names)
    expect(result.rows.map((r) => r.name)).toEqual(['feature/ui/dark', 'feature/ui/light'])
    expect(result.rows[0]).toMatchObject({ label: 'feature/ui/dark', depth: 0, match: [[0, 3], [8, 10]] })
  })

  it('joins overlapping matches', () => {
    expect(filterBranchNames('feat eat', names).rows[0].match).toEqual([[0, 4]])
  })

  it('reads * and ? as a glob, also against the name without its remote', () => {
    const remote = ['origin/feature/a', 'origin/fix', 'upstream/feature/b']
    const remoteOf = (name: string): string => name.slice(0, name.indexOf('/'))
    expect(filterBranchNames('feature/*', remote, remoteOf).rows.map((r) => r.name)).toEqual([
      'origin/feature/a',
      'upstream/feature/b'
    ])
    expect(filterBranchNames('origin/f?x', remote, remoteOf).rows.map((r) => r.name)).toEqual(['origin/fix'])
  })

  it('renders at most the limit and counts the rest', () => {
    const many = Array.from({ length: BRANCH_FILTER_LIMIT + 20 }, (_, i) => `feature/${i}`)
    const result = filterBranchNames('feature', many)
    expect(result.rows).toHaveLength(BRANCH_FILTER_LIMIT)
    expect(result.total).toBe(BRANCH_FILTER_LIMIT + 20)
  })
})
