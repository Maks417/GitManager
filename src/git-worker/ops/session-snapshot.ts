import { createHash } from 'crypto'
import { basename, normalize } from 'path'
import type { RepoRefreshRequest, RepoSessionSnapshot, Repository } from '@shared/ipc'
import {
  getBranches,
  getRemoteBranches,
  isMergeInProgress,
  isRebaseInProgress
} from './branches'
import { getSequencerOp } from './commits'
import { getGitIdentity } from './identity'
import { inspectRepository } from './repo'
import { getStatus } from './status'
import { currentBranchName, resolveHeadSha, runGit } from './shared'
import { linkedWorktreeMain } from './worktrees'

async function refsFingerprint(repoPath: string): Promise<string> {
  const refs = await runGit({
    cwd: repoPath,
    args: ['for-each-ref', '--format=%(objectname) %(refname)']
  })
  return createHash('sha1').update(refs.stdout).digest('hex')
}

async function slimRepository(repoPath: string, base?: Repository | null): Promise<Repository> {
  const path = normalize(repoPath)
  const [branch, remotesOut, worktreeOf] = await Promise.all([
    currentBranchName(path),
    // Remotes can be edited outside the app; meta snapshots must not preserve a stale cached list.
    runGit({ cwd: path, args: ['remote', '-v'] }),
    base?.worktreeOf !== undefined
      ? Promise.resolve(base.worktreeOf ?? null)
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
    worktreeOf: worktreeOf ?? undefined
  }
}

/**
 * One worker invocation for live status/meta refresh: a single `git status` plus the metadata the
 * renderer needs, without writing repositories.json.
 */
export async function refreshRepoSession(request: RepoRefreshRequest): Promise<RepoSessionSnapshot> {
  const repoPath = normalize(request.repoPath)
  const status = await getStatus(repoPath)

  if (request.scope === 'status') {
    return { status }
  }

  const [branches, remoteBranches, identity, rebaseInProgress, mergeInProgress, sequencerOp, headSha, refsHash] =
    await Promise.all([
      getBranches(repoPath),
      getRemoteBranches(repoPath),
      getGitIdentity(repoPath),
      isRebaseInProgress(repoPath),
      isMergeInProgress(repoPath),
      getSequencerOp(repoPath),
      resolveHeadSha(repoPath),
      refsFingerprint(repoPath)
    ])

  const repository = request.persistRepository
    ? await inspectRepository(repoPath)
    : await slimRepository(repoPath, request.baseRepository)

  if (!request.persistRepository) {
    repository.currentBranch = branches.find((b) => b.current)?.name ?? repository.currentBranch
  }

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
