import { createHash } from 'crypto'
import { existsSync } from 'fs'
import { basename, join, normalize } from 'path'
import type { RepoRefreshRequest, RepoSessionSnapshot, Repository, SequencerOp } from '@shared/ipc'
import { getBranches, getRemoteBranches } from './branches'
import { getGitIdentity } from './identity'
import { inspectRepository } from './repo'
import { getStatus } from './status'
import { currentBranchName, getGitDirs, resolveHeadSha, runGit } from './shared'
import { linkedWorktreeMain } from './worktrees'

async function refsFingerprint(repoPath: string): Promise<string> {
  const refs = await runGit({
    cwd: repoPath,
    args: ['for-each-ref', '--format=%(objectname) %(refname)']
  })
  return createHash('sha1').update(refs.stdout).digest('hex')
}

/**
 * A merge, rebase, cherry-pick or revert in progress, from the files Git keeps for it in the work tree's
 * git directory: the same files `isMergeInProgress`, `isRebaseInProgress` and `getSequencerOp` look for,
 * without starting a Git process for each.
 */
function operationsInProgress(gitDir: string): {
  rebaseInProgress: boolean
  mergeInProgress: boolean
  sequencerOp: SequencerOp | null
} {
  const has = (name: string): boolean => existsSync(join(gitDir, name))
  return {
    rebaseInProgress: has('rebase-merge') || has('rebase-apply'),
    mergeInProgress: has('MERGE_HEAD'),
    sequencerOp: has('CHERRY_PICK_HEAD') ? 'cherry-pick' : has('REVERT_HEAD') ? 'revert' : null
  }
}

async function slimRepository(repoPath: string, branch: string | null, base?: Repository | null): Promise<Repository> {
  const path = normalize(repoPath)
  const [remotesOut, worktreeOf] = await Promise.all([
    // Remotes can be edited outside the app; meta snapshots must not preserve a stale cached list.
    runGit({ cwd: path, args: ['remote', '-v'] }),
    // Known once looked up: null for a repository that is not a linked worktree.
    base?.worktreeOf !== undefined
      ? Promise.resolve(base.worktreeOf)
      : linkedWorktreeMain(path).catch(() => null)
  ])
  const map = new Map<string, string>()
  for (const line of remotesOut.stdout.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/)
    if (m) map.set(m[1], m[2])
  }
  const remotes = [...map.entries()].map(([name, url]) => ({ name, url }))
  return {
    id: base?.id ?? path,
    name: base?.name ?? basename(path),
    path,
    currentBranch: branch,
    remotes,
    worktreeOf
  }
}

/**
 * One worker invocation for live status/meta refresh: a single `git status` plus the metadata the
 * renderer needs, without writing repositories.json.
 */
export async function refreshRepoSession(request: RepoRefreshRequest): Promise<RepoSessionSnapshot> {
  const repoPath = normalize(request.repoPath)
  if (request.scope === 'status') {
    return { status: await getStatus(repoPath) }
  }

  const [status, { gitDir }, branches, remoteBranches, identity, headSha, refsHash] = await Promise.all([
    getStatus(repoPath),
    getGitDirs(repoPath),
    getBranches(repoPath),
    getRemoteBranches(repoPath),
    getGitIdentity(repoPath),
    resolveHeadSha(repoPath),
    refsFingerprint(repoPath)
  ])
  const { rebaseInProgress, mergeInProgress, sequencerOp } = operationsInProgress(gitDir)

  const repository = request.persistRepository
    ? await inspectRepository(repoPath)
    : await slimRepository(
        repoPath,
        // An unborn branch (no commits yet) has no ref to list; HEAD still names it.
        branches.find((b) => b.current)?.name ?? (await currentBranchName(repoPath)),
        request.baseRepository
      )

  const historyFingerprint = createHash('sha1')
    .update(headSha ?? '')
    .update('\0')
    .update(refsHash)
    .update('\0')
    .update(rebaseInProgress ? '1' : '0')
    .update(mergeInProgress ? '1' : '0')
    .update(sequencerOp ?? '')
    .digest('hex')

  return {
    repository,
    status,
    branches,
    remoteBranches,
    identity,
    rebaseInProgress,
    mergeInProgress,
    sequencerOp,
    headSha,
    historyFingerprint
  }
}
