import type { StatusEntry } from '@shared/ipc'
import { NOTHING_STAGED_COMMIT } from '@shared/git-messages'
import { gitOk, resolveHeadSha } from './shared'

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
  // porcelain v2 with -z uses NUL separators; without reliable NUL over string, also support newline fallback
  const chunks = out.includes('\0') ? out.split('\0') : out.split('\n')
  const entries: StatusEntry[] = []

  for (const chunk of chunks) {
    const line = chunk.trim()
    if (!line) continue
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1]
      const path = line.startsWith('2 ')
        ? parts.slice(9).join(' ').split('\t').pop() || ''
        : parts.slice(8).join(' ')
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

export async function stagePaths(repoPath: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await gitOk(repoPath, ['add', '--', ...paths])
}

export async function unstagePaths(repoPath: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  // `git restore --staged` needs a commit; unborn repos (no HEAD) must use rm --cached.
  const head = await resolveHeadSha(repoPath)
  if (head) {
    await gitOk(repoPath, ['restore', '--staged', '--', ...paths])
    return
  }
  await gitOk(repoPath, ['rm', '--cached', '-f', '--', ...paths])
}

export async function discardPaths(repoPath: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await gitOk(repoPath, ['restore', '--worktree', '--', ...paths])
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
