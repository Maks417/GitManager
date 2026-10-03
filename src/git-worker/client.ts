/**
 * Main-process client for git ops. Runs them in an Electron utilityProcess and falls back to
 * in-process operations if the worker cannot start.
 */
import { app, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { RemoteOpResult, RemoteProgress } from '@shared/ipc'
import type * as ops from './operations'
import type { RemoteOpContext } from './ops/branches'
import { getGitMethod, type CancellableGitMethod, type GitMethodName } from './method-registry'
import {
  cancelAllGit as cancelAllGitLocal,
  cancelGitIn as cancelGitInLocal,
  GitCancelledError,
  probeGit
} from './git-runner'

type Pending = {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
  onProgress?: (progress: RemoteProgress) => void
}

let child: UtilityProcess | null = null
let childReady = false
let useInline = false
let nextId = 1
const pending = new Map<number, Pending>()

function workerScriptPath(): string {
  // electron-vite emits sibling `git-utility.js` next to main `index.js`
  const candidate = join(__dirname, 'git-utility.js')
  if (existsSync(candidate)) return candidate
  // Dev fallback when running from source maps / different layout
  return join(app.getAppPath(), 'out', 'main', 'git-utility.js')
}

function attachChild(proc: UtilityProcess): void {
  child = proc
  childReady = false
  proc.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return
    const m = msg as {
      type?: string
      id?: number
      ok?: boolean
      result?: unknown
      error?: string
      progress?: RemoteProgress
    }
    if (m.type === 'ready') {
      childReady = true
      return
    }
    if (typeof m.id !== 'number') return
    const wait = pending.get(m.id)
    if (!wait) return
    if (m.type === 'progress') {
      if (m.progress) wait.onProgress?.(m.progress)
      return
    }
    pending.delete(m.id)
    if (m.ok) wait.resolve(m.result)
    else wait.reject(new Error(m.error || 'Git worker error'))
  })
  proc.on('exit', () => {
    child = null
    childReady = false
    for (const [, wait] of pending) {
      wait.reject(new Error('Git worker exited'))
    }
    pending.clear()
  })
}

function ensureWorker(): void {
  if (useInline || child) return
  try {
    const script = workerScriptPath()
    if (!existsSync(script)) {
      useInline = true
      return
    }
    const proc = utilityProcess.fork(script, [], {
      serviceName: 'git-manager-git',
      // Nothing reads the worker's output; with 'pipe' a full pipe buffer could block it.
      stdio: 'inherit'
    })
    attachChild(proc)
  } catch {
    useInline = true
    child = null
  }
}

async function waitReady(timeoutMs = 5000): Promise<boolean> {
  if (useInline) return false
  if (childReady) return true
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (childReady) return true
    if (!child) return false
    await new Promise((r) => setTimeout(r, 20))
  }
  return childReady
}

type ControlMethod = 'cancelAllGit' | 'cancelGitIn'

async function invoke(method: GitMethodName | ControlMethod, args: unknown[]): Promise<unknown> {
  ensureWorker()
  if (useInline || !child) {
    return invokeInline(method, args)
  }
  const ready = await waitReady()
  if (!ready || !child) {
    useInline = true
    return invokeInline(method, args)
  }

  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      child!.postMessage({ id, method, args })
    } catch (err) {
      pending.delete(id)
      useInline = true
      void invokeInline(method, args).then(resolve, reject)
      void err
    }
  })
}

async function invokeInline(method: string, args: unknown[]): Promise<unknown> {
  if (method === 'cancelAllGit') {
    const { gitRepoScheduler } = await import('./scheduler-instance')
    gitRepoScheduler.cancelAll()
    cancelAllGitLocal()
    return
  }
  if (method === 'cancelGitIn') {
    const { gitRepoScheduler } = await import('./scheduler-instance')
    gitRepoScheduler.cancelIn(String(args[0]))
    cancelGitInLocal(String(args[0]))
    return
  }
  const fn = getGitMethod(method)
  if (!fn) throw new Error(`Unknown git method: ${method}`)
  const { gitRepoScheduler } = await import('./scheduler-instance')
  return gitRepoScheduler.schedule(method, args, () =>
    (fn as (...a: unknown[]) => Promise<unknown> | unknown)(...args)
  )
}

export function cancelAllGit(): void {
  if (child && !useInline) {
    void invoke('cancelAllGit', []).catch(() => undefined)
  }
  cancelAllGitLocal()
}

/** Cancel git processes working inside `root` (e.g. before deleting that repository). */
export function cancelGitIn(root: string): void {
  if (child && !useInline) {
    void invoke('cancelGitIn', [root]).catch(() => undefined)
  }
  cancelGitInLocal(root)
}

/**
 * Start an operation that reports progress and can be cancelled (fetch, pull, push, clone), in the git
 * worker when it is available and in this process otherwise. `cancel` may be called at any time, even
 * before it starts.
 */
export function runCancellableOp<T>(
  method: CancellableGitMethod,
  args: unknown[],
  onProgress: (progress: RemoteProgress) => void
): { promise: Promise<T>; cancel: () => void } {
  let cancelRequested = false
  let cancel = (): void => {
    cancelRequested = true
  }

  const runInline = (): Promise<T> => {
    const controller = new AbortController()
    const scheduleId = nextId++
    cancel = () => {
      cancelRequested = true
      controller.abort()
      void import('./scheduler-instance').then(({ gitRepoScheduler }) => {
        gitRepoScheduler.cancelRequest(scheduleId)
      })
    }
    const fn = getGitMethod(method) as unknown as (...a: unknown[]) => Promise<T>
    const context: RemoteOpContext = { signal: controller.signal, onProgress }
    return import('./scheduler-instance').then(async ({ gitRepoScheduler }) => {
      if (cancelRequested) return { outcome: 'cancelled' } as T
      try {
        return await gitRepoScheduler.schedule(
          method,
          args,
          () => fn(...args, context),
          scheduleId
        )
      } catch (err) {
        if (err instanceof GitCancelledError) return { outcome: 'cancelled' } as T
        throw err
      }
    })
  }

  const promise = (async (): Promise<T> => {
    ensureWorker()
    if (useInline || !child) return runInline()
    const ready = await waitReady()
    if (!ready || !child) {
      useInline = true
      return runInline()
    }
    const worker = child
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress })
      try {
        worker.postMessage({ id, method, args, cancellable: true })
      } catch {
        pending.delete(id)
        useInline = true
        void runInline().then(resolve, reject)
        return
      }
      cancel = () => worker.postMessage({ type: 'cancel', id })
      if (cancelRequested) cancel()
    })
  })()

  return { promise, cancel: () => cancel() }
}

export type RemoteMethod = 'fetchRemote' | 'pullRemote' | 'pushRemote'

/** A fetch, pull or push of `repoPath`; see runCancellableOp. */
export function runRemoteOp(
  method: RemoteMethod,
  repoPath: string,
  onProgress: (progress: RemoteProgress) => void
): { promise: Promise<RemoteOpResult>; cancel: () => void } {
  return runCancellableOp<RemoteOpResult>(method, [repoPath], onProgress)
}

export { probeGit }

function wrap<K extends GitMethodName>(method: K) {
  return (...args: Parameters<(typeof ops)[K]>) =>
    invoke(method, args) as ReturnType<(typeof ops)[K]>
}

export const inspectRepository = wrap('inspectRepository')
export const refreshRepoSession = wrap('refreshRepoSession')
export const createRepository = wrap('createRepository')
export const getDefaultBranchName = wrap('getDefaultBranchName')
export const getEnclosingWorkTree = wrap('getEnclosingWorkTree')
export const getGitDirs = wrap('getGitDirs')
export const loadHistory = wrap('loadHistory')
export const getCommitDetail = wrap('getCommitDetail')
export const getFileDiff = wrap('getFileDiff')
export const getWorkingTreeDiff = wrap('getWorkingTreeDiff')
export const getFileHistory = wrap('getFileHistory')
export const getBlame = wrap('getBlame')
export const getStatus = wrap('getStatus')
export const getWatchFingerprint = wrap('getWatchFingerprint')
export const filterIgnoredPaths = wrap('filterIgnoredPaths')
export const getBranches = wrap('getBranches')
export const getRemoteBranches = wrap('getRemoteBranches')
export const stagePaths = wrap('stagePaths')
export const unstagePaths = wrap('unstagePaths')
export const applyPartial = wrap('applyPartial')
export const cherryPickCommit = wrap('cherryPickCommit')
export const revertCommit = wrap('revertCommit')
export const getSequencerOp = wrap('getSequencerOp')
export const sequencerStep = wrap('sequencerStep')
export const countCommitsAfter = wrap('countCommitsAfter')
export const resetToCommit = wrap('resetToCommit')
export const createTag = wrap('createTag')
export const deleteTag = wrap('deleteTag')
export const planDiscard = wrap('planDiscard')
export const restoreWorktree = wrap('restoreWorktree')
export const commit = wrap('commit')
export const checkoutRef = wrap('checkoutRef')
export const checkoutRemoteBranch = wrap('checkoutRemoteBranch')
export const createBranch = wrap('createBranch')
export const mergeRef = wrap('mergeRef')
export const rebaseOnto = wrap('rebaseOnto')
export const rebaseContinue = wrap('rebaseContinue')
export const rebaseAbort = wrap('rebaseAbort')
export const isRebaseInProgress = wrap('isRebaseInProgress')
export const rebaseSkip = wrap('rebaseSkip')
export const isMergeInProgress = wrap('isMergeInProgress')
export const mergeAbort = wrap('mergeAbort')
export const deleteBranch = wrap('deleteBranch')
export const stashSave = wrap('stashSave')
export const listStashes = wrap('listStashes')
export const stashApply = wrap('stashApply')
export const stashPop = wrap('stashPop')
export const stashDrop = wrap('stashDrop')
export const listConflictFiles = wrap('listConflictFiles')
export const getMergeSides = wrap('getMergeSides')
export const saveMergeResult = wrap('saveMergeResult')
export const resolveConflictSide = wrap('resolveConflictSide')
export const getGitIdentity = wrap('getGitIdentity')
export const setGitIdentity = wrap('setGitIdentity')
export const inspectRepoForRemoval = wrap('inspectRepoForRemoval')
export const getWorktreeInfo = wrap('getWorktreeInfo')
export const pruneWorktree = wrap('pruneWorktree')

export { friendlyCommitError } from './operations'
