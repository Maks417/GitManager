import type { StatusEntry } from '@shared/ipc'

export type Selection = { kind: 'commit'; sha: string } | { kind: 'working-copy' }
export type ViewMode = 'history' | 'changes'
export type HistoryRefreshMode = 'full' | 'tip' | 'none'

/** One applied status refresh: its number, and the work-tree files it was for (null: any may have changed). */
export interface StatusChange {
  revision: number
  paths: readonly string[] | null
}
export type DiffSide = 'staged' | 'unstaged'

/** Diff side to show first for a changed file: unstaged edits win over staged ones. */
export function defaultSideFor(entry: StatusEntry | undefined): DiffSide {
  if (!entry) return 'unstaged'
  if (entry.unstaged || entry.untracked) return 'unstaged'
  if (entry.staged) return 'staged'
  return 'unstaged'
}
