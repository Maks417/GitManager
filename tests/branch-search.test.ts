import { describe, expect, it } from 'vitest'
import {
  matchBranchPatterns,
  matchBranches,
  splitBranchTokens,
  type BranchName
} from '../src/shared/branch-search'

const local = (name: string): BranchName => ({ name, remote: null })
const remote = (name: string): BranchName => ({ name, remote: name.slice(0, name.indexOf('/')) })

const branches = [
  local('main'),
  local('maintenance'),
  local('feature/login'),
  local('feature/signup'),
  local('Hotfix-42'),
  remote('origin/HEAD'),
  remote('origin/main'),
  remote('origin/feature/login'),
  remote('upstream/main')
]

const names = (list: BranchName[]): string[] => list.map((b) => b.name)

describe('splitBranchTokens', () => {
  it('takes branch: tokens from anywhere in the search and keeps the rest', () => {
    expect(splitBranchTokens('branch:main fix login')).toEqual({ branchPatterns: ['main'], rest: 'fix login' })
    expect(splitBranchTokens('fix branch:main login')).toEqual({ branchPatterns: ['main'], rest: 'fix login' })
    expect(splitBranchTokens('fix login Branch:feature/*')).toEqual({
      branchPatterns: ['feature/*'],
      rest: 'fix login'
    })
    expect(splitBranchTokens('branch:a branch:b')).toEqual({ branchPatterns: ['a', 'b'], rest: '' })
  })

  it('leaves author: searches and text without a token alone', () => {
    expect(splitBranchTokens('author:Ada Lovelace branch:main')).toEqual({
      branchPatterns: ['main'],
      rest: 'author:Ada Lovelace'
    })
    expect(splitBranchTokens('rebranch:main')).toEqual({ branchPatterns: [], rest: 'rebranch:main' })
    expect(splitBranchTokens('branch: main')).toEqual({ branchPatterns: [], rest: 'branch: main' })
    expect(splitBranchTokens(undefined)).toEqual({ branchPatterns: [], rest: '' })
  })
})

describe('matchBranches', () => {
  it('prefers exact names, where main also names the remote-tracking main branches', () => {
    expect(names(matchBranches('main', branches))).toEqual(['main', 'origin/main', 'upstream/main'])
    expect(names(matchBranches('MAIN', branches))).toEqual(['main', 'origin/main', 'upstream/main'])
    expect(names(matchBranches('origin/main', branches))).toEqual(['origin/main'])
  })

  it('falls back to names that contain the pattern', () => {
    expect(names(matchBranches('login', branches))).toEqual(['feature/login', 'origin/feature/login'])
    expect(names(matchBranches('hotfix', branches))).toEqual(['Hotfix-42'])
    expect(matchBranches('nothing', branches)).toEqual([])
    expect(matchBranches('  ', branches)).toEqual([])
  })

  it('reads * and ? as a glob and everything else literally', () => {
    expect(names(matchBranches('feature/*', branches))).toEqual([
      'feature/login',
      'feature/signup',
      'origin/feature/login'
    ])
    expect(names(matchBranches('origin/*', branches))).toEqual(['origin/main', 'origin/feature/login'])
    expect(names(matchBranches('m?in', branches))).toEqual(['main', 'origin/main', 'upstream/main'])
    expect(matchBranches('main?', branches)).toEqual([])
    expect(matchBranches('feature.login*', branches)).toEqual([])
  })

  it('never selects a remote HEAD pointer', () => {
    expect(matchBranches('HEAD', branches)).toEqual([])
    expect(names(matchBranches('*', branches))).not.toContain('origin/HEAD')
  })
})

describe('matchBranchPatterns', () => {
  it('unites the branches of several patterns in their original order', () => {
    expect(names(matchBranchPatterns(['upstream/main', 'feature/signup', 'main'], branches))).toEqual([
      'main',
      'feature/signup',
      'origin/main',
      'upstream/main'
    ])
  })
})
