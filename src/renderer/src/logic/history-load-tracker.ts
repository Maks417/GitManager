/**
 * Orders the history loads of one window. Every load that replaces the list takes a newer token, so an older
 * load (or a tip refresh started before it) never applies over it. Per list key it also remembers the newest
 * running load, so a key change starts no second, identical load while that one will still apply, yet does
 * start one when the running load was superseded by another list's load (switching A → B → A).
 */
export interface HistoryLoadTracker {
  /** Start a load that replaces the list of `key`; returns its token. */
  begin: (key: string) => number
  /** Start a jump to a commit: it replaces the list only when it finds the commit, so it supersedes nothing yet. */
  beginReveal: () => number
  /** Whether a load or tip refresh holding `token` may still apply its result. */
  isLatest: (token: number) => boolean
  /** A jump found its commit and applies: loads started before it must not. */
  supersede: () => void
  /** The token current now, for a tip refresh that only applies when no load started meanwhile. */
  current: () => number
  finish: (key: string, token: number) => void
  /** Whether `key` needs a load of its own: none is running for it that will still apply. */
  needsLoad: (key: string) => boolean
}

export function createHistoryLoadTracker(): HistoryLoadTracker {
  let latest = 0
  const runningByKey = new Map<string, number>()
  return {
    begin(key) {
      latest += 1
      runningByKey.set(key, latest)
      return latest
    },
    beginReveal: () => latest,
    isLatest: (token) => token === latest,
    supersede() {
      latest += 1
    },
    current: () => latest,
    finish(key, token) {
      if (runningByKey.get(key) === token) runningByKey.delete(key)
    },
    needsLoad: (key) => runningByKey.get(key) !== latest
  }
}
