import { describe, expect, it } from 'vitest'
import {
  createRepoScheduler,
  extractRepoPath,
  GIT_METHOD_META,
  GitCancelledError
} from '../src/git-worker/repo-scheduler'
import { GitCancelledError as RunnerGitCancelledError } from '../src/git-worker/git-runner'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createRepoScheduler', () => {
  it('extracts repository paths for clone and enclosing-worktree operations', () => {
    expect(extractRepoPath('cloneRepository', ['https://example.test/repo.git', 'C:/target'])).toBe(
      'C:/target'
    )
    expect(extractRepoPath('getEnclosingWorkTree', ['C:/repo/subdir'])).toBe('C:/repo/subdir')
    expect(GIT_METHOD_META.getEnclosingWorkTree.repoArgIndex).toBe(0)
  })

  it('uses the git runner cancellation type for queued work', () => {
    expect(GitCancelledError).toBe(RunnerGitCancelledError)
  })

  it('limits concurrent reads per repository', async () => {
    const scheduler = createRepoScheduler({ readConcurrency: 2 })
    let active = 0
    let maxActive = 0
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()]

    const jobs = gates.map((gate, index) =>
      scheduler.schedule('getStatus', ['C:/repo'], async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await gate.promise
        active--
        return index
      })
    )

    await flush()
    expect(maxActive).toBe(2)
    gates[0].resolve()
    gates[1].resolve()
    gates[2].resolve()
    await Promise.all(jobs)
    expect(maxActive).toBe(2)
  })

  it('runs mutations exclusively and ahead of background reads', async () => {
    const scheduler = createRepoScheduler({ readConcurrency: 2 })
    const order: string[] = []
    const mutateGate = deferred<void>()

    const mutate = scheduler.schedule('commit', ['C:/repo', 'msg'], async () => {
      order.push('mutate-start')
      await mutateGate.promise
      order.push('mutate-end')
    })
    const background = scheduler.schedule('getStatus', ['C:/repo'], async () => {
      order.push('status')
    })
    const network = scheduler.schedule('fetchRemote', ['C:/repo'], async () => {
      order.push('fetch')
    })

    await flush()
    expect(order).toEqual(['mutate-start'])
    mutateGate.resolve()
    await Promise.all([mutate, background, network])
    expect(order[0]).toBe('mutate-start')
    expect(order).toContain('fetch')
    expect(order).toContain('status')
    expect(order.indexOf('fetch')).toBeLessThan(order.indexOf('status'))
  })

  it('keeps FIFO order within one priority', async () => {
    const scheduler = createRepoScheduler({ readConcurrency: 1 })
    const gate = deferred<void>()
    const order: number[] = []
    const first = scheduler.schedule('getStatus', ['C:/repo'], async () => {
      await gate.promise
    })
    const second = scheduler.schedule('getStatus', ['C:/repo'], async () => {
      order.push(2)
    })
    const third = scheduler.schedule('getStatus', ['C:/repo'], async () => {
      order.push(3)
    })
    await flush()
    gate.resolve()
    await Promise.all([first, second, third])
    expect(order).toEqual([2, 3])
  })

  it('shares a key across linked worktrees via commonDir', async () => {
    const scheduler = createRepoScheduler({
      readConcurrency: 1,
      resolveCommonDir: async () => 'C:/main/.git'
    })
    let active = 0
    let maxActive = 0
    const a = deferred<void>()
    const b = deferred<void>()

    const first = scheduler.schedule('commit', ['C:/wt-a'], async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await a.promise
      active--
    })
    const second = scheduler.schedule('commit', ['C:/wt-b'], async () => {
      active++
      maxActive = Math.max(maxActive, active)
      await b.promise
      active--
    })

    await flush()
    expect(maxActive).toBe(1)
    a.resolve()
    b.resolve()
    await Promise.all([first, second])
    expect(maxActive).toBe(1)
  })

  it('cancels a queued request by id', async () => {
    const scheduler = createRepoScheduler({ readConcurrency: 1 })
    const gate = deferred<void>()
    const first = scheduler.schedule(
      'getStatus',
      ['C:/repo'],
      async () => {
        await gate.promise
      },
      1
    )
    const second = scheduler.schedule('getStatus', ['C:/repo'], async () => 'done', 2)
    await flush()
    expect(scheduler.cancelRequest(2)).toBe(true)
    gate.resolve()
    await first
    await expect(second).rejects.toBeInstanceOf(GitCancelledError)
  })

  it('drains queued work for cancelIn', async () => {
    const scheduler = createRepoScheduler({ readConcurrency: 1 })
    const gate = deferred<void>()
    const first = scheduler.schedule('getStatus', ['C:/repo'], async () => {
      await gate.promise
    })
    const second = scheduler.schedule('getStatus', ['C:/repo'], async () => 'done')
    await flush()
    scheduler.cancelIn('C:/repo')
    gate.resolve()
    await first
    await expect(second).rejects.toBeInstanceOf(GitCancelledError)
  })
})
