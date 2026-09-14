/**
 * Electron utilityProcess entry for git ops.
 * Receives `{ id, method, args }` and replies `{ id, ok, result | error }`. Network operations sent with
 * `cancellable` also stream `{ type: 'progress', id, progress }` and stop on `{ type: 'cancel', id }`.
 */
import { GIT_METHODS } from './method-registry'
import { cancelAllGit, cancelGitIn } from './git-runner'
import type { RemoteOpContext } from './ops/branches'

type RpcRequest = { id: number; method: string; args?: unknown[]; cancellable?: boolean }
type RpcCancel = { type: 'cancel'; id: number }

/** Operations that take `{ signal, onProgress }` as their last argument. */
const CANCELLABLE_METHODS = new Set(['fetchRemote', 'pullRemote', 'pushRemote'])

const handlers: Record<string, (...args: never[]) => unknown> = {
  ...GIT_METHODS,
  cancelAllGit: () => {
    cancelAllGit()
  },
  cancelGitIn: (root: string) => {
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
      running.get(msg.id)?.abort()
      return
    }
    const request = msg as RpcRequest
    void (async () => {
      try {
        const fn = handlers[request.method]
        if (!fn) throw new Error(`Unknown git method: ${request.method}`)
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
        const result = await (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args)
        port.postMessage({ id: request.id, ok: true, result })
      } catch (err) {
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
  process.on('exit', () => cancelAllGit())
  port.postMessage({ type: 'ready' })
}
