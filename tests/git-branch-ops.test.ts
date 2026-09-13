import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { runGit } from '../src/git-worker/git-runner'
import {
  commit,
  createBranch,
  deleteBranch,
  getBranches,
  listStashes,
  loadHistory,
  mergeRef,
  rebaseAbort,
  rebaseContinue,
  rebaseOnto,
  stashApply,
  stashDrop,
  stashPop,
  stashSave
} from '../src/git-worker/operations'

const dirs: string[] = []

async function initRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'gm-ops-'))
  dirs.push(dir)
  await runGit({ cwd: dir, args: ['init'] })
  await runGit({ cwd: dir, args: ['config', 'user.email', 'test@example.com'] })
  await runGit({ cwd: dir, args: ['config', 'user.name', 'Test User'] })
  writeFileSync(join(dir, 'README.md'), '# one\n')
  await runGit({ cwd: dir, args: ['add', 'README.md'] })
  await runGit({ cwd: dir, args: ['commit', '-m', 'Initial commit'] })
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()
    if (d) rmSync(d, { recursive: true, force: true })
  }
})

describe('branch merge rebase stash ops', () => {
  it('creates and deletes a branch', async () => {
    const dir = await initRepo()
    await createBranch(dir, 'feature-x', false)
    let branches = await getBranches(dir)
    expect(branches.some((b) => b.name === 'feature-x')).toBe(true)
    await deleteBranch(dir, 'feature-x', false)
    branches = await getBranches(dir)
    expect(branches.some((b) => b.name === 'feature-x')).toBe(false)
  }, 30000)

  it('merges a feature branch cleanly', async () => {
    const dir = await initRepo()
    await createBranch(dir, 'feature', true)
    writeFileSync(join(dir, 'feature.txt'), 'feature\n')
    await runGit({ cwd: dir, args: ['add', 'feature.txt'] })
    await runGit({ cwd: dir, args: ['commit', '-m', 'Add feature'] })
    await runGit({ cwd: dir, args: ['checkout', 'master'] }).catch(async () => {
      await runGit({ cwd: dir, args: ['checkout', 'main'] })
    })
    const result = await mergeRef(dir, 'feature')
    expect(result.conflicts).toEqual([])
    const page = await loadHistory({ repoPath: dir, limit: 20 })
    expect(page.commits.some((c) => c.subject.includes('feature') || c.subject.includes('Merge'))).toBe(true)
  }, 30000)

  it('rebases a branch onto another without conflicts', async () => {
    const dir = await initRepo()
    await createBranch(dir, 'base-line', false)
    writeFileSync(join(dir, 'base.txt'), 'base\n')
    await runGit({ cwd: dir, args: ['add', 'base.txt'] })
    await runGit({ cwd: dir, args: ['commit', '-m', 'Base change'] })
    await createBranch(dir, 'topic', true)
    writeFileSync(join(dir, 'topic.txt'), 'topic\n')
    await runGit({ cwd: dir, args: ['add', 'topic.txt'] })
    await runGit({ cwd: dir, args: ['commit', '-m', 'Topic change'] })
    const result = await rebaseOnto(dir, 'base-line')
    expect(result.conflicts).toEqual([])
  }, 30000)

  it('aborts a conflicting rebase', async () => {
    const dir = await initRepo()
    await createBranch(dir, 'side-a', true)
    writeFileSync(join(dir, 'clash.txt'), 'a\n')
    await runGit({ cwd: dir, args: ['add', 'clash.txt'] })
    await runGit({ cwd: dir, args: ['commit', '-m', 'A'] })
    await runGit({ cwd: dir, args: ['checkout', 'master'] }).catch(async () => {
      await runGit({ cwd: dir, args: ['checkout', 'main'] })
    })
    await createBranch(dir, 'side-b', true)
    writeFileSync(join(dir, 'clash.txt'), 'b\n')
    await runGit({ cwd: dir, args: ['add', 'clash.txt'] })
    await runGit({ cwd: dir, args: ['commit', '-m', 'B'] })
    const result = await rebaseOnto(dir, 'side-a')
    expect(result.conflicts.length).toBeGreaterThan(0)
    await rebaseAbort(dir)
    const continueWouldFail = rebaseContinue(dir)
    await expect(continueWouldFail).rejects.toBeTruthy()
  }, 30000)

  it('lists apply pop and drop stashes', async () => {
    const dir = await initRepo()
    writeFileSync(join(dir, 'wip.txt'), 'wip\n')
    await stashSave(dir, 'my stash')
    let list = await listStashes(dir)
    expect(list.length).toBe(1)
    expect(list[0].message).toContain('my stash')
    await stashApply(dir, list[0].reflogSelector)
    list = await listStashes(dir)
    expect(list.length).toBe(1)
    await stashDrop(dir, list[0].reflogSelector)
    list = await listStashes(dir)
    expect(list.length).toBe(0)

    writeFileSync(join(dir, 'wip2.txt'), 'wip2\n')
    await stashSave(dir, 'second')
    list = await listStashes(dir)
    await stashPop(dir, list[0].reflogSelector)
    list = await listStashes(dir)
    expect(list.length).toBe(0)
  }, 30000)

  it('rejects stash before the first commit', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gm-ops-'))
    dirs.push(dir)
    await runGit({ cwd: dir, args: ['init'] })
    await runGit({ cwd: dir, args: ['config', 'user.email', 'test@example.com'] })
    await runGit({ cwd: dir, args: ['config', 'user.name', 'Test User'] })
    writeFileSync(join(dir, 'wip.txt'), 'wip\n')
    await expect(stashSave(dir)).rejects.toThrow(/first commit/i)
  }, 30000)

  it('amends the last commit message', async () => {
    const dir = await initRepo()
    const sha = await commit(dir, 'Amended subject', true)
    expect(sha).toBeTruthy()
    const page = await loadHistory({ repoPath: dir, limit: 5 })
    expect(page.commits[0].subject).toBe('Amended subject')
  }, 30000)
})
