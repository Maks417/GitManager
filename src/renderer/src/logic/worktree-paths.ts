import type { Repository } from '@shared/ipc'

// As lib/paths, which this logic (also compiled for the tests) cannot import.
function sameRepoPath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

function joinDisplayPath(parent: string, name: string): string {
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]+$/, '')}${separator}${name}`
}

/** The last part of a folder path, either separator. */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1)
}

/** The folder holding `path`, or `path` itself at a drive or file-system root. */
export function parentFolder(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (cut <= 0) return cut === 0 ? trimmed.slice(0, 1) : trimmed
  const parent = trimmed.slice(0, cut)
  // `C:` alone means the drive's current folder; keep its root.
  return /^[a-zA-Z]:$/.test(parent) ? `${parent}${trimmed[cut]}` : parent
}

/** A folder name for a branch or commit: `/` and other characters folders cannot hold become `-`. */
export function worktreeFolderSlug(label: string): string {
  return label.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'
}

/** Next to the main work tree, named after it and the branch: `C:\code\app` + `feature/x` → `C:\code\app-feature-x`. */
export function defaultWorktreeFolder(mainPath: string, label: string, parent = parentFolder(mainPath)): string {
  return joinDisplayPath(parent, `${folderName(mainPath)}-${worktreeFolderSlug(label)}`)
}

export interface RepoListRow {
  repo: Repository
  /** 1 for a worktree listed under its main repository. */
  depth: number
}

/**
 * The repository list with each linked worktree right after its main repository, which keeps its place.
 * Worktrees whose main repository is not listed stay where they are.
 */
export function orderRepos(repos: readonly Repository[]): RepoListRow[] {
  const isListedMain = (repo: Repository): boolean =>
    Boolean(repo.worktreeOf) && repos.some((other) => other !== repo && sameRepoPath(other.path, repo.worktreeOf))
  const rows: RepoListRow[] = []
  for (const repo of repos) {
    if (isListedMain(repo)) continue
    rows.push({ repo, depth: 0 })
    for (const linked of repos) {
      if (linked !== repo && isListedMain(linked) && sameRepoPath(linked.worktreeOf, repo.path)) rows.push({ repo: linked, depth: 1 })
    }
  }
  return rows
}
