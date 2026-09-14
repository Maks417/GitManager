import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterIgnoredPaths } from '../src/git-worker/operations'
import { classifyWatchPath, createChangeBatcher, type WatchBatch } from '../src/main/repo-watcher'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('classifyWatchPath', () => {
  it('treats normal files, including tracked build folders, as worktree changes', () => {
    expect(classifyWatchPath('src/App.tsx')).toBe('worktree')
    expect(classifyWatchPath('README.md')).toBe('worktree')
    expect(classifyWatchPath('dist/bundle.js')).toBe('worktree')
    expect(classifyWatchPath('build/icon.png')).toBe('worktree')
  })

  it('refreshes history only for refs and HEAD; the index only affects status', () => {
    expect(classifyWatchPath('.git/HEAD')).toBe('git-meta')
    expect(classifyWatchPath('.git/refs/heads/main')).toBe('git-meta')
    expect(classifyWatchPath('.git/MERGE_HEAD')).toBe('git-meta')
    expect(classifyWatchPath('.git/index')).toBe('worktree')
  })

  it('ignores lock files, noisy git internals and dependency folders', () => {
    expect(classifyWatchPath('.git/index.lock')).toBeNull()
    expect(classifyWatchPath('.git/refs/heads/main.lock')).toBeNull()
    expect(classifyWatchPath('.git/objects/pack/pack-abc.pack')).toBeNull()
    expect(classifyWatchPath('.git/logs/HEAD')).toBeNull()
    expect(classifyWatchPath('node_modules/lodash/index.js')).toBeNull()
    expect(classifyWatchPath('.DS_Store')).toBeNull()
  })

  it('normalizes Windows separators', () => {
    expect(classifyWatchPath('.git\\HEAD')).toBe('git-meta')
    expect(classifyWatchPath('src\\foo.ts')).toBe('worktree')
  })
})

describe('createChangeBatcher', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces events into one batch of work-tree paths', () => {
    vi.useFakeTimers()
    const batches: WatchBatch[] = []
    const batcher = createChangeBatcher((b) => batches.push(b), 400)
    batcher.add('src\\a.ts')
    vi.advanceTimersByTime(300)
    batcher.add('src/b.ts')
    batcher.add('node_modules/x.js')
    vi.advanceTimersByTime(399)
    expect(batches).toEqual([])
    vi.advanceTimersByTime(1)
    expect(batches).toEqual([{ kind: 'worktree', paths: ['src/a.ts', 'src/b.ts'], force: false }])
  })

  it('forces a refresh when Git metadata changed and escalates to git-meta', () => {
    vi.useFakeTimers()
    const batches: WatchBatch[] = []
    const batcher = createChangeBatcher((b) => batches.push(b), 400)
    batcher.add('src/a.ts')
    batcher.add('.git/HEAD')
    vi.advanceTimersByTime(400)
    expect(batches).toEqual([{ kind: 'git-meta', paths: [], force: true }])
  })

  it('does not flush after cancel', () => {
    vi.useFakeTimers()
    const batches: WatchBatch[] = []
    const batcher = createChangeBatcher((b) => batches.push(b), 400)
    batcher.add('src/a.ts')
    batcher.cancel()
    vi.advanceTimersByTime(1000)
    expect(batches).toEqual([])
  })
})

describe('filterIgnoredPaths', () => {
  it('reports ignored paths but never tracked files, even inside ignored folders', async () => {
    const dir = await initRepo(tempDir('gm-ignore-'))
    writeFileSync(join(dir, '.gitignore'), 'dist/\n*.log\n')
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'dist', 'keep.txt'), 'tracked\n')
    await git(dir, 'add', '.gitignore')
    await git(dir, 'add', '-f', 'dist/keep.txt')
    await git(dir, 'commit', '-m', 'ignore rules')

    const ignored = await filterIgnoredPaths(dir, ['dist/keep.txt', 'dist/new.js', 'debug.log', 'src/app.ts'])
    expect(ignored.sort()).toEqual(['debug.log', 'dist/new.js'])
    expect(await filterIgnoredPaths(dir, ['src/app.ts'])).toEqual([])
  }, 30000)
})
