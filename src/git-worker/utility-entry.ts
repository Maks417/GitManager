/**
 * Electron utilityProcess entry for git ops (Windows + macOS).
 * Receives `{ id, method, args }` and replies `{ id, ok, result | error }`.
 */
import * as ops from './operations'
import { cancelAllGit } from './git-runner'

type RpcRequest = { id: number; method: string; args: unknown[] }

const handlers: Record<string, (...args: never[]) => unknown> = {
  inspectRepository: ops.inspectRepository,
  initRepository: ops.initRepository,
  cloneRepository: ops.cloneRepository,
  loadHistory: ops.loadHistory,
  getCommitDetail: ops.getCommitDetail,
  getFileDiff: ops.getFileDiff,
  getWorkingTreeDiff: ops.getWorkingTreeDiff,
  getStatus: ops.getStatus,
  getBranches: ops.getBranches,
  stagePaths: ops.stagePaths,
  unstagePaths: ops.unstagePaths,
  discardPaths: ops.discardPaths,
  commit: ops.commit,
  fetchRemote: ops.fetchRemote,
  pullRemote: ops.pullRemote,
  pushRemote: ops.pushRemote,
  checkoutRef: ops.checkoutRef,
  createBranch: ops.createBranch,
  mergeRef: ops.mergeRef,
  rebaseOnto: ops.rebaseOnto,
  rebaseContinue: ops.rebaseContinue,
  rebaseAbort: ops.rebaseAbort,
  isRebaseInProgress: ops.isRebaseInProgress,
  deleteBranch: ops.deleteBranch,
  stashSave: ops.stashSave,
  listStashes: ops.listStashes,
  stashApply: ops.stashApply,
  stashPop: ops.stashPop,
  stashDrop: ops.stashDrop,
  listConflictFiles: ops.listConflictFiles,
  getMergeSides: ops.getMergeSides,
  saveMergeResult: ops.saveMergeResult,
  getGitIdentity: ops.getGitIdentity,
  setGitIdentity: ops.setGitIdentity,
  cancelAllGit: () => {
    cancelAllGit()
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
