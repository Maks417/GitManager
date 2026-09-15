import type { FileChange, StatusEntry } from '@shared/ipc'

/** How a file changed: the status a commit lists it with, or a new file Git does not track yet. */
export type FileStatusKind = FileChange['status'] | 'untracked'

/**
 * The status a row in Changes shows. A file can be listed in both sections, so the Staged row shows the index
 * side of its porcelain status and the Changes row the work-tree side: added under Staged, modified under Changes.
 */
export function statusKindFor(entry: StatusEntry, side: 'staged' | 'unstaged'): FileStatusKind {
  if (entry.conflicted) return 'unmerged'
  if (entry.untracked) return 'untracked'
  switch (side === 'staged' ? entry.indexStatus : entry.workTreeStatus) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    case 'U':
      return 'unmerged'
    default:
      return 'modified'
  }
}

const LABELS: Record<FileStatusKind, string> = {
  added: 'Added',
  untracked: 'Untracked',
  modified: 'Modified',
  typechange: 'Type changed',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  unmerged: 'Conflicted'
}

/** The status in words, for tooltips and screen readers; a rename or copy also names the path it came from. */
export function fileStatusLabel(kind: FileStatusKind, oldPath?: string): string {
  const label = LABELS[kind]
  return oldPath && (kind === 'renamed' || kind === 'copied') ? `${label} from ${oldPath}` : label
}
