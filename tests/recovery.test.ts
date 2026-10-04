import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { commit, deleteBranch, getRecoveryEntries, loadHistory, resetToCommit, restoreRecovery, restoreWorktree, deleteRecovery } from '../src/git-worker/operations'
import { git, initRepo, mergeWithConflicts, trackTempDirs } from './helpers/git-fixture'

const temp = trackTempDirs()

describe('saved recovery backups', () => {
  it('hides saved recovery refs from branch decorations even when their commit is still reachable', async () => {
    const repo = await initRepo(temp('gm-recovery-decoration-'))
    const head = (await git(repo, 'rev-parse', 'HEAD')).trim()
    await resetToCommit(repo, head, 'soft')
    expect((await getRecoveryEntries(repo)).some((entry) => entry.saved && entry.sha === head)).toBe(true)
    const history = await loadHistory({ repoPath: repo, limit: 200 })
    expect(history.commits).toHaveLength(1)
    expect(history.commits[0].refs.every((ref) => !ref.name.startsWith('refs/git-manager/'))).toBe(true)
  })

  it('restores the exact index and tracked edits after hard reset without touching the stash list', async () => {
    const repo = await initRepo(temp('gm-recovery-reset-'))
    const base = (await git(repo, 'rev-parse', 'HEAD')).trim()
    writeFileSync(join(repo, 'README.md'), 'next commit\n')
    await git(repo, 'commit', '-am', 'next')
    const head = (await git(repo, 'rev-parse', 'HEAD')).trim()
    writeFileSync(join(repo, 'README.md'), 'staged\n')
    await git(repo, 'add', 'README.md')
    writeFileSync(join(repo, 'README.md'), 'unstaged\n')
    const index = await git(repo, 'diff', '--cached')
    const worktree = await git(repo, 'diff')
    await resetToCommit(repo, base, 'hard')
    const entries = await getRecoveryEntries(repo)
    expect(entries.some((entry) => entry.saved && entry.kind === 'commit' && entry.sha === head)).toBe(true)
    const backup = entries.find((entry) => entry.kind === 'worktree')!
    expect(backup).toBeDefined()
    expect((await git(repo, 'stash', 'list')).trim()).toBe('')
    // Restore on its original commit, just as a user can recover that commit to a branch.
    await git(repo, 'checkout', '-b', 'recovered', head)
    await restoreRecovery(repo, backup.id)
    expect(await git(repo, 'diff', '--cached')).toBe(index)
    expect(await git(repo, 'diff')).toBe(worktree)
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('unstaged\n')
    await expect(restoreRecovery(repo, backup.id)).rejects.toThrow(/Commit or stash/)
    await deleteRecovery(repo, backup.id)
    expect((await getRecoveryEntries(repo)).some((entry) => entry.id === backup.id)).toBe(false)
    await expect(deleteRecovery(repo, 'refs/heads/main')).rejects.toThrow(/not a Git Manager/)
  }, 30000)

  it('backs up discarded tracked files and keeps snapshots out of normal history', async () => {
    const repo = await initRepo(temp('gm-recovery-discard-'))
    writeFileSync(join(repo, 'README.md'), 'keep my edits\n')
    await restoreWorktree(repo, ['README.md'])
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('# repo\n')
    const backup = (await getRecoveryEntries(repo)).find((entry) => entry.kind === 'worktree')!
    expect(backup).toBeDefined()
    const history = await loadHistory({ repoPath: repo, limit: 200 })
    expect(history.commits).toHaveLength(1)
    await restoreRecovery(repo, backup.id)
    expect(readFileSync(join(repo, 'README.md'), 'utf8')).toBe('keep my edits\n')
  })

  it('preserves amended commits and deleted branches even when no normal ref reaches them', async () => {
    const repo = await initRepo(temp('gm-recovery-commits-'))
    const oldHead = (await git(repo, 'rev-parse', 'HEAD')).trim()
    await commit(repo, 'replacement', true)
    expect((await getRecoveryEntries(repo)).some((entry) => entry.saved && entry.sha === oldHead)).toBe(true)
    await git(repo, 'checkout', '-b', 'temporary')
    writeFileSync(join(repo, 'branch.txt'), 'branch\n')
    await git(repo, 'add', '.')
    await git(repo, 'commit', '-m', 'branch commit')
    const tip = (await git(repo, 'rev-parse', 'HEAD')).trim()
    await git(repo, 'checkout', 'main')
    await deleteBranch(repo, 'temporary', true)
    expect((await getRecoveryEntries(repo)).some((entry) => entry.saved && entry.sha === tip && /temporary/.test(entry.label))).toBe(true)
    const history = await loadHistory({ repoPath: repo, limit: 200 })
    expect(history.commits.some((entry) => entry.sha === tip || entry.sha === oldHead)).toBe(false)
    const inspected = await loadHistory({ repoPath: repo, search: tip, limit: 200 })
    expect(inspected.commits.map((entry) => entry.sha)).toEqual([tip])
  }, 30000)

  it('preserves tracked content and ordinary staged changes while discarding during a conflict', async () => {
    const repo = await initRepo(temp('gm-recovery-conflict-'), { initialCommit: false })
    await mergeWithConflicts(repo, {
      base: { 'clash.txt': 'base\n', 'tracked.txt': 'original\n', 'staged.txt': 'original\n' },
      theirs: { 'clash.txt': 'theirs\n' },
      ours: { 'clash.txt': 'ours\n' }
    })
    writeFileSync(join(repo, 'staged.txt'), 'staged change\n')
    await git(repo, 'add', 'staged.txt')
    writeFileSync(join(repo, 'tracked.txt'), 'discarded change\n')
    const markers = readFileSync(join(repo, 'clash.txt'), 'utf8')
    const stages = await git(repo, 'ls-files', '--stage', '-z')
    await restoreWorktree(repo, ['tracked.txt'])
    expect(await git(repo, 'ls-files', '--stage', '-z')).toBe(stages)
    expect(readFileSync(join(repo, 'clash.txt'), 'utf8')).toBe(markers)
    expect(readFileSync(join(repo, 'tracked.txt'), 'utf8')).toBe('original\n')
    const backup = (await getRecoveryEntries(repo)).find((entry) => entry.kind === 'worktree')!
    expect(backup.label).toMatch(/unresolved index stages excluded/)
    await expect(restoreRecovery(repo, backup.id)).rejects.toThrow(/Finish or abort/)
    await git(repo, 'reset', '--hard', 'HEAD')
    await restoreRecovery(repo, backup.id)
    expect(readFileSync(join(repo, 'clash.txt'), 'utf8')).toBe(markers)
    expect(readFileSync(join(repo, 'tracked.txt'), 'utf8')).toBe('discarded change\n')
    expect((await git(repo, 'diff', '--cached', '--name-only')).trim()).toBe('staged.txt')
    expect((await git(repo, 'ls-files', '-u')).trim()).toBe('')
    expect((await git(repo, 'stash', 'list')).trim()).toBe('')
  }, 30000)

  it('blocks tracked-file discard before the first commit when a backup cannot be saved', async () => {
    const repo = await initRepo(temp('gm-recovery-unborn-'), { initialCommit: false })
    writeFileSync(join(repo, 'new.txt'), 'staged\n')
    await git(repo, 'add', 'new.txt')
    writeFileSync(join(repo, 'new.txt'), 'unsaved\n')
    await expect(restoreWorktree(repo, ['new.txt'])).rejects.toThrow(/Create the first commit/)
    expect(readFileSync(join(repo, 'new.txt'), 'utf8')).toBe('unsaved\n')
  })
})
