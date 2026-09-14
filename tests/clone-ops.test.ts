import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cloneRepository } from '../src/git-worker/operations'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'
import { bypassProxyForLocalhost, stallingServer } from './helpers/stalling-server'

const tempDir = trackTempDirs()

/** A bare repository with enough content for Git to report transfer progress. */
async function bareRemote(): Promise<string> {
  const seed = await initRepo(tempDir('gm-clone-seed-'))
  for (let i = 0; i < 30; i++) writeFileSync(join(seed, `file${i}.txt`), `${'content '.repeat(200)}${i}\n`)
  await git(seed, 'add', '.')
  await git(seed, 'commit', '-q', '-m', 'content')
  const bare = join(tempDir('gm-clone-bare-'), 'origin.git')
  await git(seed, 'clone', '-q', '--bare', seed, bare)
  return pathToFileURL(bare).href
}

describe('cloneRepository', () => {
  it('clones with progress and returns the new repository', async () => {
    const url = await bareRemote()
    const target = join(tempDir('gm-clone-into-'), 'origin')
    const phases = new Set<string>()
    const result = await cloneRepository(url, target, { onProgress: (p) => phases.add(p.phase) })
    expect(result.outcome).toBe('done')
    if (result.outcome !== 'done') return
    expect(result.repo.path).toBe(target)
    expect(result.repo.currentBranch).toBe('main')
    expect([...phases].some((phase) => /objects/.test(phase))).toBe(true)
  }, 60000)

  it('refuses a folder that is not empty, before connecting', async () => {
    const target = join(tempDir('gm-clone-full-'), 'repo')
    mkdirSync(target)
    writeFileSync(join(target, 'keep.txt'), 'mine\n')
    await expect(cloneRepository('https://example.invalid/repo.git', target)).rejects.toThrow(/not an empty folder/)
    expect(readdirSync(target)).toEqual(['keep.txt'])
  })

  it('removes the folder of a clone that fails, and keeps the error readable', async () => {
    const parent = tempDir('gm-clone-fail-')
    const target = join(parent, 'missing')
    const failure = cloneRepository(pathToFileURL(join(parent, 'nothing.git')).href, target)
    await expect(failure).rejects.toThrow(/does not appear to be a git repository|not found|No such/i)
    await expect(failure).rejects.not.toThrow(/^Cloning into/)
    expect(existsSync(target)).toBe(false)
  }, 30000)
})

describe('cloneRepository over a stalled network', () => {
  bypassProxyForLocalhost({ beforeAll, afterAll })

  it('cancels, stops the helper that holds the connection, and removes the folder', async () => {
    const server = await stallingServer()
    try {
      const target = join(tempDir('gm-clone-cancel-'), 'stalled')
      const controller = new AbortController()
      const run = cloneRepository(server.url, target, { signal: controller.signal })
      await vi.waitFor(() => expect(server.connections()).toBeGreaterThan(0), { timeout: 10000, interval: 100 })
      controller.abort()
      await expect(run).resolves.toEqual({ outcome: 'cancelled' })
      expect(existsSync(target)).toBe(false)
      // git-remote-http owns the socket: it closes only if the whole process tree was stopped.
      await vi.waitFor(() => expect(server.closed()).toBeGreaterThan(0), { timeout: 10000, interval: 100 })
    } finally {
      await server.stop()
    }
  }, 30000)

  it('empties a chosen empty folder again after the idle timeout, and keeps the folder', async () => {
    const server = await stallingServer()
    try {
      const target = join(tempDir('gm-clone-empty-'), 'chosen')
      mkdirSync(target)
      await expect(cloneRepository(server.url, target, { idleTimeoutMs: 1500 })).rejects.toThrow(/stopped responding/)
      expect(existsSync(target)).toBe(true)
      expect(readdirSync(target)).toEqual([])
      await vi.waitFor(() => expect(server.closed()).toBeGreaterThan(0), { timeout: 10000, interval: 100 })
    } finally {
      await server.stop()
    }
  }, 30000)
})
