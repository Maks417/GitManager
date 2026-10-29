/** User-facing git messages shared by worker + UI. */

/**
 * The worktree folder from Git's refusal to check out or delete a branch another worktree holds: "already used
 * by worktree at '…'" (Git 2.42+), "already checked out at '…'" (older) or "checked out at '…'" (branch -d).
 */
export function worktreeConflictPath(message: string): string | null {
  const match = /(?:used by worktree|checked out) at '([^']+)'/.exec(message)
  if (!match) return null
  // Git for Windows writes `C:/x/y`; the app names folders as Windows does.
  return /^[a-zA-Z]:\//.test(match[1]) ? match[1].replace(/\//g, '\\') : match[1]
}

/** Oldest Git the app supports: `for-each-ref %(worktreepath)` marks branches other worktrees hold. */
export const MIN_GIT_VERSION = '2.23'

/** Whether `git --version`'s number (`2.45.1.windows.1`, `2.39.3 (Apple Git-146)`) is older than MIN_GIT_VERSION. */
export function isGitTooOld(version: string | null): boolean {
  const match = /^(\d+)\.(\d+)/.exec(version ?? '')
  if (!match) return false
  const [major, minor] = MIN_GIT_VERSION.split('.').map(Number)
  const [have, haveMinor] = [Number(match[1]), Number(match[2])]
  return have < major || (have === major && haveMinor < minor)
}

export const gitTooOldMessage = (version: string): string =>
  `Git ${version} is older than ${MIN_GIT_VERSION}, which Git Manager needs. Some features, such as marking branches checked out in other worktrees, will not work. Update Git from https://git-scm.com/downloads, then restart Git Manager.`

/** Start of the error `removeWorktree` gives for a worktree with changes: removing it anyway needs force. */
export const WORKTREE_HAS_CHANGES = 'The worktree has changes'
export const NOTHING_STAGED_COMMIT =
  'Nothing is staged. Select files under Changes, click Stage or Stage all, then commit.'
