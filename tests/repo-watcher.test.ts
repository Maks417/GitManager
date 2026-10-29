import { mkdirSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterIgnoredFolders, filterIgnoredPaths, getGitDirs } from '../src/git-worker/operations'
import {
  batchCovered,
  classifyWatchPath,
  createChangeBatcher,
  createIgnoredFolderCache,
  planWatchTargets,
  startRepoWatch,
  stopRepoWatch,
  subscribeRepoWatch,
  toVirtualGitPath,
  type RepoWatchEvent,
  type WatchBatch
} from '../src/main/repo-watcher'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

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
    expect(classifyWatchPath('.git/COMMIT_EDITMSG')).toBeNull()
    expect(classifyWatchPath('node_modules/lodash/index.js')).toBeNull()
    expect(classifyWatchPath('.DS_Store')).toBeNull()
    // The fsmonitor daemon writes cookies on every status, the app's own too: a refresh loop otherwise.
    expect(classifyWatchPath('.git/fsmonitor--daemon/cookies/1234-0')).toBeNull()
    expect(classifyWatchPath('.git/gc.pid')).toBeNull()
    expect(classifyWatchPath('.vs/App/v17/.suo')).toBeNull()
  })

  it('normalizes Windows separators', () => {
    expect(classifyWatchPath('.git\\HEAD')).toBe('git-meta')
    expect(classifyWatchPath('src\\foo.ts')).toBe('worktree')
  })

  it('ignores other linked worktrees and treats submodule repositories as status changes', () => {
    expect(classifyWatchPath('.git/worktrees/feature/HEAD')).toBeNull()
    expect(classifyWatchPath('.git/worktrees/feature/index')).toBeNull()
    expect(classifyWatchPath('.git/modules/sub/HEAD')).toBe('worktree')
    expect(classifyWatchPath('.git/modules/libs/sub/refs/heads/main')).toBe('worktree')
    expect(classifyWatchPath('.git/modules/sub/objects/ab/cdef')).toBeNull()
    expect(classifyWatchPath('.git/modules/sub/index.lock')).toBeNull()
  })
})

describe('toVirtualGitPath', () => {
  it('maps git directory events onto the layout of a normal .git folder', () => {
    expect(toVirtualGitPath('gitDir', 'HEAD')).toBe('.git/HEAD')
    expect(toVirtualGitPath('gitDir', 'rebase-merge\\done')).toBe('.git/rebase-merge/done')
    expect(toVirtualGitPath('commonRefs', 'heads/main')).toBe('.git/refs/heads/main')
    expect(toVirtualGitPath('commonDir', 'packed-refs')).toBe('.git/packed-refs')
  })

  it('drops files of the shared directory other than packed refs', () => {
    expect(toVirtualGitPath('commonDir', 'HEAD')).toBeNull()
    expect(toVirtualGitPath('commonDir', 'packed-refs.lock')).toBeNull()
    expect(toVirtualGitPath('commonDir', null)).toBeNull()
  })
})

describe('planWatchTargets', () => {
  it('watches only the work tree when .git is inside it', () => {
    const repo = resolve('/repos/app')
    expect(planWatchTargets(repo, { gitDir: join(repo, '.git'), commonDir: join(repo, '.git') })).toEqual([
      { path: repo, recursive: true, source: 'worktree' }
    ])
    expect(planWatchTargets(repo)).toHaveLength(1)
  })

  it('adds the per-worktree directory and the shared refs of a linked worktree', () => {
    const common = resolve('/repos/main/.git')
    const wt = resolve('/repos/app-wt')
    const targets = planWatchTargets(wt, { gitDir: join(common, 'worktrees', 'app-wt'), commonDir: common })
    expect(targets.map((t) => [t.source, t.path, t.recursive])).toEqual([
      ['worktree', wt, true],
      ['gitDir', join(common, 'worktrees', 'app-wt'), true],
      ['commonRefs', join(common, 'refs'), true],
      ['commonDir', common, false]
    ])
  })

  it("watches a submodule's repository inside the superproject", () => {
    const modules = resolve('/repos/super/.git/modules/sub')
    const targets = planWatchTargets(resolve('/repos/super/sub'), { gitDir: modules, commonDir: modules })
    expect(targets.map((t) => [t.source, t.path])).toEqual([
      ['worktree', resolve('/repos/super/sub')],
      ['gitDir', modules]
    ])
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
    expect(batches).toMatchObject([{ kind: 'worktree', paths: ['src/a.ts', 'src/b.ts'], force: false, rulesChanged: false }])
  })

  it('forces a refresh when Git metadata changed and escalates to git-meta', () => {
    vi.useFakeTimers()
    const batches: WatchBatch[] = []
    const batcher = createChangeBatcher((b) => batches.push(b), 400)
    batcher.add('src/a.ts')
    batcher.add('.git/HEAD')
    vi.advanceTimersByTime(400)
    expect(batches).toMatchObject([{ kind: 'git-meta', paths: [], force: true }])
  })

  it('flushes after the maximum wait while changes keep coming', () => {
    vi.useFakeTimers()
    const batches: WatchBatch[] = []
    const batcher = createChangeBatcher((b) => batches.push(b), { debounceMs: 400, maxWaitMs: 2000 })
    for (let t = 0; t < 2000; t += 100) {
      batcher.add(`src/file${t}.ts`)
      vi.advanceTimersByTime(100)
    }
    expect(batches).toHaveLength(1)
    expect(batches[0].paths).toHaveLength(20)
  })

  it('drops skipped paths without delaying the batch, and notes ignore rule changes', () => {
    vi.useFakeTimers()
    const batches: WatchBatch[] = []
    const batcher = createChangeBatcher((b) => batches.push(b), { debounceMs: 400, skip: (rel) => rel.startsWith('obj/') })
    batcher.add('src/a.ts')
    vi.advanceTimersByTime(300)
    batcher.add('obj/Debug/app.dll')
    vi.advanceTimersByTime(100)
    expect(batches).toMatchObject([{ paths: ['src/a.ts'], rulesChanged: false }])
    batcher.add('sub/.gitignore')
    vi.advanceTimersByTime(400)
    expect(batches[1]).toMatchObject({ paths: ['sub/.gitignore'], rulesChanged: true })
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

describe('batchCovered', () => {
  it('skips a batch whose changes all came before a finished refresh of that scope', () => {
    const covered = { meta: 100, status: 200 }
    expect(batchCovered({ kind: 'worktree', changedAt: 150 }, covered)).toBe(true)
    expect(batchCovered({ kind: 'worktree', changedAt: 250 }, covered)).toBe(false)
    // A status refresh does not cover branch or HEAD changes.
    expect(batchCovered({ kind: 'git-meta', changedAt: 150 }, covered)).toBe(false)
    expect(batchCovered({ kind: 'git-meta', changedAt: 50 }, covered)).toBe(true)
  })
})

describe('createIgnoredFolderCache', () => {
  it('covers paths below known folders and offers only unknown ancestors', () => {
    const cache = createIgnoredFolderCache()
    expect(cache.candidates(['bin/Debug/net8/app.dll', 'debug.log'])).toEqual(['bin', 'bin/Debug', 'bin/Debug/net8'])
    cache.add(['bin'])
    expect(cache.covers('bin/Debug/app.dll')).toBe(true)
    expect(cache.covers('BIN/x')).toBe(true)
    expect(cache.covers('binary/x')).toBe(false)
    expect(cache.covers('bin')).toBe(false)
    expect(cache.candidates(['bin/Release/a.dll'])).toEqual([])
    cache.clear()
    expect(cache.covers('bin/Debug/app.dll')).toBe(false)
  })
})

describe('filterIgnoredFolders', () => {
  it('reports ignored folders unless they hold a tracked file', async () => {
    const dir = await initRepo(tempDir('gm-ignore-folders-'))
    writeFileSync(join(dir, '.gitignore'), 'dist/\nbin/\nlogs/*\n!logs/keep.txt\n')
    mkdirSync(join(dir, 'dist'))
    writeFileSync(join(dir, 'dist', 'keep.txt'), 'tracked\n')
    await git(dir, 'add', '.gitignore')
    await git(dir, 'add', '-f', 'dist/keep.txt')
    await git(dir, 'commit', '-m', 'ignore rules')
    // The watcher asks about folders it saw changes in, so they exist.
    for (const folder of ['bin/Debug', 'logs', 'src']) mkdirSync(join(dir, folder), { recursive: true })
    for (const file of ['bin/Debug/app.dll', 'logs/a.log', 'src/app.ts']) writeFileSync(join(dir, file), 'x')

    // dist holds a tracked file; logs itself is not ignored, only what is in it; src is not ignored.
    expect(await filterIgnoredFolders(dir, ['dist', 'bin', 'bin/Debug', 'logs', 'src'])).toEqual(['bin', 'bin/Debug'])
  }, 30000)
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

describe('startRepoWatch', () => {
  afterEach(() => {
    stopRepoWatch()
  })

  it('reports ref and HEAD changes of a linked worktree as git-meta', async () => {
    const main = await initRepo(tempDir('gm-watch-main-'))
    const wt = join(tempDir('gm-watch-wt-'), 'wt')
    await git(main, 'worktree', 'add', '-q', '-b', 'feature', wt)
    const kinds: RepoWatchEvent['kind'][] = []
    const off = subscribeRepoWatch((e) => kinds.push(e.kind))
    try {
      startRepoWatch(wt, { gitDirs: await getGitDirs(wt) })
      await sleep(500)

      // The commit moves refs/heads/feature, which lives in the main repository's .git.
      await git(wt, 'commit', '-q', '--allow-empty', '-m', 'in worktree')
      await vi.waitFor(() => expect(kinds).toContain('git-meta'), { timeout: 8000, interval: 100 })

      // Detaching rewrites only this worktree's HEAD, under .git/worktrees/wt.
      await sleep(1000)
      kinds.length = 0
      await git(wt, 'checkout', '-q', '--detach')
      await vi.waitFor(() => expect(kinds).toContain('git-meta'), { timeout: 8000, interval: 100 })
    } finally {
      off()
    }
  }, 30000)
})
