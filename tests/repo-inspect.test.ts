import { mkdirSync, realpathSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { inspectRepository } from '../src/git-worker/operations'
import { initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

/** Compare real, long-form paths (macOS /var symlinks, Windows 8.3 short names, case). */
const canonical = (p: string): string => realpathSync.native(p).toLowerCase()

describe('inspectRepository', () => {
  it('tracks the repository root when a subfolder is chosen', async () => {
    const dir = await initRepo(tempDir('gm-inspect-'))
    mkdirSync(join(dir, 'src', 'deep'), { recursive: true })

    const repo = await inspectRepository(join(dir, 'src', 'deep'))
    expect(canonical(repo.path)).toBe(canonical(dir))
    expect(repo.currentBranch).toBe('main')
  }, 30000)

  it('rejects folders that are not inside a repository', async () => {
    await expect(inspectRepository(tempDir('gm-plain-'))).rejects.toThrow(/Not a git repository/)
  }, 30000)
})
