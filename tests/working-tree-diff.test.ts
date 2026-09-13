import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import { getBranches, getStatus, getWorkingTreeDiff, inspectRepository, loadHistory, stagePaths, unstagePaths } from '../src/git-worker/operations'

const dirs: string[] = []

async function initRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'gm-wt-'))
  dirs.push(dir)
  await runGit({ cwd: dir, args: ['init'] })
  await runGit({ cwd: dir, args: ['config', 'user.email', 'test@example.com'] })
  await runGit({ cwd: dir, args: ['config', 'user.name', 'Test User'] })
  writeFileSync(join(dir, 'tracked.txt'), 'line1\n')
  await runGit({ cwd: dir, args: ['add', 'tracked.txt'] })
  await runGit({ cwd: dir, args: ['commit', '-m', 'initial'] })
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('getWorkingTreeDiff', () => {
  it('shows staged modifications against HEAD', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'tracked.txt'), 'line1\nstaged\n')
    await runGit({ cwd: dir, args: ['add', 'tracked.txt'] })

    const diff = await getWorkingTreeDiff(dir, 'tracked.txt', 'staged')
    expect(diff.oldText).toContain('line1')
    expect(diff.newText).toContain('staged')
    expect(diff.binary).toBe(false)
  }, 30000)

  it('shows unstaged modifications against the index', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'tracked.txt'), 'line1\nunstaged\n')

    const diff = await getWorkingTreeDiff(dir, 'tracked.txt', 'unstaged')
    expect(diff.oldText).toBe('line1\n')
    expect(diff.newText).toContain('unstaged')
  }, 30000)

  it('shows untracked files as empty → worktree', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'new.txt'), 'brand new\n')

    const diff = await getWorkingTreeDiff(dir, 'new.txt', 'unstaged')
    expect(diff.oldText).toBe('')
    expect(diff.newText).toBe('brand new\n')
  }, 30000)

  it('shows deleted worktree files as index → empty', async () => {
    const dir = await initRepo()
    unlinkSync(join(dir, 'tracked.txt'))

    const diff = await getWorkingTreeDiff(dir, 'tracked.txt', 'unstaged')
    expect(diff.oldText).toBe('line1\n')
    expect(diff.newText).toBe('')
  }, 30000)

  it('flags binary content', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 3]))
    await runGit({ cwd: dir, args: ['add', 'bin.dat'] })

    const diff = await getWorkingTreeDiff(dir, 'bin.dat', 'staged')
    expect(diff.binary).toBe(true)
  }, 30000)

  it('handles unborn branch (no commits yet)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gm-empty-'))
    dirs.push(dir)
    await runGit({ cwd: dir, args: ['init'] })
    await runGit({ cwd: dir, args: ['config', 'user.email', 'test@example.com'] })
    await runGit({ cwd: dir, args: ['config', 'user.name', 'Test User'] })
    writeFileSync(join(dir, 'readme.md'), 'hello\n')
    await runGit({ cwd: dir, args: ['add', 'readme.md'] })

    const repo = await inspectRepository(dir)
    expect(repo.currentBranch).toBeTruthy()

    const page = await loadHistory({ repoPath: dir, limit: 50 })
    expect(page.commits).toEqual([])
    expect(page.headSha).toBeNull()

    const branches = await getBranches(dir)
    expect(branches.some((b) => b.current)).toBe(true)

    const diff = await getWorkingTreeDiff(dir, 'readme.md', 'staged')
    expect(diff.oldText).toBe('')
    expect(diff.newText).toContain('hello')

    await unstagePaths(dir, ['readme.md'])
    const status = await getStatus(dir)
    const entry = status.find((s) => s.path === 'readme.md')
    expect(entry?.staged).toBe(false)
    expect(entry?.untracked || entry?.unstaged).toBe(true)
  }, 30000)

  it('unstages paths when HEAD exists', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'tracked.txt'), 'line1\nstaged\n')
    await stagePaths(dir, ['tracked.txt'])
    let status = await getStatus(dir)
    expect(status.find((s) => s.path === 'tracked.txt')?.staged).toBe(true)

    await unstagePaths(dir, ['tracked.txt'])
    status = await getStatus(dir)
    const entry = status.find((s) => s.path === 'tracked.txt')
    expect(entry?.staged).toBe(false)
    expect(entry?.unstaged).toBe(true)
  }, 30000)
})
