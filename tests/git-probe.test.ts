import { afterEach, describe, expect, it } from 'vitest'
import { writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  GIT_NOT_FOUND_MESSAGE,
  gitNotFoundMessage,
  probeGit,
  runGit
} from '../src/git-worker/git-runner'

describe('git probe / missing binary', () => {
  const prevPath = process.env.GIT_MANAGER_GIT_PATH
  let fakeBinary: string | null = null

  afterEach(() => {
    if (prevPath === undefined) delete process.env.GIT_MANAGER_GIT_PATH
    else process.env.GIT_MANAGER_GIT_PATH = prevPath
    if (fakeBinary) {
      try {
        unlinkSync(fakeBinary)
      } catch {
        /* ignore */
      }
      fakeBinary = null
    }
  })

  it('returns a friendly install message when the configured Git binary cannot spawn', async () => {
    fakeBinary = join(tmpdir(), `git-manager-fake-git-${Date.now()}.bin`)
    writeFileSync(fakeBinary, '')
    process.env.GIT_MANAGER_GIT_PATH = fakeBinary

    const probe = await probeGit()
    expect(probe.available).toBe(false)
    expect(probe.version).toBeNull()
    expect(probe.message).toBe(gitNotFoundMessage())
    expect(probe.message).toContain('git-scm.com/downloads')
  })

  it('maps spawn ENOENT to the install message from runGit', async () => {
    process.env.GIT_MANAGER_GIT_PATH = join(tmpdir(), `git-manager-missing-${Date.now()}`, 'git.exe')

    await expect(runGit({ cwd: tmpdir(), args: ['--version'], timeoutMs: 5_000 })).rejects.toThrow(
      GIT_NOT_FOUND_MESSAGE
    )
  })

  it('maps unusable configured binary spawn errors to the install message', async () => {
    fakeBinary = join(tmpdir(), `git-manager-fake-git-${Date.now()}.bin`)
    writeFileSync(fakeBinary, '')
    process.env.GIT_MANAGER_GIT_PATH = fakeBinary

    await expect(runGit({ cwd: tmpdir(), args: ['--version'], timeoutMs: 5_000 })).rejects.toThrow(
      GIT_NOT_FOUND_MESSAGE
    )
  })

  it('reports available when system Git responds to --version', async () => {
    delete process.env.GIT_MANAGER_GIT_PATH
    const probe = await probeGit()
    // CI and local machines running this suite have Git installed.
    expect(probe.available).toBe(true)
    expect(probe.version).toBeTruthy()
    expect(probe.message).toBeNull()
  })
})
