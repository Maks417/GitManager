import type { StatusEntry } from '@shared/ipc'
import { NOTHING_STAGED_COMMIT } from '@shared/git-messages'
import { gitOk, resolveHeadSha, runGit } from './shared'

export async function getStatus(
  repoPath: string,
  untracked: 'normal' | 'all' = 'normal'
): Promise<StatusEntry[]> {
  const out = await gitOk(repoPath, [
    'status',
    '--porcelain=v2',
    '-z',
    `--untracked-files=${untracked}`
  ])
  // -z: records are NUL-terminated with raw paths; a rename record is followed by its original path.
  const records = out.split('\0')
  const entries: StatusEntry[] = []

  for (let i = 0; i < records.length; i++) {
    const line = records[i]
    if (!line) continue
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1]
      const path = parts.slice(line.startsWith('2 ') ? 9 : 8).join(' ')
      if (line.startsWith('2 ')) i++ // skip the original-path record
      const indexStatus = xy[0]
      const workTreeStatus = xy[1]
      entries.push({
        path,
        indexStatus,
        workTreeStatus,
        staged: indexStatus !== '.',
        unstaged: workTreeStatus !== '.',
        untracked: false,
        conflicted: false
      })
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ')
      entries.push({
        path,
        indexStatus: 'U',
        workTreeStatus: 'U',
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: true
      })
    } else if (line.startsWith('? ')) {
      entries.push({
        path: line.slice(2),
        indexStatus: '?',
        workTreeStatus: '?',
        staged: false,
        unstaged: true,
        untracked: true,
        conflicted: false
      })
    }
  }
  return entries
}

/** The subset of repo-relative `paths` that Git ignores. Tracked files are never reported. */
export async function filterIgnoredPaths(repoPath: string, paths: string[]): Promise<string[]> {
  if (!paths.length) return []
  const result = await runGit({
    cwd: repoPath,
    args: ['check-ignore', '-z', '--stdin'],
    input: `${paths.join('\0')}\0`
  })
  // Exit 1 means none of the paths are ignored; anything higher is an error.
  if (result.code > 1) throw new Error(result.stderr || `git check-ignore failed (${result.code})`)
  return result.stdout.split('\0').filter(Boolean)
}

/** Split pathspecs so each command line stays far below Windows' 32,767-character limit. */
export function chunkPaths(paths: string[], maxChars = 8000): string[][] {
  const chunks: string[][] = []
  let current: string[] = []
  let length = 0
  for (const path of paths) {
    if (current.length > 0 && length + path.length + 3 > maxChars) {
      chunks.push(current)
      current = []
      length = 0
    }
    current.push(path)
    length += path.length + 3
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

async function gitForPaths(repoPath: string, args: string[], paths: string[]): Promise<void> {
  for (const chunk of chunkPaths(paths)) {
    await gitOk(repoPath, ['--literal-pathspecs', ...args, '--', ...chunk])
  }
}

export async function stagePaths(repoPath: string, paths: string[]): Promise<void> {
  await gitForPaths(repoPath, ['add'], paths)
}

export async function unstagePaths(repoPath: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  // `git restore --staged` needs a commit; unborn repos (no HEAD) must use rm --cached.
  const head = await resolveHeadSha(repoPath)
  if (head) await gitForPaths(repoPath, ['restore', '--staged'], paths)
  else await gitForPaths(repoPath, ['rm', '--cached', '-f', '-q'], paths)
}

/** Restore tracked files in the work tree from the index (Discard for tracked changes). */
export async function restoreWorktree(repoPath: string, paths: string[]): Promise<void> {
  await gitForPaths(repoPath, ['restore', '--worktree'], paths)
}

/**
 * Decide what Discard does per selected path: tracked paths are restored from the index, untracked
 * files and folders (e.g. `dir/`) are removed, and conflicted paths are left for the merge editor.
 */
export async function planDiscard(
  repoPath: string,
  paths: string[]
): Promise<{ restore: string[]; remove: string[]; conflicted: string[] }> {
  const tracked = new Set<string>()
  const unmerged = new Set<string>()
  for (const chunk of chunkPaths(paths)) {
    const args = ['--literal-pathspecs', 'ls-files', '-z']
    for (const file of (await gitOk(repoPath, [...args, '--', ...chunk])).split('\0')) {
      if (file) tracked.add(file)
    }
    for (const record of (await gitOk(repoPath, [...args, '-u', '--', ...chunk])).split('\0')) {
      const m = /\t([\s\S]+)$/.exec(record)
      if (m) unmerged.add(m[1])
    }
  }
  const covers = (files: Set<string>, path: string): boolean =>
    files.has(path) || (path.endsWith('/') && [...files].some((f) => f.startsWith(path)))

  const plan = { restore: [] as string[], remove: [] as string[], conflicted: [] as string[] }
  for (const path of paths) {
    if (covers(unmerged, path)) plan.conflicted.push(path)
    else if (covers(tracked, path)) plan.restore.push(path)
    else plan.remove.push(path)
  }
  return plan
}

/** Maps raw `git commit` stderr into actionable UI copy. */
export function friendlyCommitError(raw: string, amend = false): string {
  if (/no changes added to commit|nothing added to commit/i.test(raw)) {
    return NOTHING_STAGED_COMMIT
  }
  if (/nothing to commit/i.test(raw)) {
    if (amend) return 'Nothing to amend — stage changes or edit the message and try again.'
    return 'Nothing to commit — the working tree is clean.'
  }
  return raw.trim() || 'Commit failed'
}

export async function commit(repoPath: string, message: string, amend = false): Promise<string> {
  const args = ['commit', '-m', message]
  if (amend) args.push('--amend')
  try {
    await gitOk(repoPath, args)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    throw new Error(friendlyCommitError(raw, amend))
  }
  const sha = await resolveHeadSha(repoPath)
  if (!sha) throw new Error('Commit succeeded but HEAD could not be resolved')
  return sha
}
