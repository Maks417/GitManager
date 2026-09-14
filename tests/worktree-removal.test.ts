import { existsSync, realpathSync, rmSync } from 'fs'
import { basename, join } from 'path'
import { describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { getWorktreeInfo, inspectRepository, pruneWorktree } from '../src/git-worker/operations'
import { parseWorktreeList } from '../src/git-worker/ops/worktrees'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

/** Compare real, long-form paths (macOS /var symlinks, Windows 8.3 short names, case). */
const canonical = (p: string): string => realpathSync.native(p).toLowerCase()

async function mainWithWorktree(): Promise<{ main: string; wt: string }> {
  const main = await initRepo(tempDir('gm-wt-main-'))
  const wt = join(tempDir('gm-wt-linked-'), 'feature')
  await git(main, 'worktree', 'add', '-q', '-b', 'feature', wt)
  return { main, wt }
}

/** Another worktree of `main`, in a folder of its own named `name`. */
async function addWorktree(main: string, name: string, ...options: string[]): Promise<string> {
  const path = join(tempDir(`gm-wt-${name}-`), name)
  await git(main, 'worktree', 'add', '-q', ...options, path)
  return path
}

/** Folder names of the worktrees `main` lists, main work tree first. */
async function listedNames(main: string): Promise<string[]> {
  return parseWorktreeList(await git(main, 'worktree', 'list', '--porcelain')).map((e) => basename(e.path))
}

describe('parseWorktreeList', () => {
  it('reads each worktree with its HEAD and its detached, lock, prunable and bare flags', () => {
    const output = [
      'worktree /repos/main',
      'HEAD 1111111111111111111111111111111111111111',
      'branch refs/heads/main',
      '',
      'worktree /repos/wt',
      'HEAD 2222222222222222222222222222222222222222',
      'detached',
      'locked moving disks',
      '',
      'worktree /repos/gone',
      'HEAD 3333333333333333333333333333333333333333',
      'branch refs/heads/gone',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree /repos/bare.git',
      'bare',
      ''
    ].join('\n')
    const head = (digit: string): string => digit.repeat(40)
    expect(parseWorktreeList(output)).toEqual([
      { path: '/repos/main', head: head('1'), detached: false, bare: false, locked: false, prunable: false },
      { path: '/repos/wt', head: head('2'), detached: true, bare: false, locked: true, prunable: false },
      { path: '/repos/gone', head: head('3'), detached: false, bare: false, locked: false, prunable: true },
      { path: '/repos/bare.git', head: null, detached: false, bare: true, locked: false, prunable: false }
    ])
  })
})

describe('inspectRepository', () => {
  it('remembers the main work tree of a linked worktree, and nothing for the main one', async () => {
    const { main, wt } = await mainWithWorktree()
    const linked = await inspectRepository(wt)
    expect(canonical(linked.worktreeOf!)).toBe(canonical(main))
    expect((await inspectRepository(main)).worktreeOf).toBeNull()
  }, 30000)
})

describe('getWorktreeInfo', () => {
  it('describes a linked worktree, and the main repository its worktrees depend on', async () => {
    const { main, wt } = await mainWithWorktree()
    const linked = await getWorktreeInfo(wt, null)
    expect(linked).toMatchObject({ exists: true, linkedTo: { mainExists: true, locked: false }, otherWorktrees: 0 })
    expect(canonical(linked.linkedTo!.mainPath)).toBe(canonical(main))
    expect(await getWorktreeInfo(main, null)).toEqual({ exists: true, linkedTo: null, otherWorktrees: 1 })
  }, 30000)

  it('falls back on the remembered main repository once the worktree folder is gone', async () => {
    const { main, wt } = await mainWithWorktree()
    await git(main, 'worktree', 'lock', wt)
    rmSync(wt, { recursive: true, force: true })
    expect(await getWorktreeInfo(wt, main)).toEqual({
      exists: false,
      linkedTo: { mainPath: main, mainExists: true, locked: true },
      otherWorktrees: 0
    })
    expect(await getWorktreeInfo(wt, null)).toEqual({ exists: false, linkedTo: null, otherWorktrees: 0 })
  }, 30000)
})

describe('pruneWorktree', () => {
  it('removes the record of a deleted worktree and of no other worktree', async () => {
    const { main, wt } = await mainWithWorktree()
    await addWorktree(main, 'present', '-b', 'present')
    const unmounted = await addWorktree(main, 'unmounted', '-b', 'unmounted')
    rmSync(wt, { recursive: true, force: true })
    rmSync(unmounted, { recursive: true, force: true })

    expect(await pruneWorktree(main, wt)).toBeNull()
    const names = await listedNames(main)
    // `git worktree prune` would drop "unmounted" too, though its folder may only be on a drive that is not attached.
    expect(names).toHaveLength(3)
    expect(names).toEqual(expect.arrayContaining([basename(main), 'present', 'unmounted']))
  }, 30000)

  it('finds a worktree that Git recorded with a relative path', async (ctx) => {
    const main = await initRepo(tempDir('gm-wt-main-'))
    const wt = join(tempDir('gm-wt-relative-'), 'relative')
    const added = await runGit({ cwd: main, args: ['worktree', 'add', '-q', '--relative-paths', '-b', 'relative', wt] })
    // --relative-paths needs Git 2.48.
    if (added.code !== 0) ctx.skip()
    rmSync(wt, { recursive: true, force: true })

    expect(await pruneWorktree(main, wt)).toBeNull()
    expect(await listedNames(main)).toEqual([basename(main)])
  }, 30000)

  it('keeps the record while its detached HEAD holds commits that are on no branch', async () => {
    const main = await initRepo(tempDir('gm-wt-main-'))
    const experiment = await addWorktree(main, 'experiment', '--detach')
    await git(experiment, 'commit', '-q', '--allow-empty', '-m', 'only on this HEAD')
    const look = await addWorktree(main, 'look', '--detach')
    rmSync(experiment, { recursive: true, force: true })
    rmSync(look, { recursive: true, force: true })

    expect(await pruneWorktree(main, experiment)).toMatch(/1 commit on no branch/)
    // A detached HEAD on a commit that a branch contains loses nothing.
    expect(await pruneWorktree(main, look)).toBeNull()
    expect(await listedNames(main)).toEqual([basename(main), 'experiment'])
  }, 30000)

  it('says why Git keeps the record of a locked worktree', async () => {
    const { main, wt } = await mainWithWorktree()
    await git(main, 'worktree', 'lock', wt)
    rmSync(wt, { recursive: true, force: true })
    expect(await pruneWorktree(main, wt)).toMatch(/locked/)
    expect(await listedNames(main)).toContain('feature')
  }, 30000)

  it('leaves a worktree whose folder still exists', async () => {
    const { main, wt } = await mainWithWorktree()
    expect(await pruneWorktree(main, wt)).toMatch(/still exists/)
    expect(existsSync(wt)).toBe(true)
    expect(await listedNames(main)).toContain('feature')
  }, 30000)
})
