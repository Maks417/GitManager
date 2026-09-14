import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { GIT_NOT_FOUND_MESSAGE, runGit, runGitDelimited } from '../src/git-worker/git-runner'
import { getStatus } from '../src/git-worker/operations'

describe('git runner', () => {
  it('reports a missing repository folder instead of a missing Git install', async () => {
    const missing = join(tmpdir(), `gm-missing-repo-${Date.now()}`)
    const run = runGit({ cwd: missing, args: ['status'] })
    await expect(run).rejects.toThrow(/Repository folder not found/)
    await expect(run).rejects.not.toThrow(GIT_NOT_FOUND_MESSAGE)
    await expect(runGitDelimited({ cwd: missing, args: ['log'], delimiter: '\x1e' })).rejects.toThrow(
      /Repository folder not found/
    )
    await expect(getStatus(missing)).rejects.toThrow(/Repository folder not found/)
  })
})
