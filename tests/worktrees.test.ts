import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { describe, expect, it } from 'vitest'
import { isGitTooOld, WORKTREE_HAS_CHANGES, worktreeConflictPath } from '../src/shared/git-messages'
import {
  addWorktree,
  checkoutRef,
  deleteBranch,
  getBranches,
  listWorktreeItems,
  lockWorktree,
  pruneMissingWorktrees,
  removeWorktree,
  unlockWorktree
} from '../src/git-worker/operations'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

/** Compare real, long-form paths (macOS /var symlinks, Windows 8.3 short names, case). */
const canonical = (p: string): string => realpathSync.native(p).toLowerCase()

/** A repository with a `feature` branch, and a folder to put new worktrees in. */
async function setup(): Promise<{ main: string; spare: (name: string) => string }> {
  const main = await initRepo(tempDir('gm-wts-main-'))
  await git(main, 'branch', 'feature')
  const parent = tempDir('gm-wts-new-')
  return { main, spare: (name) => join(parent, name) }
}

describe('listWorktreeItems', () => {
  it('lists the main work tree first, with the branch each worktree has checked out', async () => {
    const { main, spare } = await setup()
    const wt = await addWorktree(main, { path: spare('feature'), branch: 'feature' })
    await lockWorktree(main, wt, 'on a USB disk')

    const items = await listWorktreeItems(main)
    expect(items.map((i) => [canonical(i.path), i.branch, i.isMain, i.isCurrent])).toEqual([
      [canonical(main), 'main', true, true],
      [canonical(wt), 'feature', false, false]
    ])
    expect(items[1]).toMatchObject({ locked: true, lockReason: 'on a USB disk', detached: false })
    expect((await listWorktreeItems(wt)).map((i) => i.isCurrent)).toEqual([false, true])
  }, 30000)
})

describe('addWorktree', () => {
  it('checks out an existing branch, a new branch, a tracking branch or a detached commit', async () => {
    const { main, spare } = await setup()
    const head = (await git(main, 'rev-parse', 'HEAD')).trim()
    await git(main, 'remote', 'add', 'origin', 'https://example.invalid/repo.git')
    await git(main, 'update-ref', 'refs/remotes/origin/remote-work', head)

    await addWorktree(main, { path: spare('existing'), branch: 'feature' })
    await addWorktree(main, { path: spare('new'), newBranch: 'topic', startPoint: 'main' })
    await addWorktree(main, { path: spare('tracking'), newBranch: 'remote-work', startPoint: 'origin/remote-work', track: true })
    await addWorktree(main, { path: spare('detached'), startPoint: head })

    const items = await listWorktreeItems(main)
    const byFolder = Object.fromEntries(items.slice(1).map((i) => [basename(i.path), i]))
    expect(Object.fromEntries(Object.entries(byFolder).map(([folder, i]) => [folder, i.branch]))).toEqual({
      existing: 'feature',
      new: 'topic',
      tracking: 'remote-work',
      detached: null
    })
    expect(byFolder.detached).toMatchObject({ detached: true, head })
    expect((await git(main, 'rev-parse', '--abbrev-ref', 'remote-work@{upstream}')).trim()).toBe('origin/remote-work')
  }, 30000)

  it('refuses a folder that is not empty, and a relative path', async () => {
    const { main, spare } = await setup()
    const busy = spare('busy')
    mkdirSync(busy)
    writeFileSync(join(busy, 'notes.txt'), 'keep me\n')
    await expect(addWorktree(main, { path: busy, branch: 'feature' })).rejects.toThrow(/not empty/)
    await expect(addWorktree(main, { path: 'relative/wt', branch: 'feature' })).rejects.toThrow(/Invalid worktree folder/)
    await expect(addWorktree(main, { path: spare('opt'), branch: '--orphan' })).rejects.toThrow(/Invalid branch/)
  }, 30000)
})

describe('removeWorktree', () => {
  it('removes a clean worktree, and one with changes only when forced', async () => {
    const { main, spare } = await setup()
    const clean = await addWorktree(main, { path: spare('clean'), branch: 'feature' })
    await removeWorktree(main, clean)
    expect((await listWorktreeItems(main)).length).toBe(1)

    const dirty = await addWorktree(main, { path: spare('dirty'), newBranch: 'dirty' })
    writeFileSync(join(dirty, 'scratch.txt'), 'untracked\n')
    await expect(removeWorktree(main, dirty)).rejects.toThrow(WORKTREE_HAS_CHANGES)
    await removeWorktree(main, dirty, true)
    expect((await listWorktreeItems(main)).length).toBe(1)
  }, 30000)

  it('refuses the main work tree, the worktree asked from, and a locked one', async () => {
    const { main, spare } = await setup()
    const wt = await addWorktree(main, { path: spare('wt'), branch: 'feature' })
    await expect(removeWorktree(wt, main)).rejects.toThrow(/main work tree/)
    await expect(removeWorktree(wt, wt)).rejects.toThrow(/Switch to another worktree/)
    await lockWorktree(main, wt)
    await expect(removeWorktree(main, wt)).rejects.toThrow(/locked/)
    await unlockWorktree(main, wt)
    await removeWorktree(main, wt)
  }, 30000)
})

describe('pruneMissingWorktrees', () => {
  it('drops the records of worktrees whose folder is gone', async () => {
    const { main, spare } = await setup()
    const gone = await addWorktree(main, { path: spare('gone'), branch: 'feature' })
    rmSync(gone, { recursive: true, force: true })
    expect(await pruneMissingWorktrees(main)).toBe(1)
    expect((await listWorktreeItems(main)).length).toBe(1)
  }, 30000)
})

describe('branches held by another worktree', () => {
  it('names the worktree holding a branch, but not for the current branch', async () => {
    const { main, spare } = await setup()
    const wt = await addWorktree(main, { path: spare('wt'), branch: 'feature' })
    const branches = await getBranches(main)
    expect(branches.find((b) => b.name === 'main')?.worktreePath).toBeNull()
    expect(canonical(branches.find((b) => b.name === 'feature')!.worktreePath!)).toBe(canonical(wt))
  }, 30000)

  it("reads the worktree from Git's refusal to check out or delete the branch", async () => {
    const { main, spare } = await setup()
    const wt = await addWorktree(main, { path: spare('wt'), branch: 'feature' })
    const checkout = await checkoutRef(main, 'feature').catch((err: Error) => err.message)
    expect(canonical(worktreeConflictPath(String(checkout))!)).toBe(canonical(wt))
    const removal = await deleteBranch(main, 'feature', true).catch((err: Error) => err.message)
    expect(canonical(worktreeConflictPath(String(removal))!)).toBe(canonical(wt))
  }, 30000)

  it('understands the older wording too, and names Windows folders with backslashes', () => {
    expect(worktreeConflictPath("fatal: 'feature' is already checked out at '/repos/wt'")).toBe('/repos/wt')
    expect(worktreeConflictPath("fatal: 'feature' is already used by worktree at 'C:/repos/wt'")).toBe('C:\\repos\\wt')
    expect(worktreeConflictPath('error: pathspec did not match')).toBeNull()
  })
})

describe('isGitTooOld', () => {
  it('compares the version Git reports with 2.23', () => {
    expect(isGitTooOld('2.22.5')).toBe(true)
    expect(isGitTooOld('1.9.1')).toBe(true)
    expect(isGitTooOld('2.23.0')).toBe(false)
    expect(isGitTooOld('2.45.1.windows.1')).toBe(false)
    expect(isGitTooOld('3.0.0')).toBe(false)
    expect(isGitTooOld('unknown')).toBe(false)
  })
})
