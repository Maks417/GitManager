import { describe, expect, it } from 'vitest'
import { RepoSessionSnapshotSchema } from '../src/shared/ipc'
import { inspectRepository } from '../src/git-worker/ops/repo'
import { refreshRepoSession } from '../src/git-worker/ops/session-snapshot'
import { git, initRepo, mergeWithConflicts, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('refreshRepoSession', () => {
  it('refreshes remotes even when a cached repository is supplied', async () => {
    const dir = await initRepo(tempDir('gm-session-snapshot-'))
    const cached = await inspectRepository(dir)
    expect(cached.remotes).toEqual([])

    await git(dir, 'remote', 'add', 'origin', 'https://example.test/first.git')
    const first = RepoSessionSnapshotSchema.parse(
      await refreshRepoSession({
        repoPath: dir,
        scope: 'meta',
        persistRepository: false,
        baseRepository: cached
      })
    )
    expect(first.repository?.remotes).toEqual([
      { name: 'origin', url: 'https://example.test/first.git' }
    ])

    await git(dir, 'remote', 'set-url', 'origin', 'https://example.test/second.git')
    const second = await refreshRepoSession({
      repoPath: dir,
      scope: 'meta',
      persistRepository: false,
      baseRepository: first.repository
    })
    expect(second.repository?.remotes).toEqual([
      { name: 'origin', url: 'https://example.test/second.git' }
    ])
  })
})

describe('refreshRepoSession meta state', () => {
  it('reports a merge in progress, and the unborn branch of a new repository', async () => {
    const dir = await initRepo(tempDir('gm-session-merge-'))
    await mergeWithConflicts(dir, { base: { 'a.txt': 'base\n' }, theirs: { 'a.txt': 'theirs\n' }, ours: { 'a.txt': 'ours\n' } })
    const merging = await refreshRepoSession({ repoPath: dir, scope: 'meta', persistRepository: false })
    expect(merging.mergeInProgress).toBe(true)
    expect(merging.rebaseInProgress).toBe(false)
    expect(merging.sequencerOp).toBeNull()
    expect(merging.repository?.worktreeOf).toBeNull()

    const empty = await initRepo(tempDir('gm-session-unborn-'), { initialCommit: false })
    const unborn = await refreshRepoSession({ repoPath: empty, scope: 'meta', persistRepository: false })
    expect(unborn.repository?.currentBranch).toBe('main')
    expect(unborn.headSha).toBeNull()
  }, 30000)
})
