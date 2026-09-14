import { writeFileSync } from 'fs'
import { createServer, type AddressInfo, type Socket } from 'net'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { fetchRemote, pullRemote, pushRemote } from '../src/git-worker/operations'
import {
  createLineSplitter,
  isProgressNoise,
  parseGitProgressLine,
  throttleProgress
} from '../src/git-worker/progress'
import { git, initRepo, trackTempDirs } from './helpers/git-fixture'

const tempDir = trackTempDirs()

describe('parseGitProgressLine', () => {
  // Samples captured from Git 2.53 `clone`, `fetch` and `push` with --progress.
  it('reads percentages and counts from local and remote progress lines', () => {
    expect(parseGitProgressLine('Receiving objects:  58% (176/302), 532.00 KiB | 1.00 MiB/s')).toEqual({
      phase: 'Receiving objects',
      percent: 58,
      remote: false
    })
    expect(parseGitProgressLine('remote: Counting objects:  45% (136/302)        ')).toEqual({
      phase: 'Counting objects',
      percent: 45,
      remote: true
    })
    expect(parseGitProgressLine('remote: Enumerating objects: 302, done.        ')).toEqual({
      phase: 'Enumerating objects',
      percent: null,
      remote: true
    })
    expect(parseGitProgressLine('Writing objects: 100% (3/3), 197.52 KiB | 5.20 MiB/s, done.')).toEqual({
      phase: 'Writing objects',
      percent: 100,
      remote: false
    })
  })

  it('does not mistake errors or ref updates for progress', () => {
    expect(parseGitProgressLine("fatal: unable to access 'http://127.0.0.1:9/nothing.git/': Operation too slow")).toBeNull()
    expect(parseGitProgressLine(' ! [rejected]        main -> main (fetch first)')).toBeNull()
    expect(parseGitProgressLine('   b90a68b..ec19a60  main       -> origin/main')).toBeNull()
  })

  it('treats transfer summaries as noise but keeps messages', () => {
    expect(isProgressNoise('remote: Total 302 (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)        ')).toBe(true)
    expect(isProgressNoise('Delta compression using up to 12 threads')).toBe(true)
    expect(isProgressNoise('error: failed to push some refs')).toBe(false)
  })
})

describe('createLineSplitter', () => {
  it('splits redrawn progress at carriage returns, also across chunks', () => {
    const lines: string[] = []
    const splitter = createLineSplitter((line) => lines.push(line))
    splitter.write('Receiving objects:  1% (1/3)\rReceiving obj')
    splitter.write('ects:  2% (2/3)\rdone\nFrom x')
    splitter.end()
    expect(lines).toEqual(['Receiving objects:  1% (1/3)', 'Receiving objects:  2% (2/3)', 'done', 'From x'])
  })
})

describe('throttleProgress', () => {
  it('forwards new phases and completion at once and thins out the rest', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000)
      const seen: string[] = []
      const report = throttleProgress<{ phase: string; percent: number | null }>(
        (u) => seen.push(`${u.phase} ${u.percent}`),
        100
      )
      report({ phase: 'Counting objects', percent: 1 })
      report({ phase: 'Counting objects', percent: 2 })
      vi.setSystemTime(1150)
      report({ phase: 'Counting objects', percent: 3 })
      report({ phase: 'Counting objects', percent: 100 })
      report({ phase: 'Receiving objects', percent: 0 })
      expect(seen).toEqual(['Counting objects 1', 'Counting objects 3', 'Counting objects 100', 'Receiving objects 0'])
    } finally {
      vi.useRealTimers()
    }
  })
})

/** A bare remote with some history, a clone to operate on, and a second clone that publishes commits. */
async function remoteWithClones(): Promise<{ clone: string; publish: (subject: string) => Promise<void> }> {
  const seed = await initRepo(tempDir('gm-net-seed-'))
  for (let i = 0; i < 30; i++) writeFileSync(join(seed, `file${i}.txt`), `${'content '.repeat(200)}${i}\n`)
  await git(seed, 'add', '.')
  await git(seed, 'commit', '-q', '-m', 'content')
  const bare = join(tempDir('gm-net-bare-'), 'origin.git')
  await git(seed, 'clone', '-q', '--bare', seed, bare)
  const url = pathToFileURL(bare).href

  const cloneOf = async (name: string): Promise<string> => {
    const dir = join(tempDir(`gm-net-${name}-`), 'repo')
    await git(seed, 'clone', '-q', url, dir)
    await git(dir, 'config', 'user.email', `${name}@example.com`)
    await git(dir, 'config', 'user.name', name)
    return dir
  }
  const clone = await cloneOf('clone')
  const other = await cloneOf('other')
  return {
    clone,
    publish: async (subject) => {
      for (let i = 0; i < 20; i++) writeFileSync(join(other, `${subject.replace(/\W+/g, '-')}-${i}.txt`), `${'more '.repeat(300)}${i}\n`)
      await git(other, 'add', '.')
      await git(other, 'commit', '-q', '-m', subject)
      await git(other, 'push', '-q', 'origin', 'HEAD')
    }
  }
}

describe('fetchRemote', () => {
  it('reports progress and finishes', async () => {
    const { clone, publish } = await remoteWithClones()
    await publish('from other')
    const phases = new Set<string>()
    expect(await fetchRemote(clone, { onProgress: (p) => phases.add(p.phase) })).toEqual({ outcome: 'done' })
    expect([...phases].some((phase) => /objects/.test(phase))).toBe(true)
    expect((await git(clone, 'log', '-1', '--format=%s', 'origin/main')).trim()).toBe('from other')
  }, 60000)
})

describe('pullRemote', () => {
  it('fast-forwards to the upstream and reports the local update as not cancellable', async () => {
    const { clone, publish } = await remoteWithClones()
    await publish('from other')
    const cancellable: boolean[] = []
    expect(await pullRemote(clone, { onProgress: (p) => cancellable.push(p.cancellable) })).toEqual({ outcome: 'done' })
    expect((await git(clone, 'log', '-1', '--format=%s')).trim()).toBe('from other')
    expect(cancellable).toContain(false)
  }, 60000)

  it('explains a branch without an upstream', async () => {
    const repo = await initRepo(tempDir('gm-net-noupstream-'))
    await expect(pullRemote(repo)).rejects.toThrow(/no upstream/)
  }, 30000)

  it('explains diverged branches', async () => {
    const { clone, publish } = await remoteWithClones()
    await publish('from other')
    await git(clone, 'commit', '-q', '--allow-empty', '-m', 'local work')
    await expect(pullRemote(clone)).rejects.toThrow(/diverged/)
  }, 60000)
})

describe('pushRemote', () => {
  it('publishes a commit made after a pull, with progress', async () => {
    const { clone, publish } = await remoteWithClones()
    await publish('from other')
    expect(await pullRemote(clone, { onProgress: () => undefined })).toEqual({ outcome: 'done' })
    writeFileSync(join(clone, 'README.md'), '# repo\nlocal edit\n')
    await git(clone, 'commit', '-q', '-am', 'local change')

    expect(await pushRemote(clone, { onProgress: () => undefined })).toEqual({ outcome: 'done' })
    const [remoteTip] = (await git(clone, 'ls-remote', 'origin', 'refs/heads/main')).trim().split(/\s+/)
    expect(remoteTip).toBe((await git(clone, 'rev-parse', 'HEAD')).trim())
  }, 60000)
})

/** A server that accepts connections and never answers, like a stalled network. */
async function stallingServer(): Promise<{ url: string; connections: () => number; closed: () => number; stop: () => Promise<void> }> {
  const sockets: Socket[] = []
  let closed = 0
  const server = createServer((socket) => {
    sockets.push(socket)
    socket.on('close', () => closed++)
    socket.on('error', () => undefined)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/stalled.git`,
    connections: () => sockets.length,
    closed: () => closed,
    stop: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy()
        server.close(() => resolve())
      })
  }
}

describe('stalled network', () => {
  const proxyEnv = { NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy }
  beforeAll(() => {
    process.env.NO_PROXY = '127.0.0.1,localhost'
    process.env.no_proxy = '127.0.0.1,localhost'
  })
  afterAll(() => {
    process.env.NO_PROXY = proxyEnv.NO_PROXY
    process.env.no_proxy = proxyEnv.no_proxy
    if (proxyEnv.NO_PROXY === undefined) delete process.env.NO_PROXY
    if (proxyEnv.no_proxy === undefined) delete process.env.no_proxy
  })

  it('stops a fetch that gets no response within the idle timeout', async () => {
    const server = await stallingServer()
    try {
      const repo = await initRepo(tempDir('gm-net-stall-'))
      await git(repo, 'remote', 'add', 'origin', server.url)
      await expect(fetchRemote(repo, { idleTimeoutMs: 1500 })).rejects.toThrow(/stopped responding/)
      await vi.waitFor(() => expect(server.closed()).toBeGreaterThan(0), { timeout: 10000, interval: 100 })
    } finally {
      await server.stop()
    }
  }, 30000)

  it('cancels a fetch and stops the helper process that holds the connection', async () => {
    const server = await stallingServer()
    try {
      const repo = await initRepo(tempDir('gm-net-cancel-'))
      await git(repo, 'remote', 'add', 'origin', server.url)
      const controller = new AbortController()
      const run = fetchRemote(repo, { signal: controller.signal })
      await vi.waitFor(() => expect(server.connections()).toBeGreaterThan(0), { timeout: 10000, interval: 100 })
      controller.abort()
      await expect(run).resolves.toEqual({ outcome: 'cancelled' })
      // git-remote-http owns the socket: it closes only if the whole process tree was stopped.
      await vi.waitFor(() => expect(server.closed()).toBeGreaterThan(0), { timeout: 10000, interval: 100 })
    } finally {
      await server.stop()
    }
  }, 30000)
})
