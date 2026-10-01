import type { WebContents } from 'electron'
import {
  IpcChannels,
  type CloneResult,
  type GitProgress,
  type RemoteOpKind,
  type RemoteOpRequest,
  type RemoteOpResult,
  type TagPushRequest
} from '@shared/ipc'
import { runCancellableOp } from '../git-worker/client'
import type { CancellableGitMethod } from '../git-worker/method-registry'

const METHODS = { fetch: 'fetchRemote', pull: 'pullRemote', push: 'pushRemote' } as const

/** Cancel functions of the operations that are running, by the id the renderer chose. */
const running = new Map<string, () => void>()

/** Runs a cancellable operation, sending its progress only to the window that started it. */
async function runTracked<T>(
  sender: WebContents,
  opId: string,
  method: CancellableGitMethod,
  args: unknown[],
  subject: Pick<GitProgress, 'repoPath' | 'kind'>
): Promise<T> {
  if (running.has(opId)) throw new Error('This operation id is already in use')
  const operation = runCancellableOp<T>(method, args, (progress) => {
    if (sender.isDestroyed()) return
    const event: GitProgress = { ...progress, ...subject, opId }
    sender.send(IpcChannels.git.onProgress, event)
  })
  running.set(opId, operation.cancel)
  try {
    return await operation.promise
  } finally {
    running.delete(opId)
  }
}

/** Run a fetch, pull or push, sending its progress only to the window that started it. */
export function runRemoteOperation(
  sender: WebContents,
  kind: RemoteOpKind,
  request: RemoteOpRequest
): Promise<RemoteOpResult> {
  return runTracked(sender, request.opId, METHODS[kind], [request.repoPath], { repoPath: request.repoPath, kind })
}

/** Push one tag (or delete it on the remote), shown and cancelled like a push. */
export function runTagPush(sender: WebContents, request: TagPushRequest): Promise<RemoteOpResult> {
  return runTracked(sender, request.opId, 'pushTag', [request.repoPath, request.tag, request.remove ?? false], {
    repoPath: request.repoPath,
    kind: 'push'
  })
}

/** Clone `url` into `target` with progress; cancelling removes the partly cloned folder. */
export function runCloneOperation(
  sender: WebContents,
  request: { opId: string; url: string; target: string }
): Promise<CloneResult> {
  return runTracked(sender, request.opId, 'cloneRepository', [request.url, request.target], {
    repoPath: request.target,
    kind: 'clone'
  })
}

/** Unknown or finished ids are ignored: the operation may have ended just before the cancel arrived. */
export function cancelRemoteOperation(opId: string): void {
  running.get(opId)?.()
}
