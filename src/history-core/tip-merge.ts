import type { Commit } from '@shared/ipc'
import { decorateCommitsWithColors } from './layout'

/**
 * Splice a freshly loaded first page on top of already loaded older commits.
 *
 * Returns `null` when splicing would show stale history: a loaded commit that belongs inside the
 * new page's range is missing from it (amend, rebase, reset, pruned branch), or the page no longer
 * reaches the loaded list. Callers then replace the list with the page.
 */
export function mergeTipPage<T extends { sha: string }>(
  loaded: T[],
  page: T[],
  pageIsPartial: boolean
): T[] | null {
  if (!pageIsPartial || loaded.length === 0) return page
  const last = page[page.length - 1]
  const boundary = last ? loaded.findIndex((c) => c.sha === last.sha) : -1
  if (boundary === -1) return null
  const pageShas = new Set(page.map((c) => c.sha))
  for (let i = 0; i < boundary; i++) {
    if (!pageShas.has(loaded[i].sha)) return null
  }
  return [...page, ...loaded.slice(boundary + 1).filter((c) => !pageShas.has(c.sha))]
}

function sameRefs(a: Commit, b: Commit): boolean {
  return a.refs.length === b.refs.length && a.refs.every((ref, i) => ref.name === b.refs[i].name && ref.type === b.refs[i].type)
}

/**
 * The commits of a refreshed list, reusing the loaded objects of commits that did not change (a commit
 * never changes, only the refs on it), so rows that show them need not render again. New or
 * re-decorated commits get colors that continue from the loaded ones.
 */
export function reuseLoadedCommits(next: Commit[], loaded: readonly Commit[]): Commit[] {
  const bySha = new Map(loaded.map((c) => [c.sha, c]))
  const fresh: Commit[] = []
  const kept = next.map((commit) => {
    const old = bySha.get(commit.sha)
    if (old && (old === commit || sameRefs(old, commit))) return old
    fresh.push(commit)
    return commit
  })
  if (fresh.length === 0) return kept
  const decorated = new Map(decorateCommitsWithColors(fresh, loaded).map((c) => [c.sha, c]))
  return kept.map((c) => decorated.get(c.sha) ?? c)
}

/** Whether two lists hold the same commit objects in the same order. */
export function sameCommitList(a: readonly Commit[], b: readonly Commit[]): boolean {
  return a.length === b.length && a.every((c, i) => c === b[i])
}
