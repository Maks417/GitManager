/** Actions on a commit picked in History: cherry-pick, revert, reset, and tags. */
import type { ResetMode, SequencerOp, SequencerStep } from '@shared/ipc'
import { listConflictFiles } from './merge'
import { assertRevision, assertSha } from './guards'
import { gitOk, runGit } from './shared'

/** Git's own message when a step fails without conflicts; conflicts are returned instead, for the merge editor. */
async function conflictsOrThrow(
  repoPath: string,
  result: { code: number; stderr: string; stdout: string },
  what: string
): Promise<{ conflicts: string[] }> {
  if (result.code === 0) return { conflicts: [] }
  const conflicts = await listConflictFiles(repoPath)
  if (conflicts.length === 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `git ${what} failed (${result.code})`)
  }
  return { conflicts: conflicts.map((c) => c.path) }
}

/** `-m 1` for a merge commit: its changes are taken against its first parent, the branch it was merged into. */
async function mainlineArgs(repoPath: string, sha: string): Promise<string[]> {
  const parents = (await gitOk(repoPath, ['rev-list', '--parents', '-n', '1', sha])).trim().split(/\s+/).slice(1)
  return parents.length > 1 ? ['-m', '1'] : []
}

export async function cherryPickCommit(repoPath: string, sha: string): Promise<{ conflicts: string[] }> {
  assertSha(sha)
  const result = await runGit({
    cwd: repoPath,
    args: ['-c', 'core.editor=true', 'cherry-pick', ...(await mainlineArgs(repoPath, sha)), sha]
  })
  return conflictsOrThrow(repoPath, result, 'cherry-pick')
}

export async function revertCommit(repoPath: string, sha: string): Promise<{ conflicts: string[] }> {
  assertSha(sha)
  const result = await runGit({
    cwd: repoPath,
    args: ['revert', '--no-edit', ...(await mainlineArgs(repoPath, sha)), sha]
  })
  return conflictsOrThrow(repoPath, result, 'revert')
}

/** The cherry-pick or revert that stopped part way (on conflicts or an empty commit), or null. */
export async function getSequencerOp(repoPath: string): Promise<SequencerOp | null> {
  const has = async (ref: string): Promise<boolean> =>
    (await runGit({ cwd: repoPath, args: ['rev-parse', '-q', '--verify', ref] })).code === 0
  if (await has('CHERRY_PICK_HEAD')) return 'cherry-pick'
  if (await has('REVERT_HEAD')) return 'revert'
  return null
}

/** Continue, skip or abort the cherry-pick or revert in progress. */
export async function sequencerStep(repoPath: string, step: SequencerStep): Promise<{ conflicts: string[] }> {
  const op = await getSequencerOp(repoPath)
  if (!op) throw new Error('No cherry-pick or revert is in progress.')
  // The commit message Git prepared is kept as it is: there is no editor to change it in.
  const result = await runGit({ cwd: repoPath, args: ['-c', 'core.editor=true', op, `--${step}`] })
  if (step === 'abort') {
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git ${op} --abort failed`)
    return { conflicts: [] }
  }
  return conflictsOrThrow(repoPath, result, `${op} --${step}`)
}

/** Commits on the current branch after `sha`: a reset to it takes them off the branch. */
export async function countCommitsAfter(repoPath: string, sha: string): Promise<number> {
  assertSha(sha)
  const out = await gitOk(repoPath, ['rev-list', '--count', `${sha}..HEAD`])
  const n = Number(out.trim())
  return Number.isFinite(n) ? n : 0
}

export async function resetToCommit(repoPath: string, sha: string, mode: ResetMode): Promise<void> {
  assertSha(sha)
  await gitOk(repoPath, ['reset', `--${mode}`, sha, '--'])
}

async function assertTagName(repoPath: string, name: string): Promise<void> {
  assertRevision(name, 'tag name')
  const check = await runGit({ cwd: repoPath, args: ['check-ref-format', `refs/tags/${name}`] })
  if (check.code !== 0) throw new Error(`"${name}" is not a valid tag name.`)
}

/** A lightweight tag, or an annotated one when there is a message. */
export async function createTag(repoPath: string, name: string, sha: string, message?: string): Promise<void> {
  assertSha(sha)
  await assertTagName(repoPath, name)
  const exists = await runGit({ cwd: repoPath, args: ['rev-parse', '-q', '--verify', `refs/tags/${name}`] })
  if (exists.code === 0) throw new Error(`A tag named "${name}" already exists.`)
  const text = message?.trim()
  await gitOk(repoPath, text ? ['tag', '-a', '-m', text, name, sha] : ['tag', name, sha])
}

export async function deleteTag(repoPath: string, name: string): Promise<void> {
  await assertTagName(repoPath, name)
  await gitOk(repoPath, ['tag', '-d', name])
}
