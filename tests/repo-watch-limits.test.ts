import { EventEmitter } from 'events'
import { mkdirSync, writeFileSync, type FSWatcher } from 'fs'
import { join, resolve } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWatchFingerprint } from '../src/git-worker/operations'
import {
  getRepoWatchState,
  isWatchLimitError,
  startRepoWatch,
  stopRepoWatch,
  subscribeRepoWatch,
  subscribeRepoWatchState,
  watchLimitReason,
  type RepoWatchEvent,
  type RepoWatchState,
  type WatchFunction
} from '../src/main/repo-watcher'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const REPO = resolve('/repos/limited')

const inotifyLimit = (): Error =>
  Object.assign(new Error('ENOSPC: System limit for number of file watchers reached, watch'), { code: 'ENOSPC' })
const tooManyFiles = (): Error => Object.assign(new Error('EMFILE: too many open files, watch'), { code: 'EMFILE' })

/** Stands in for an fs.FSWatcher that can report an error later. */
class FakeWatcher extends EventEmitter {
  closed = false
  close(): void {
    this.closed = true
  }
}

const refusing = (err: Error): WatchFunction => () => {
  throw err
}

function record(): { kinds: RepoWatchEvent['kind'][]; states: (RepoWatchState | null)[]; off: () => void } {
  const kinds: RepoWatchEvent['kind'][] = []
  const states: (RepoWatchState | null)[] = []
  const offEvents = subscribeRepoWatch((e) => kinds.push(e.kind))
  const offStates = subscribeRepoWatchState((s) => states.push(s))
  return {
    kinds,
    states,
    off: () => {
      offEvents()
      offStates()
    }
  }
}

afterEach(() => {
  stopRepoWatch()
})

describe('isWatchLimitError', () => {
  it('recognizes the inotify limit and too many open files, and nothing else', () => {
    expect(isWatchLimitError(inotifyLimit())).toBe(true)
    expect(isWatchLimitError(tooManyFiles())).toBe(true)
    expect(isWatchLimitError(new Error('ENOSPC: no space left on device'))).toBe(true)
    expect(isWatchLimitError(Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' }))).toBe(false)
  })
})

describe('watchLimitReason', () => {
  it('tells Linux users which limit to raise, and others what else to try', () => {
    expect(watchLimitReason(inotifyLimit(), 'linux')).toMatch(/fs\.inotify\.max_user_watches=524288/)
    const elsewhere = watchLimitReason(tooManyFiles(), 'darwin')
    expect(elsewhere).toMatch(/every 5 seconds/)
    expect(elsewhere).not.toMatch(/inotify/)
  })
})

describe('startRepoWatch when the system refuses watches', () => {
  it('polls instead, and reports a changed fingerprint as git-meta', async () => {
    const seen = record()
    let fingerprint = 'one'
    try {
      startRepoWatch(REPO, {
        watchFn: refusing(inotifyLimit()),
        pollFingerprint: async () => fingerprint,
        pollIntervalMs: 40
      })
      expect(getRepoWatchState()).toMatchObject({ repoPath: REPO, mode: 'polling', reason: expect.any(String) })
      await sleep(150)
      expect(seen.kinds).toEqual([])
      fingerprint = 'two'
      await vi.waitFor(() => expect(seen.kinds).toEqual(['git-meta']), { timeout: 2000, interval: 20 })
    } finally {
      seen.off()
    }
  })

  it('moves a running watch to polling when it reaches the limit later', () => {
    const watcher = new FakeWatcher()
    startRepoWatch(REPO, {
      watchFn: () => watcher as unknown as FSWatcher,
      pollFingerprint: async () => 'same',
      pollIntervalMs: 40
    })
    expect(getRepoWatchState()?.mode).toBe('live')
    watcher.emit('error', tooManyFiles())
    expect(watcher.closed).toBe(true)
    expect(getRepoWatchState()?.mode).toBe('polling')
  })

  it('checks nothing while polling is paused', async () => {
    const fingerprint = vi.fn(async () => 'x')
    startRepoWatch(REPO, {
      watchFn: refusing(inotifyLimit()),
      pollFingerprint: fingerprint,
      shouldPoll: () => false,
      pollIntervalMs: 20
    })
    await sleep(120)
    expect(fingerprint).not.toHaveBeenCalled()
  })

  it('still stops on other failures, and when it has no way to poll', () => {
    startRepoWatch(REPO, {
      watchFn: refusing(Object.assign(new Error('ENOENT'), { code: 'ENOENT' })),
      pollFingerprint: async () => 'x'
    })
    expect(getRepoWatchState()).toBeNull()
    startRepoWatch(REPO, { watchFn: refusing(inotifyLimit()) })
    expect(getRepoWatchState()).toBeNull()
  })

  it('announces a live watch, and clears the state when stopped', () => {
    const seen = record()
    try {
      startRepoWatch(REPO, { watchFn: () => new FakeWatcher() as unknown as FSWatcher })
      expect(seen.states.at(-1)).toEqual({ repoPath: REPO, mode: 'live', reason: null })
      stopRepoWatch()
      expect(seen.states.at(-1)).toBeNull()
    } finally {
      seen.off()
    }
  })
})

describe('getWatchFingerprint', () => {
  it('changes with edits, commits and new branches, and only then', async () => {
    const repo = await initRepo(tempDir('gm-fingerprint-'))
    const first = await getWatchFingerprint(repo)
    expect(await getWatchFingerprint(repo)).toBe(first)

    writeFileSync(join(repo, 'README.md'), '# repo\nedited\n')
    const edited = await getWatchFingerprint(repo)
    expect(edited).not.toBe(first)

    await git(repo, 'commit', '-q', '-am', 'edit')
    const committed = await getWatchFingerprint(repo)
    expect(committed).not.toBe(edited)

    await git(repo, 'branch', 'side')
    const branched = await getWatchFingerprint(repo)
    expect(branched).not.toBe(committed)

    // New files count one by one, like the Changes list: a second file in a new folder is a change too.
    mkdirSync(join(repo, 'shots'))
    writeFileSync(join(repo, 'shots', 'dark.png'), 'dark')
    const oneNewFile = await getWatchFingerprint(repo)
    expect(oneNewFile).not.toBe(branched)
    writeFileSync(join(repo, 'shots', 'light.png'), 'light')
    expect(await getWatchFingerprint(repo)).not.toBe(oneNewFile)
  }, 30000)
})
