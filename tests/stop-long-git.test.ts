import { existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { GitCancelledError, runGit } from '../src/git-worker/git-runner'
import { limitFileList, loadHistory } from '../src/git-worker/ops/history'
import { stopLongGit } from '../src/git-worker/ops/stop-long'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('stopLongGit', () => {
  it('stops a commit stuck in a hook and removes the index lock it left', async () => {
    const dir = await initRepo(tempDir('gm-stop-'))
    // Executable: Git skips a hook without the bit on Linux and macOS, and the commit would finish at once.
    writeFileSync(join(dir, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nsleep 60\n', { mode: 0o755 })
    writeFileSync(join(dir, 'README.md'), '# changed\n')

    // `commit -a` locks the index before its hooks run.
    const commit = runGit({ cwd: dir, args: ['commit', '-a', '-m', 'stuck'] })
    const outcome = commit.then(
      () => 'finished',
      (err: unknown) => (err instanceof GitCancelledError ? 'cancelled' : String(err))
    )
    try {
      // Quick commands are left alone: nothing has run for long yet.
      expect(await stopLongGit(dir)).toEqual({ stopped: false, removedLock: false })
      await new Promise((resolve) => setTimeout(resolve, 5500))
      expect(existsSync(join(dir, '.git', 'index.lock'))).toBe(true)

      const result = await stopLongGit(dir)
      expect(result.stopped).toBe(true)
      expect(await outcome).toBe('cancelled')
      expect(result.removedLock).toBe(true)
      expect(existsSync(join(dir, '.git', 'index.lock'))).toBe(false)
      // The repository works again.
      await git(dir, 'status')
    } finally {
      await stopLongGit(dir)
      await outcome
    }
  }, 40000)
})

describe('limitFileList', () => {
  it('says how many files were left out, only when some were', () => {
    expect(limitFileList([1, 2], 3)).toEqual({ files: [1, 2] })
    expect(limitFileList([1, 2, 3, 4], 3)).toEqual({ files: [1, 2, 3], omittedFiles: 1 })
  })
})

describe('commit message encoding', () => {
  it('reads messages as UTF-8 even with a legacy i18n.logOutputEncoding', async () => {
    const dir = await initRepo(tempDir('gm-enc-'))
    await git(dir, 'commit', '--allow-empty', '-m', 'Привет, café')
    await git(dir, 'config', 'i18n.logOutputEncoding', 'ISO-8859-1')
    const page = await loadHistory({ repoPath: dir, limit: 5 })
    expect(page.commits[0].subject).toBe('Привет, café')
  }, 30000)
})
