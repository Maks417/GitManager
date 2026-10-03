/**
 * Electron utilityProcess entry for git ops.
 * Receives `{ id, method, args }` and replies `{ id, ok, result | error }`. Network operations sent with
 * `cancellable` also stream `{ type: 'progress', id, progress }` and stop on `{ type: 'cancel', id }`.
 */
import { CANCELLABLE_GIT_METHODS, GIT_METHODS } from './method-registry'
import { cancelAllGit, cancelGitIn, GitCancelledError } from './git-runner'
import type { RemoteOpContext } from './ops/branches'
import { gitRepoScheduler } from './scheduler-instance'

type RpcRequest = { id: number; method: string; args?: unknown[]; cancellable?: boolean }
type RpcCancel = { type: 'cancel'; id: number }

const CANCELLABLE_METHODS = new Set<string>(CANCELLABLE_GIT_METHODS)

const handlers: Record<string, (...args: never[]) => unknown> = {
  ...GIT_METHODS,
  cancelAllGit: () => {
    gitRepoScheduler.cancelAll()
    cancelAllGit()
  },
  cancelGitIn: (root: string) => {
    gitRepoScheduler.cancelIn(root)
    cancelGitIn(root)
  }
}

const running = new Map<number, AbortController>()

const port = process.parentPort
if (!port) {
  console.error('git-utility: no parentPort — not running as utilityProcess')
} else {
  port.on('message', (event: { data: RpcRequest | RpcCancel }) => {
    const msg = event.data
    if ('type' in msg && msg.type === 'cancel') {
      gitRepoScheduler.cancelRequest(msg.id)
      running.get(msg.id)?.abort()
      return
    }
    const request = msg as RpcRequest
    void (async () => {
      try {
        const fn = handlers[request.method]
        if (!fn) throw new Error(`Unknown git method: ${request.method}`)
        if (request.method === 'cancelAllGit' || request.method === 'cancelGitIn') {
          const result = await (fn as (...a: unknown[]) => Promise<unknown> | unknown)(
            ...(request.args ?? [])
          )
          port.postMessage({ id: request.id, ok: true, result })
          return
        }
        const args = [...(request.args ?? [])]
        if (request.cancellable && CANCELLABLE_METHODS.has(request.method)) {
          const controller = new AbortController()
          running.set(request.id, controller)
          const context: RemoteOpContext = {
            signal: controller.signal,
            onProgress: (progress) => port.postMessage({ type: 'progress', id: request.id, progress })
          }
          args.push(context)
        }
        const result = await gitRepoScheduler.schedule(
          request.method,
          args,
          () => (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args),
          request.id
        )
        port.postMessage({ id: request.id, ok: true, result })
      } catch (err) {
        if (request.cancellable && err instanceof GitCancelledError) {
          port.postMessage({ id: request.id, ok: true, result: { outcome: 'cancelled' } })
          return
        }
        port.postMessage({
          id: request.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      } finally {
        running.delete(request.id)
      }
    })()
  })
  // Network commands run in their own process group and would outlive this process; stop them with it.
  process.on('exit', () => {
    gitRepoScheduler.cancelAll()
    cancelAllGit()
  })
  port.postMessage({ type: 'ready' })
}
