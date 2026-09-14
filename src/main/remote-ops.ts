import type { WebContents } from 'electron'
import {
  IpcChannels,
  type GitProgress,
  type RemoteOpKind,
  type RemoteOpRequest,
  type RemoteOpResult
} from '@shared/ipc'
import { runRemoteOp } from '../git-worker/client'

const METHODS = { fetch: 'fetchRemote', pull: 'pullRemote', push: 'pushRemote' } as const

/** Cancel functions of the operations that are running, by the id the renderer chose. */
const running = new Map<string, () => void>()

/** Run a fetch, pull or push, sending its progress only to the window that started it. */
export async function runRemoteOperation(
  sender: WebContents,
  kind: RemoteOpKind,
  request: RemoteOpRequest
): Promise<RemoteOpResult> {
  if (running.has(request.opId)) throw new Error('This operation id is already in use')
  const operation = runRemoteOp(METHODS[kind], request.repoPath, (progress) => {
    if (sender.isDestroyed()) return
    const event: GitProgress = { ...progress, opId: request.opId, repoPath: request.repoPath, kind }
    sender.send(IpcChannels.git.onProgress, event)
  })
  running.set(request.opId, operation.cancel)
  try {
    return await operation.promise
  } finally {
    running.delete(request.opId)
  }
}

/** Unknown or finished ids are ignored: the operation may have ended just before the cancel arrived. */
export function cancelRemoteOperation(opId: string): void {
  running.get(opId)?.()
}
