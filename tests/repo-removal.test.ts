import { mkdirSync, writeFileSync } from 'fs'
import { join, parse, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { isPathInside } from '../src/git-worker/path-utils'
import { inspectRepoForRemoval } from '../src/git-worker/operations'
import { assertDeletableRepoDir } from '../src/main/repo-removal'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('isPathInside', () => {
  it('matches the path itself and its descendants only', () => {
    const base = resolve('/work/repo')
    expect(isPathInside(base, base)).toBe(true)
    expect(isPathInside(base, join(base, 'src', 'a.ts'))).toBe(true)
    expect(isPathInside(base, join(base, '..foo'))).toBe(true)
    expect(isPathInside(base, join(base, '..', 'repo-other'))).toBe(false)
    expect(isPathInside(base, resolve('/work'))).toBe(false)
  })
})

describe('assertDeletableRepoDir', () => {
  it('accepts a repository root under the home folder', () => {
    const home = tempDir('gm-home-')
    const repo = join(home, 'projects', 'app')
    mkdirSync(join(repo, '.git'), { recursive: true })
    expect(assertDeletableRepoDir(repo, { home, protectedPaths: [] })).toBe(resolve(repo))
  })

  it('refuses roots, home, folders containing protected paths, and non-repositories', () => {
    const home = tempDir('gm-home-')
    mkdirSync(join(home, '.git'))
    const appData = join(home, 'AppData')
    mkdirSync(join(appData, '.git'), { recursive: true })
    const ctx = { home, protectedPaths: [join(appData, 'Git Manager')] }

    expect(() => assertDeletableRepoDir(parse(home).root, ctx)).toThrow(/filesystem root/)
    expect(() => assertDeletableRepoDir(home, ctx)).toThrow(/contains/)
    expect(() => assertDeletableRepoDir(join(home, '..'), ctx)).toThrow(/contains/)
    expect(() => assertDeletableRepoDir(appData, ctx)).toThrow(/contains/)

    const plain = join(home, 'not-a-repo')
    mkdirSync(plain)
    expect(() => assertDeletableRepoDir(plain, ctx)).toThrow(/not a Git repository root/)
  })
})

describe('inspectRepoForRemoval', () => {
  it('counts uncommitted changes, stashes and unpushed commits', async () => {
    const dir = await initRepo(tempDir('gm-remove-'))
    expect(await inspectRepoForRemoval(dir)).toEqual({ uncommitted: 0, stashes: 0, unpushed: 1 })

    writeFileSync(join(dir, 'wip.txt'), 'wip\n')
    await git(dir, 'stash', 'push', '-u')
    writeFileSync(join(dir, 'README.md'), 'changed\n')
    expect(await inspectRepoForRemoval(dir)).toEqual({ uncommitted: 1, stashes: 1, unpushed: 1 })
  }, 30000)

  it('counts only the changes of a linked worktree, whose commits and stashes stay in the main repository', async () => {
    const main = await initRepo(tempDir('gm-remove-main-'))
    const wt = join(tempDir('gm-remove-wt-'), 'feature')
    await git(main, 'worktree', 'add', '-q', '-b', 'feature', wt)
    writeFileSync(join(wt, 'wip.txt'), 'wip\n')
    await git(wt, 'stash', 'push', '-u')
    writeFileSync(join(wt, 'README.md'), 'changed\n')

    expect(await inspectRepoForRemoval(wt)).toEqual({ uncommitted: 1, stashes: 0, unpushed: 0 })
    // The stash made in the worktree is the main repository's.
    expect(await inspectRepoForRemoval(main)).toEqual({ uncommitted: 0, stashes: 1, unpushed: 1 })
  }, 30000)
})
