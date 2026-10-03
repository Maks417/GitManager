export type RepoRefreshScope = 'status' | 'meta'

export interface RepoRefreshScheduler {
  /** Queue a refresh; returns the scope that should run when `run` is true. */
  request(scope: RepoRefreshScope): { run: boolean; scope: RepoRefreshScope; generation: number }
  /** Call when the in-flight refresh finishes; returns a trailing scope to run, if any. */
  complete(generation: number): { run: boolean; scope: RepoRefreshScope; generation: number }
  /** Drop queued work, e.g. when the repository changes. */
  reset(): void
  readonly inFlight: boolean
}

function maxScope(a: RepoRefreshScope, b: RepoRefreshScope): RepoRefreshScope {
  return a === 'meta' || b === 'meta' ? 'meta' : 'status'
}

/**
 * Trailing-edge coalescer for live repository refreshes: one in-flight refresh per repository,
 * promote status to meta when both arrive, and allow at most one trailing rerun.
 */
export function createRepoRefreshScheduler(): RepoRefreshScheduler {
  let inFlight = false
  let pending: RepoRefreshScope | null = null
  let generation = 0

  return {
    get inFlight() {
      return inFlight
    },
    request(scope) {
      if (inFlight) {
        pending = pending ? maxScope(pending, scope) : scope
        return { run: false, scope: pending, generation }
      }
      inFlight = true
      pending = null
      return { run: true, scope, generation }
    },
    complete(completedGeneration) {
      // A refresh from the previous repository/effect must not mutate the new generation's queue.
      if (completedGeneration !== generation) {
        return { run: false, scope: 'status', generation }
      }
      inFlight = false
      if (!pending) return { run: false, scope: 'status', generation }
      const scope = pending
      pending = null
      inFlight = true
      return { run: true, scope, generation }
    },
    reset() {
      generation++
      inFlight = false
      pending = null
    }
  }
}

/** Whether a tip history refresh is needed after applying a repository snapshot. */
export function shouldRefreshHistoryTip(
  previous: string | null | undefined,
  next: string | null | undefined
): boolean {
  if (!next) return false
  return previous !== next
}
