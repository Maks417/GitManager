import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { chunkPaths } from '../src/git-worker/ops/status'
import { getStatus, planDiscard, restoreWorktree, stagePaths, unstagePaths } from '../src/git-worker/operations'
import { git, initRepo, mergeWithConflicts, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('chunkPaths', () => {
  it('keeps order and every chunk under the character budget', () => {
    const paths = Array.from({ length: 50 }, (_, i) => `folder/file-${String(i).padStart(3, '0')}.txt`)
    const chunks = chunkPaths(paths, 200)
    expect(chunks.flat()).toEqual(paths)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.join('   ').length).toBeLessThanOrEqual(200)
  })
})

describe('discard planning', () => {
  it('restores tracked changes, removes untracked files and folders, and leaves conflicts alone', async () => {
    const dir = await initRepo(tempDir('gm-discard-'), { initialCommit: false })
    await mergeWithConflicts(dir, {
      base: { 'tracked.txt': 'v1\n', 'clash.txt': 'base\n' },
      theirs: { 'clash.txt': 'theirs\n' },
      ours: { 'clash.txt': 'ours\n' }
    })
    writeFileSync(join(dir, 'tracked.txt'), 'edited\n')
    writeFileSync(join(dir, 'new.txt'), 'untracked\n')
    mkdirSync(join(dir, 'scratch'))
    writeFileSync(join(dir, 'scratch', 'notes.txt'), 'untracked folder\n')

    const plan = await planDiscard(dir, ['tracked.txt', 'new.txt', 'scratch/', 'clash.txt'])
    expect(plan).toEqual({ restore: ['tracked.txt'], remove: ['new.txt', 'scratch/'], conflicted: ['clash.txt'] })

    await restoreWorktree(dir, plan.restore)
    expect(readFileSync(join(dir, 'tracked.txt'), 'utf8')).toBe('v1\n')
    expect(existsSync(join(dir, 'new.txt'))).toBe(true)
  }, 30000)
})

describe('bulk staging', () => {
  it('stages and unstages more paths than fit on one Windows command line', async () => {
    const dir = await initRepo(tempDir('gm-bulk-'))
    const names = Array.from({ length: 1200 }, (_, i) => `generated-file-with-a-rather-long-name-${String(i).padStart(4, '0')}.txt`)
    for (const name of names) writeFileSync(join(dir, name), `${name}\n`)
    expect(names.join(' ').length).toBeGreaterThan(40_000)

    await stagePaths(dir, names)
    expect((await getStatus(dir)).filter((s) => s.staged)).toHaveLength(1200)

    await unstagePaths(dir, names)
    expect((await getStatus(dir)).filter((s) => s.staged)).toHaveLength(0)
    expect((await git(dir, 'status', '--porcelain')).length).toBeGreaterThan(0)
    // About 15 s on a Windows CI runner, but over 60 s when the runner is slow.
  }, 180000)
})

describe('status of new files', () => {
  it('lists new files one by one, also inside new folders', async () => {
    const dir = await initRepo(tempDir('gm-untracked-'))
    writeFileSync(join(dir, 'README.md'), '# repo\nedited\n')
    mkdirSync(join(dir, 'docs', 'shots'), { recursive: true })
    writeFileSync(join(dir, 'docs', 'shots', 'dark.png'), 'dark')
    writeFileSync(join(dir, 'docs', 'shots', 'light.png'), 'light')

    const status = await getStatus(dir)
    expect(status.map((s) => [s.path, s.untracked])).toEqual([
      ['README.md', false],
      ['docs/shots/dark.png', true],
      ['docs/shots/light.png', true]
    ])
  }, 30000)

  it('lists each new folder as one entry when there are too many new files', async () => {
    const dir = await initRepo(tempDir('gm-untracked-limit-'))
    writeFileSync(join(dir, 'README.md'), '# repo\nedited\n')
    writeFileSync(join(dir, 'new.txt'), 'new\n')
    mkdirSync(join(dir, 'vendor', 'lib'), { recursive: true })
    for (const name of ['a.js', 'b.js', 'c.js']) writeFileSync(join(dir, 'vendor', 'lib', name), name)

    expect((await getStatus(dir, { untrackedLimit: 3 })).map((s) => s.path)).toEqual(['README.md', 'new.txt', 'vendor/'])
    // Only new files count towards the limit, not changed tracked ones.
    expect((await getStatus(dir, { untrackedLimit: 4 })).map((s) => s.path)).toEqual([
      'README.md',
      'new.txt',
      'vendor/lib/a.js',
      'vendor/lib/b.js',
      'vendor/lib/c.js'
    ])
  }, 30000)

  it('keeps listing folders for a minute after finding too many new files, then looks again', async () => {
    const dir = await initRepo(tempDir('gm-untracked-recheck-'))
    mkdirSync(join(dir, 'vendor'), { recursive: true })
    for (const name of ['a.js', 'b.js', 'c.js']) writeFileSync(join(dir, 'vendor', name), name)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      expect((await getStatus(dir, { untrackedLimit: 2 })).map((s) => s.path)).toEqual(['vendor/'])
      rmSync(join(dir, 'vendor', 'b.js'))
      rmSync(join(dir, 'vendor', 'c.js'))
      // Within the minute the folder listing is reused, without walking every new file first.
      expect((await getStatus(dir, { untrackedLimit: 2 })).map((s) => s.path)).toEqual(['vendor/'])
      vi.advanceTimersByTime(60_000)
      expect((await getStatus(dir, { untrackedLimit: 2 })).map((s) => s.path)).toEqual(['vendor/a.js'])
    } finally {
      vi.useRealTimers()
    }
  }, 30000)
})

describe('status of renamed files', () => {
  it('reports the path a staged rename came from', async () => {
    const dir = await initRepo(tempDir('gm-renamed-'))
    await git(dir, 'mv', 'README.md', 'GUIDE.md')

    const status = await getStatus(dir)
    expect(status).toHaveLength(1)
    expect(status[0]).toMatchObject({ path: 'GUIDE.md', oldPath: 'README.md', indexStatus: 'R', staged: true })
  }, 30000)
})
