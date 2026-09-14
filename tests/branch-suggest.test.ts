import { describe, expect, it } from 'vitest'
import type { BranchName } from '../src/shared/branch-search'
import {
  branchQueryAt,
  describeBranches,
  suggestBranches,
  withBranchFilter
} from '../src/renderer/src/logic/branch-suggest'

const local = (name: string): BranchName => ({ name, remote: null })
const remote = (name: string): BranchName => ({ name, remote: name.slice(0, name.indexOf('/')) })
const names = (list: BranchName[]): string[] => list.map((b) => b.name)

describe('branchQueryAt', () => {
  it('completes a branch: word, even an empty one', () => {
    expect(branchQueryAt('fix branch:fea')).toEqual({ start: 4, text: 'fea', explicit: true })
    expect(branchQueryAt('Branch:')).toEqual({ start: 0, text: '', explicit: true })
  })

  it('completes a plain last word of two or more characters', () => {
    expect(branchQueryAt('fix log')).toEqual({ start: 4, text: 'log', explicit: false })
    expect(branchQueryAt('fix l')).toBeNull()
    expect(branchQueryAt('fix ')).toBeNull()
    expect(branchQueryAt('')).toBeNull()
  })

  it('stays out of author: searches and other prefixes', () => {
    expect(branchQueryAt('author:Ada Love')).toBeNull()
    expect(branchQueryAt('branch:main author:Ada Love')).toBeNull()
    expect(branchQueryAt('author:Ada')).toBeNull()
  })
})

describe('suggestBranches', () => {
  const branches = [
    local('release'),
    local('feature/login'),
    remote('origin/HEAD'),
    remote('origin/feature'),
    local('feature'),
    remote('origin/main'),
    local('main'),
    local('my-feature')
  ]

  it('ranks exact names, then prefixes, then other matches, with local branches first', () => {
    expect(names(suggestBranches('feature', branches))).toEqual([
      'feature',
      'origin/feature',
      'feature/login',
      'my-feature'
    ])
    expect(names(suggestBranches('MA', branches))).toEqual(['main', 'origin/main'])
  })

  it('lists every branch for an empty text, up to the limit', () => {
    expect(names(suggestBranches('', branches, 3))).toEqual(['release', 'feature/login', 'feature'])
    expect(names(suggestBranches('', branches))).not.toContain('origin/HEAD')
  })
})

describe('withBranchFilter', () => {
  it('replaces the last word with a branch: filter', () => {
    expect(withBranchFilter('fix log', { start: 4, text: 'log', explicit: false }, 'feature/login')).toBe(
      'fix branch:feature/login'
    )
    expect(withBranchFilter('branch:fe', { start: 0, text: 'fe', explicit: true }, 'feature')).toBe('branch:feature')
  })
})

describe('describeBranches', () => {
  it('names a few branches and counts the rest', () => {
    expect(describeBranches(['main', 'origin/main'])).toBe('main, origin/main')
    expect(describeBranches(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more')
  })
})
