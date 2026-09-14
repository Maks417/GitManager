import { realpathSync } from 'fs'
import { basename, join } from 'path'
import { describe, expect, it } from 'vitest'
import { getGitDirs } from '../src/git-worker/operations'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

/** Canonical path, so `/var` vs `/private/var` (macOS) and letter case (Windows) don't matter. */
const real = (path: string): string => realpathSync.native(path)

describe('getGitDirs', () => {
  it('finds .git inside a normal work tree', async () => {
    const dir = await initRepo(tempDir('gm-dirs-'))
    const dirs = await getGitDirs(dir)
    expect(real(dirs.gitDir)).toBe(real(join(dir, '.git')))
    expect(real(dirs.commonDir)).toBe(real(join(dir, '.git')))
  }, 30000)

  it('separates the per-worktree and shared directories of a linked worktree', async () => {
    const main = await initRepo(tempDir('gm-dirs-main-'))
    const wt = join(tempDir('gm-dirs-wt-'), 'feature-wt')
    await git(main, 'worktree', 'add', '-q', '-b', 'feature', wt)

    const dirs = await getGitDirs(wt)
    expect(real(dirs.gitDir)).toBe(real(join(main, '.git', 'worktrees', basename(wt))))
    expect(real(dirs.commonDir)).toBe(real(join(main, '.git')))
  }, 30000)

  it("points a submodule at the superproject's modules folder", async () => {
    const lib = await initRepo(tempDir('gm-dirs-lib-'))
    const superRepo = await initRepo(tempDir('gm-dirs-super-'))
    // Git refuses file-path submodule URLs unless file transport is allowed explicitly.
    await git(superRepo, '-c', 'protocol.file.allow=always', 'submodule', 'add', lib.replace(/\\/g, '/'), 'sub')

    const dirs = await getGitDirs(join(superRepo, 'sub'))
    expect(real(dirs.gitDir)).toBe(real(join(superRepo, '.git', 'modules', 'sub')))
    expect(real(dirs.commonDir)).toBe(real(dirs.gitDir))
  }, 30000)
})
