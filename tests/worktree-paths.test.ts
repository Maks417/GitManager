import { describe, expect, it } from 'vitest'
import type { Repository } from '../src/shared/ipc'
import {
  defaultWorktreeFolder,
  folderName,
  orderRepos,
  parentFolder,
  worktreeFolderSlug
} from '../src/renderer/src/logic/worktree-paths'

describe('worktree folder names', () => {
  it('splits paths with either separator', () => {
    expect(folderName('C:\\code\\app\\')).toBe('app')
    expect(folderName('/home/max/app')).toBe('app')
    expect(parentFolder('C:\\code\\app')).toBe('C:\\code')
    expect(parentFolder('C:\\app')).toBe('C:\\')
    expect(parentFolder('/app')).toBe('/')
  })

  it('names a worktree after its repository and branch', () => {
    expect(defaultWorktreeFolder('C:\\code\\app', 'feature/login')).toBe('C:\\code\\app-feature-login')
    expect(defaultWorktreeFolder('/home/max/app', 'fix: a*b')).toBe('/home/max/app-fix-a-b')
    expect(defaultWorktreeFolder('/home/max/app', 'x', '/tmp')).toBe('/tmp/app-x')
    expect(worktreeFolderSlug('///')).toBe('worktree')
  })
})

const repo = (path: string, worktreeOf: string | null = null): Repository => ({
  id: path,
  name: folderName(path),
  path,
  currentBranch: 'main',
  remotes: [],
  worktreeOf
})

describe('orderRepos', () => {
  it('lists each worktree under its main repository', () => {
    const rows = orderRepos([
      repo('C:\\code\\app-login', 'C:/code/app'),
      repo('C:\\code\\other'),
      repo('C:\\code\\app'),
      repo('C:\\code\\app-fix', 'C:\\Code\\App'),
      repo('C:\\code\\lonely-wt', 'C:\\code\\gone')
    ])
    expect(rows.map((r) => `${'  '.repeat(r.depth)}${r.repo.name}`)).toEqual([
      'other',
      'app',
      '  app-login',
      '  app-fix',
      'lonely-wt'
    ])
  })
})
