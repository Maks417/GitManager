import { branchGlob } from '@shared/branch-search'

/** A folder of branches sharing a `prefix/` (for remote branches, a remote is the top folder). */
export interface BranchFolderRow {
  kind: 'folder'
  /** The folder's path, `feature` or `origin/feature`. */
  key: string
  label: string
  depth: number
  /** Branches anywhere below it. */
  count: number
  open: boolean
}

export interface BranchLeafRow {
  kind: 'branch'
  key: string
  /** Full branch name, `feature/login` or `origin/feature/login`. */
  name: string
  /** What the row shows: the last part of the name in a folder, the whole name in filter results. */
  label: string
  depth: number
  /** Parts of `label` the filter matched, as [start, end) pairs. */
  match?: [number, number][]
}

export type BranchRow = BranchFolderRow | BranchLeafRow

interface FolderNode {
  folders: Map<string, FolderNode>
  leaves: string[]
  count: number
}

const newNode = (): FolderNode => ({ folders: new Map(), leaves: [], count: 0 })

/** Folders holding `name`: `a` and `a/b` for `a/b/c`. */
export function folderChain(name: string): string[] {
  const parts = name.split('/')
  return parts.slice(1).map((_part, i) => parts.slice(0, i + 1).join('/'))
}

/**
 * The visible rows of a branch tree: names are split into folders at `/`, each folder lists its folders
 * before its branches, and both keep the order of `names` (for-each-ref's). Rows below a closed folder are
 * left out, so the list stays one flat array a roving focus can walk.
 */
export function buildBranchRows(names: readonly string[], isOpen: (key: string) => boolean): BranchRow[] {
  const root = newNode()
  for (const name of names) {
    const parts = name.split('/')
    let node = root
    node.count++
    for (const part of parts.slice(0, -1)) {
      let child = node.folders.get(part)
      if (!child) {
        child = newNode()
        node.folders.set(part, child)
      }
      node = child
      node.count++
    }
    node.leaves.push(name)
  }

  const rows: BranchRow[] = []
  const walk = (node: FolderNode, prefix: string, depth: number): void => {
    for (const [label, child] of node.folders) {
      const key = prefix ? `${prefix}/${label}` : label
      const open = isOpen(key)
      rows.push({ kind: 'folder', key, label, depth, count: child.count, open })
      if (open) walk(child, key, depth + 1)
    }
    for (const name of node.leaves) {
      rows.push({ kind: 'branch', key: name, name, label: name.slice(name.lastIndexOf('/') + 1), depth })
    }
  }
  walk(root, '', 0)
  return rows
}

/** Most filter results a list renders; the rest are counted. */
export const BRANCH_FILTER_LIMIT = 500

export interface BranchFilterResult {
  rows: BranchLeafRow[]
  /** Every matching branch, rendered or not. */
  total: number
}

/**
 * Branches whose name contains every word of `query`, case-insensitively, with the matched parts marked.
 * A query with `*` or `?` is a glob instead (`feature/*`, `*login*`), matched against the whole name and
 * against the name without its remote.
 */
export function filterBranchNames(
  query: string,
  names: readonly string[],
  remoteOf: (name: string) => string | null = () => null,
  limit = BRANCH_FILTER_LIMIT
): BranchFilterResult {
  const rows: BranchLeafRow[] = []
  let total = 0
  const trimmed = query.trim()
  const keep = (name: string, match?: [number, number][]): void => {
    total++
    if (rows.length < limit) rows.push({ kind: 'branch', key: name, name, label: name, depth: 0, match })
  }

  if (/[*?]/.test(trimmed)) {
    const glob = branchGlob(trimmed)
    for (const name of names) {
      const remote = remoteOf(name)
      if (glob.test(name) || (remote !== null && glob.test(name.slice(remote.length + 1)))) keep(name)
    }
    return { rows, total }
  }

  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  for (const name of names) {
    const lower = name.toLowerCase()
    const match: [number, number][] = []
    let all = true
    for (const word of words) {
      const at = lower.indexOf(word)
      if (at < 0) {
        all = false
        break
      }
      match.push([at, at + word.length])
    }
    if (all) keep(name, mergeRanges(match))
  }
  return { rows, total }
}

/** Sorted, overlapping or touching ranges joined, so each character is marked once. */
function mergeRanges(ranges: [number, number][]): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const [start, end] of sorted) {
    const last = merged[merged.length - 1]
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }
  return merged
}
