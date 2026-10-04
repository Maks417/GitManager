import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { copyFile, rm } from 'fs/promises'
import { join } from 'path'
import type { RecoveryEntry } from '@shared/ipc'
import { assertSha } from './guards'
import { getGitDirs, gitOk, resolveHeadSha, runGit } from './shared'

const PREFIX = 'refs/git-manager/recovery/'
const SAVED_REF = /^refs\/git-manager\/recovery\/(\d{13})-(commit|worktree)-[0-9a-f-]{36}$/

async function saveRef(repoPath: string, sha: string, kind: RecoveryEntry['kind'], label: string): Promise<void> {
  const ref = `${PREFIX}${Date.now()}-${kind}-${randomUUID()}`
  await gitOk(repoPath, ['update-ref', '--create-reflog', '-m', label.replace(/[\r\n]/g, ' '), ref, assertSha(sha)])
}

/** Keep the old commit reachable even after its branch/reflog disappears. */
export async function saveCommitRecovery(repoPath: string, label: string, sha?: string): Promise<void> {
  const commit = sha ?? await resolveHeadSha(repoPath)
  if (commit) await saveRef(repoPath, commit, 'commit', label)
}

/** Stash-shaped snapshot without changing the index, work tree or user's stash list. */
export async function saveWorktreeRecovery(repoPath: string, label: string): Promise<void> {
  const head = await resolveHeadSha(repoPath)
  if (!head) {
    throw new Error('Create the first commit before discarding tracked edits so a recovery backup can be saved. To discard a new staged file, unstage it first and move it to the Trash from Changes.')
  }
  const unmerged = await gitOk(repoPath, ['ls-files', '-u', '-z'])
  if (unmerged) {
    // stash create refuses an unmerged index. Use a private index to preserve file content and
    // every ordinary staged entry; unresolved stages are represented by HEAD in the saved index.
    const paths = [...new Set(unmerged.split('\0').filter(Boolean).map((record) => record.slice(record.indexOf('\t') + 1)))]
    const { gitDir } = await getGitDirs(repoPath)
    const index = join(gitDir, `git-manager-recovery-index-${randomUUID()}`)
    const run = async (args: string[]): Promise<string> => {
      const result = await runGit({ cwd: repoPath, args: ['-c', 'user.name=Git Manager', '-c', 'user.email=recovery@git-manager.local', ...args], env: { GIT_INDEX_FILE: index } })
      if (result.code !== 0) throw new Error(result.stderr.trim() || 'Could not save the recovery snapshot.')
      return result.stdout.trim()
    }
    try {
      await copyFile(join(gitDir, 'index'), index)
      for (const path of paths) await run(['--literal-pathspecs', 'reset', '-q', head, '--', path])
      const indexTree = await run(['write-tree'])
      const indexCommit = await run(['commit-tree', indexTree, '-p', head, '-m', label])
      await run(['add', '-u', '--', '.'])
      const tree = await run(['write-tree'])
      const snapshot = await run(['commit-tree', tree, '-p', head, '-p', indexCommit, '-m', label])
      await saveRef(repoPath, snapshot, 'worktree', `${label} (unresolved index stages excluded)`)
    } finally {
      // Only the two private files created for this snapshot; never the real index or its lock.
      await Promise.allSettled([rm(index, { force: true }), rm(`${index}.lock`, { force: true })])
    }
    return
  }
  const sha = (await gitOk(repoPath, [
    '-c', 'user.name=Git Manager', '-c', 'user.email=recovery@git-manager.local',
    'stash', 'create', label
  ])).trim()
  if (sha) await saveRef(repoPath, sha, 'worktree', label)
}

export async function getRecoveryEntries(repoPath: string): Promise<RecoveryEntry[]> {
  const refs = (await gitOk(repoPath, [
    'for-each-ref', '--sort=-refname', '--count=50', '--format=%(refname)%00%(objectname)', PREFIX
  ])).trim().split(/\r?\n/).filter(Boolean)
  const saved: RecoveryEntry[] = []
  // Bound simultaneous Git processes when a repository has many saved backups.
  for (let offset = 0; offset < refs.length; offset += 5) {
    const batch = await Promise.all(refs.slice(offset, offset + 5).map(async (line) => {
      const [id, sha] = line.split('\0')
      const match = SAVED_REF.exec(id)
      if (!match) return null
      const label = (await gitOk(repoPath, ['reflog', 'show', '-1', '--format=%gs', id])).trim()
      return { id, sha, kind: match[2] as RecoveryEntry['kind'], label: label || 'Saved backup', createdAt: new Date(Number(match[1])).toISOString(), saved: true }
    }))
    for (const entry of batch) if (entry) saved.push(entry)
  }
  const log = await runGit({ cwd: repoPath, args: ['reflog', 'show', '-100', '--date=iso-strict', '--format=%H%x00%gD%x00%gs', 'HEAD'] })
  const recent: RecoveryEntry[] = log.code === 0 ? log.stdout.trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [sha, selector, label] = line.split('\0')
    return { id: selector, sha, kind: 'commit', label, createdAt: /@\{(.+)\}$/.exec(selector)?.[1] ?? '', saved: false }
  }) : []
  return [...saved, ...recent]
}

function assertSavedRef(id: string): RegExpExecArray {
  const match = SAVED_REF.exec(id)
  if (!match) throw new Error('This is not a Git Manager recovery backup.')
  return match
}

/** Refuse to replace current work: restoration requires a clean index and work tree. */
export async function restoreRecovery(repoPath: string, id: string): Promise<void> {
  if (assertSavedRef(id)[2] !== 'worktree') throw new Error('Recover this commit by creating a branch at it.')
  const { gitDir } = await getGitDirs(repoPath)
  if (['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply'].some((name) => existsSync(join(gitDir, name)))) {
    throw new Error('Finish or abort the operation in progress before restoring a backup.')
  }
  const status = await gitOk(repoPath, ['status', '--porcelain=v2', '--untracked-files=all'])
  if (status.trim()) throw new Error('Commit or stash your current changes, including untracked files, before restoring a backup.')
  const sha = assertSha((await gitOk(repoPath, ['rev-parse', '--verify', id])).trim())
  await gitOk(repoPath, ['stash', 'apply', '--index', sha])
}

export async function deleteRecovery(repoPath: string, id: string): Promise<void> {
  assertSavedRef(id)
  await gitOk(repoPath, ['update-ref', '-d', id])
}
