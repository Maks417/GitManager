import { describe, expect, it } from 'vitest'
import { classifyWatchPath } from '../src/main/repo-watcher'

describe('classifyWatchPath', () => {
  it('treats normal files as worktree changes', () => {
    expect(classifyWatchPath('src/App.tsx')).toBe('worktree')
    expect(classifyWatchPath('README.md')).toBe('worktree')
  })

  it('treats index and refs as git-meta', () => {
    expect(classifyWatchPath('.git/index')).toBe('git-meta')
    expect(classifyWatchPath('.git/HEAD')).toBe('git-meta')
    expect(classifyWatchPath('.git/refs/heads/main')).toBe('git-meta')
    expect(classifyWatchPath('.git/MERGE_HEAD')).toBe('git-meta')
  })

  it('ignores noisy git and dependency paths', () => {
    expect(classifyWatchPath('.git/objects/pack/pack-abc.pack')).toBeNull()
    expect(classifyWatchPath('.git/logs/HEAD')).toBeNull()
    expect(classifyWatchPath('node_modules/lodash/index.js')).toBeNull()
    expect(classifyWatchPath('dist/bundle.js')).toBeNull()
    expect(classifyWatchPath('.DS_Store')).toBeNull()
  })

  it('normalizes Windows separators', () => {
    expect(classifyWatchPath('.git\\index')).toBe('git-meta')
    expect(classifyWatchPath('src\\foo.ts')).toBe('worktree')
  })
})
