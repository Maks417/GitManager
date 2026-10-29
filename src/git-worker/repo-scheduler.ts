import { normalize } from 'path'
import { GitCancelledError } from './git-runner'
import type { GitMethodName } from './method-registry'
import { isPathInside } from './path-utils'

export { GitCancelledError } from './git-runner'

/**
 * - `read`: up to READ_CONCURRENCY at once, never beside a mutation.
 * - `mutate`: alone in the repository.
 * - `network`: fetch, pull and push. One at a time and never beside a mutation (both write refs and
 *   packed-refs), but reads go on meanwhile: a long fetch no longer holds up commit, diff and history clicks.
 * - `maintenance`: background housekeeping (commit-graph). Starts only when the repository is idle and then
 *   holds nothing up, since it only adds files Git reads when they are complete.
 */
export type GitLane = 'read' | 'mutate' | 'network' | 'maintenance'
export type GitPriority = 0 | 1 | 2

export interface GitMethodMeta {
  lane: GitLane
  /** 0 = user mutations / network, 1 = interactive reads, 2 = background reads. */
  priority: GitPriority
  /** Index of the repository path argument, or -1 when the method is not per-repo. */
  repoArgIndex: number
}

const READ: GitMethodMeta = { lane: 'read', priority: 1, repoArgIndex: 0 }
const READ_BG: GitMethodMeta = { lane: 'read', priority: 2, repoArgIndex: 0 }
const MUTATE: GitMethodMeta = { lane: 'mutate', priority: 0, repoArgIndex: 0 }
const NETWORK: GitMethodMeta = { lane: 'network', priority: 0, repoArgIndex: 0 }
const MAINTENANCE: GitMethodMeta = { lane: 'maintenance', priority: 2, repoArgIndex: 0 }
const GLOBAL_READ: GitMethodMeta = { lane: 'read', priority: 1, repoArgIndex: -1 }

/** Exhaustive lane/priority metadata for every git-worker RPC method. */
export const GIT_METHOD_META: Record<GitMethodName, GitMethodMeta> = {
  getRemotes: READ,
  saveRemote: MUTATE,
  removeRemote: MUTATE,
  setUpstream: MUTATE,
  compareRefs: READ,
  getComparisonDiff: READ,
  getRecoveryEntries: READ,
  restoreRecovery: MUTATE,
  deleteRecovery: MUTATE,
  publishBranch: NETWORK,
  inspectRepository: READ,
  refreshRepoSession: READ_BG,
  createRepository: { lane: 'mutate', priority: 0, repoArgIndex: -1 },
  getDefaultBranchName: GLOBAL_READ,
  getEnclosingWorkTree: READ,
  cloneRepository: { lane: 'mutate', priority: 0, repoArgIndex: -1 },
  getGitDirs: READ,
  loadHistory: READ,
  getCommitDetail: READ,
  getFileDiff: READ,
  getWatchFingerprint: READ_BG,
  ensureCommitGraph: MAINTENANCE,
  getWorktreeInfo: READ,
  pruneWorktree: MUTATE,
  getWorkingTreeDiff: READ,
  getFileHistory: READ,
  getBlame: READ,
  getStatus: READ_BG,
  filterIgnoredPaths: READ_BG,
  filterIgnoredFolders: READ_BG,
  getBranches: READ_BG,
  getRemoteBranches: READ_BG,
  stagePaths: MUTATE,
  unstagePaths: MUTATE,
  applyPartial: MUTATE,
  planDiscard: MUTATE,
  restoreWorktree: MUTATE,
  commit: MUTATE,
  fetchRemote: NETWORK,
  pullRemote: NETWORK,
  pushRemote: NETWORK,
  forcePushRemote: NETWORK,
  checkoutRef: MUTATE,
  checkoutRemoteBranch: MUTATE,
  createBranch: MUTATE,
  mergeRef: MUTATE,
  rebaseOnto: MUTATE,
  rebaseContinue: MUTATE,
  rebaseAbort: MUTATE,
  rebaseSkip: MUTATE,
  isRebaseInProgress: READ_BG,
  isMergeInProgress: READ_BG,
  mergeAbort: MUTATE,
  deleteBranch: MUTATE,
  cherryPickCommit: MUTATE,
  revertCommit: MUTATE,
  getSequencerOp: READ_BG,
  sequencerStep: MUTATE,
  countCommitsAfter: READ,
  resetToCommit: MUTATE,
  createTag: MUTATE,
  deleteTag: MUTATE,
  pushTag: NETWORK,
  stashSave: MUTATE,
  listStashes: READ,
  stashApply: MUTATE,
  stashPop: MUTATE,
  stashDrop: MUTATE,
  listConflictFiles: READ,
  getMergeSides: READ,
  saveMergeResult: MUTATE,
  resolveConflictSide: MUTATE,
  getGitIdentity: READ_BG,
  setGitIdentity: MUTATE,
  inspectRepoForRemoval: READ
}

interface QueuedJob {
  id: number
  order: number
  key: string
  lane: GitLane
  priority: GitPriority
  rootHint: string | null
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (err: unknown) => void
  /** Still waiting to join a bucket after async common-dir resolution. */
  pendingKey?: boolean
}

interface Bucket {
  activeReads: number
  activeMutate: boolean
  activeNetwork: boolean
  activeMaintenance: boolean
  queue: QueuedJob[]
}

const READ_CONCURRENCY = 2
const GLOBAL_KEY = '_global'

export function normalizeRepoKey(repoPath: string): string {
  return normalize(repoPath).replace(/\\/g, '/').toLowerCase()
}

export function extractRepoPath(method: string, args: unknown[]): string | null {
  const meta = GIT_METHOD_META[method as GitMethodName]
  if (!meta || meta.repoArgIndex < 0) {
    if (method === 'cloneRepository') {
      return typeof args[1] === 'string' ? args[1] : null
    }
    if (method === 'createRepository') {
      const path = (args[0] as { path?: string } | undefined)?.path
      return typeof path === 'string' ? path : null
    }
    return null
  }
  const value = args[meta.repoArgIndex]
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'repoPath' in value) {
    const repoPath = (value as { repoPath?: unknown }).repoPath
    return typeof repoPath === 'string' ? repoPath : null
  }
  return null
}

export interface RepoSchedulerOptions {
  /** Resolve the shared git common directory for a work tree (mutations across linked worktrees). */
  resolveCommonDir?: (repoPath: string) => Promise<string>
  readConcurrency?: number
}

/**
 * Bounds concurrent git-worker RPCs per repository. Scheduling is above operation handlers so their
 * internal Promise.all Git calls cannot deadlock on this queue.
 */
export function createRepoScheduler(options: RepoSchedulerOptions = {}): {
  schedule: <T>(
    method: string,
    args: unknown[],
    run: () => Promise<T> | T,
    requestId?: number
  ) => Promise<T>
  cancelRequest: (requestId: number) => boolean
  cancelIn: (root: string) => void
  cancelAll: () => void
} {
  const buckets = new Map<string, Bucket>()
  const commonDirCache = new Map<string, string>()
  const byRequestId = new Map<number, QueuedJob>()
  const readLimit = options.readConcurrency ?? READ_CONCURRENCY
  let nextSyntheticId = -1
  let nextOrder = 0

  const bucketFor = (key: string): Bucket => {
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { activeReads: 0, activeMutate: false, activeNetwork: false, activeMaintenance: false, queue: [] }
      buckets.set(key, bucket)
    }
    return bucket
  }

  const enqueue = (key: string, job: QueuedJob): void => {
    job.key = key
    job.pendingKey = false
    bucketFor(key).queue.push(job)
    pump(key)
  }

  const start = (key: string, bucket: Bucket, job: QueuedJob, release: () => void): void => {
    bucket.queue.splice(bucket.queue.indexOf(job), 1)
    byRequestId.delete(job.id)
    void Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        release()
        pump(key)
      })
  }

  const pump = (key: string): void => {
    const bucket = bucketFor(key)
    bucket.queue.sort((a, b) => a.priority - b.priority || a.order - b.order)

    // A mutation or network operation that has to wait keeps the ones queued after it waiting too (FIFO).
    let exclusiveWaiting = false
    // A mutation waiting only for running reads: later reads wait, or a stream of them would starve it.
    let readsHeld = false
    for (const job of [...bucket.queue]) {
      if (job.lane === 'mutate') {
        const free = !bucket.activeMutate && !bucket.activeNetwork
        if (!exclusiveWaiting && free && bucket.activeReads === 0) {
          bucket.activeMutate = true
          start(key, bucket, job, () => {
            bucket.activeMutate = false
          })
          continue
        }
        exclusiveWaiting = true
        if (free) readsHeld = true
      } else if (job.lane === 'network') {
        if (!exclusiveWaiting && !bucket.activeMutate && !bucket.activeNetwork) {
          bucket.activeNetwork = true
          start(key, bucket, job, () => {
            bucket.activeNetwork = false
          })
          continue
        }
        exclusiveWaiting = true
      } else if (job.lane === 'read') {
        if (!bucket.activeMutate && !readsHeld && bucket.activeReads < readLimit) {
          bucket.activeReads++
          start(key, bucket, job, () => {
            bucket.activeReads--
          })
        }
      } else {
        const idle =
          !bucket.activeMutate &&
          !bucket.activeNetwork &&
          !bucket.activeMaintenance &&
          bucket.activeReads === 0 &&
          bucket.queue.every((queued) => queued.lane === 'maintenance')
        if (idle) {
          bucket.activeMaintenance = true
          start(key, bucket, job, () => {
            bucket.activeMaintenance = false
          })
        }
      }
    }
  }

  const dropJob = (job: QueuedJob): void => {
    byRequestId.delete(job.id)
    const bucket = buckets.get(job.key)
    if (bucket) {
      const index = bucket.queue.indexOf(job)
      if (index >= 0) bucket.queue.splice(index, 1)
    }
    job.reject(new GitCancelledError())
  }

  return {
    schedule<T>(
      method: string,
      args: unknown[],
      run: () => Promise<T> | T,
      requestId = nextSyntheticId--
    ): Promise<T> {
      const meta = GIT_METHOD_META[method as GitMethodName] ?? READ
      const repoPath = extractRepoPath(method, args)
      const rootHint = repoPath ? normalizeRepoKey(repoPath) : null

      return new Promise<T>((resolve, reject) => {
        const job: QueuedJob = {
          id: requestId,
          order: nextOrder++,
          key: rootHint ?? GLOBAL_KEY,
          lane: meta.lane,
          priority: meta.priority,
          rootHint,
          pendingKey: Boolean(rootHint && options.resolveCommonDir),
          run: async () => run(),
          resolve: (value) => resolve(value as T),
          reject
        }
        byRequestId.set(requestId, job)

        if (!rootHint || !options.resolveCommonDir) {
          enqueue(rootHint ?? GLOBAL_KEY, job)
          return
        }

        const cached = commonDirCache.get(rootHint)
        if (cached) {
          enqueue(cached, job)
          return
        }

        void options
          .resolveCommonDir(repoPath as string)
          .then((commonDir) => {
            if (!byRequestId.has(requestId)) return
            const key = normalizeRepoKey(commonDir)
            commonDirCache.set(rootHint, key)
            enqueue(key, job)
          })
          .catch(() => {
            if (!byRequestId.has(requestId)) return
            enqueue(rootHint, job)
          })
      })
    },

    cancelRequest(requestId) {
      const job = byRequestId.get(requestId)
      if (!job) return false
      dropJob(job)
      return true
    },

    cancelIn(root) {
      const normalizedRoot = normalizeRepoKey(root)
      for (const job of [...byRequestId.values()]) {
        const hint = job.rootHint
        if (!hint) continue
        if (isPathInside(normalizedRoot, hint) || isPathInside(hint, normalizedRoot)) {
          dropJob(job)
        }
      }
    },

    cancelAll() {
      for (const job of [...byRequestId.values()]) dropJob(job)
    }
  }
}
