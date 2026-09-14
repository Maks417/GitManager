/**
 * Electron utilityProcess entry for git ops.
 * Receives `{ id, method, args }` and replies `{ id, ok, result | error }`.
 */
import { GIT_METHODS } from './method-registry'
import { cancelAllGit, cancelGitIn } from './git-runner'

type RpcRequest = { id: number; method: string; args: unknown[] }

const handlers: Record<string, (...args: never[]) => unknown> = {
  ...GIT_METHODS,
  cancelAllGit: () => {
    cancelAllGit()
  },
  cancelGitIn: (root: string) => {
    cancelGitIn(root)
  }
}

const port = process.parentPort
if (!port) {
  // eslint-disable-next-line no-console
  console.error('git-utility: no parentPort — not running as utilityProcess')
} else {
  port.on('message', (event: { data: RpcRequest }) => {
    const msg = event.data
    void (async () => {
      try {
        const fn = handlers[msg.method]
        if (!fn) throw new Error(`Unknown git method: ${msg.method}`)
        const result = await (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...(msg.args ?? []))
        port.postMessage({ id: msg.id, ok: true, result })
      } catch (err) {
        port.postMessage({
          id: msg.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })()
  })
  port.postMessage({ type: 'ready' })
}
