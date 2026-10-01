import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  forcePushRemote,
  isMergeInProgress,
  isRebaseInProgress,
  listConflictFiles,
  mergeAbort,
  pushRemote,
  rebaseOnto,
  rebaseSkip
} from '../src/git-worker/operations'
import { repoNameFromUrl } from '../src/main/clone-target'
import { git, initRepo, mergeWithConflicts, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

/** A bare "remote" plus a clone of it with an identity configured. */
async function cloneOfBare(): Promise<{ bare: string; clone: (name: string) => Promise<string> }> {
  const bare = tempDir('gm-bare-')
  await git(bare, 'init', '--bare', '-b', 'main')
  const seed = await initRepo(tempDir('gm-seed-'))
  await git(seed, 'remote', 'add', 'origin', bare)
  await git(seed, 'push', '-q', 'origin', 'main')
  return {
    bare,
    clone: async (name) => {
      const dir = join(tempDir(`gm-${name}-`), 'repo')
      await git(bare, 'clone', '-q', bare, dir)
      await git(dir, 'config', 'user.email', `${name}@example.com`)
      await git(dir, 'config', 'user.name', name)
      return dir
    }
  }
}

describe('merge state', () => {
  it('detects and aborts a conflicted merge', async () => {
    const dir = await initRepo(tempDir('gm-merge-state-'), { initialCommit: false })
    await mergeWithConflicts(dir, {
      base: { 'a.txt': 'base\n' },
      theirs: { 'a.txt': 'theirs\n' },
      ours: { 'a.txt': 'ours\n' }
    })
    expect(await isMergeInProgress(dir)).toBe(true)

    await mergeAbort(dir)
    expect(await isMergeInProgress(dir)).toBe(false)
    expect(await listConflictFiles(dir)).toEqual([])
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('ours\n')
  }, 30000)
})

describe('rebase skip', () => {
  it('skips the commit a rebase stopped on and finishes', async () => {
    const dir = await initRepo(tempDir('gm-skip-'))
    await git(dir, 'checkout', '-q', '-b', 'topic')
    writeFileSync(join(dir, 'README.md'), 'topic\n')
    await git(dir, 'commit', '-qam', 'topic change')
    await git(dir, 'checkout', '-q', 'main')
    writeFileSync(join(dir, 'README.md'), 'main\n')
    await git(dir, 'commit', '-qam', 'main change')
    await git(dir, 'checkout', '-q', 'topic')

    expect((await rebaseOnto(dir, 'main')).conflicts).toEqual(['README.md'])
    expect(await rebaseSkip(dir)).toEqual({ conflicts: [] })
    expect(await isRebaseInProgress(dir)).toBe(false)
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toBe('main\n')
  }, 30000)
})

describe('push', () => {
  it('publishes a new branch and sets its upstream', async () => {
    const { clone } = await cloneOfBare()
    const dir = await clone('alice')
    await git(dir, 'checkout', '-q', '-b', 'feature/login')
    await git(dir, 'commit', '-q', '--allow-empty', '-m', 'work')

    await pushRemote(dir)
    expect((await git(dir, 'rev-parse', '--abbrev-ref', 'feature/login@{upstream}')).trim()).toBe(
      'origin/feature/login'
    )
  }, 60000)

  it('reports a rejected non-fast-forward push', async () => {
    const { clone } = await cloneOfBare()
    const alice = await clone('alice')
    const bob = await clone('bob')
    await git(alice, 'commit', '-q', '--allow-empty', '-m', 'alice')
    await pushRemote(alice)
    await git(bob, 'commit', '-q', '--allow-empty', '-m', 'bob')

    expect(await pushRemote(bob)).toEqual({ outcome: 'rejected', branch: 'main' })
  }, 60000)

  it('force-pushes a rewritten branch with a lease', async () => {
    const { bare, clone } = await cloneOfBare()
    const bob = await clone('bob')
    await git(bob, 'commit', '-q', '--allow-empty', '-m', 'bob')
    await pushRemote(bob)
    await git(bob, 'commit', '-q', '--amend', '--allow-empty', '-m', 'bob, reworded')

    expect(await pushRemote(bob)).toEqual({ outcome: 'rejected', branch: 'main' })
    expect(await forcePushRemote(bob)).toEqual({ outcome: 'done' })
    expect((await git(bare, 'log', '-1', '--format=%s', 'main')).trim()).toBe('bob, reworded')
  }, 60000)

  it('refuses a force push over commits it has not fetched', async () => {
    const { bare, clone } = await cloneOfBare()
    const alice = await clone('alice')
    const bob = await clone('bob')
    await git(alice, 'commit', '-q', '--allow-empty', '-m', 'alice')
    await pushRemote(alice)
    await git(bob, 'commit', '-q', '--allow-empty', '-m', 'bob')

    expect(await pushRemote(bob)).toEqual({ outcome: 'rejected', branch: 'main' })
    await expect(forcePushRemote(bob)).rejects.toThrow(/Force push stopped/)
    expect((await git(bare, 'log', '-1', '--format=%s', 'main')).trim()).toBe('alice')
  }, 60000)

  it('refuses to push a detached HEAD', async () => {
    const { clone } = await cloneOfBare()
    const dir = await clone('carol')
    await git(dir, 'checkout', '-q', '--detach')
    await expect(pushRemote(dir)).rejects.toThrow(/detached/)
  }, 60000)
})

describe('repoNameFromUrl', () => {
  it('derives the folder name Git would use', () => {
    expect(repoNameFromUrl('https://github.com/org/repo.git')).toBe('repo')
    expect(repoNameFromUrl('https://github.com/org/repo.git/')).toBe('repo')
    expect(repoNameFromUrl('git@github.com:org/repo.git')).toBe('repo')
    expect(repoNameFromUrl('git@host:repo.git')).toBe('repo')
    expect(repoNameFromUrl('C:\\src\\project\\')).toBe('project')
    expect(repoNameFromUrl('https://example.com/')).toBe('example.com')
    expect(repoNameFromUrl('')).toBe('repo')
  })
})
