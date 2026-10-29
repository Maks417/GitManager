import { describe, expect, it } from 'vitest'
import { readRefs } from '../src/git-worker/ops/branches'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('readRefs', () => {
  it('lists branches, remote-style upstreams and keeps ahead/behind right as refs move', async () => {
    const dir = await initRepo(tempDir('gm-refs-'))
    await git(dir, 'branch', 'base')
    await git(dir, 'checkout', '-q', '-b', 'feature')
    await git(dir, 'branch', '--set-upstream-to=base')
    await git(dir, 'commit', '-q', '--allow-empty', '-m', 'one')

    const first = await readRefs(dir)
    expect(first.branches.find((b) => b.name === 'feature')).toMatchObject({
      current: true,
      upstream: 'base',
      ahead: 1,
      behind: 0
    })

    // Unchanged refs: same answer, same fingerprint (served from the cache).
    const again = await readRefs(dir)
    expect(again.fingerprint).toBe(first.fingerprint)
    expect(again.branches).toEqual(first.branches)

    await git(dir, 'commit', '-q', '--allow-empty', '-m', 'two')
    await git(dir, 'tag', 'v1')
    const moved = await readRefs(dir)
    expect(moved.branches.find((b) => b.name === 'feature')).toMatchObject({ ahead: 2, behind: 0 })
    expect(moved.fingerprint).not.toBe(first.fingerprint)

    // The upstream gone: no counts, but the configured upstream is still named.
    await git(dir, 'branch', '-D', 'base')
    const gone = await readRefs(dir)
    expect(gone.branches.find((b) => b.name === 'feature')).toMatchObject({ upstream: 'base', ahead: 0, behind: 0 })
    expect(gone.remoteBranches).toEqual([])
  }, 30000)
})
