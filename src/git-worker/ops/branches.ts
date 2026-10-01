import type { BranchInfo, RemoteBranchInfo, RemoteOpResult, RemoteProgress } from '@shared/ipc'
import { existsSync } from 'fs'
import { isAbsolute, join } from 'path'
import { GitCancelledError, type GitRunResult } from '../git-runner'
import { throttleProgress } from '../progress'
import { listConflictFiles } from './merge'
import { assertRevision } from './guards'
import { currentBranchName, gitOk, runGit } from './shared'

/** Network operations fail after this long without any output from Git: a stalled network or a silent prompt. */
export const NETWORK_IDLE_TIMEOUT_MS = 5 * 60_000

export interface RemoteOpContext {
  /** Abort to cancel; the operation then resolves `{ outcome: 'cancelled' }`. */
  signal?: AbortSignal
  onProgress?: (progress: RemoteProgress) => void
  /** Overrides NETWORK_IDLE_TIMEOUT_MS (tests). */
  idleTimeoutMs?: number
}

export async function getBranches(repoPath: string): Promise<BranchInfo[]> {
  const out = await gitOk(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)%00%(objectname)',
    'refs/heads'
  ])
  const branches = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line): BranchInfo => {
      const [name, head, upstream, track, sha] = line.split('\0')
      let ahead = 0
      let behind = 0
      const aheadMatch = track?.match(/ahead (\d+)/)
      const behindMatch = track?.match(/behind (\d+)/)
      if (aheadMatch) ahead = Number(aheadMatch[1])
      if (behindMatch) behind = Number(behindMatch[1])
      return {
        name,
        current: head === '*',
        upstream: upstream || null,
        ahead,
        behind,
        sha: sha || null
      }
    })

  // Unborn branch: no refs/heads yet, but symbolic-ref still names the branch
  if (branches.length === 0) {
    const name = await currentBranchName(repoPath)
    if (name) {
      branches.push({ name, current: true, upstream: null, ahead: 0, behind: 0, sha: null })
    }
  }
  return branches
}

export async function getRemoteBranches(repoPath: string): Promise<RemoteBranchInfo[]> {
  const out = await gitOk(repoPath, ['for-each-ref', '--format=%(refname:short)%00%(objectname)', 'refs/remotes'])
  const branches: RemoteBranchInfo[] = []
  for (const line of out.split('\n')) {
    const [name = '', sha = ''] = line.trim().split('\0')
    if (!name || name.endsWith('/HEAD')) continue
    const slash = name.indexOf('/')
    if (slash <= 0) continue
    branches.push({
      name,
      remote: name.slice(0, slash),
      shortName: name.slice(slash + 1),
      sha
    })
  }
  return branches
}

/** Runs a command that talks to a remote: stoppable, with an idle timeout and throttled progress. */
async function runNetwork(repoPath: string, args: string[], ctx: RemoteOpContext): Promise<GitRunResult> {
  const report = ctx.onProgress ? throttleProgress(ctx.onProgress) : undefined
  return runGit({
    cwd: repoPath,
    args,
    signal: ctx.signal,
    idleTimeoutMs: ctx.idleTimeoutMs ?? NETWORK_IDLE_TIMEOUT_MS,
    onProgress: (line) => report?.({ phase: line.phase, percent: line.percent, cancellable: true })
  })
}

async function upstreamOf(repoPath: string): Promise<{ branch: string; hasUpstream: boolean }> {
  const branch = await currentBranchName(repoPath)
  if (!branch) throw new Error('Check out a branch first (HEAD is detached).')
  const upstream = await runGit({
    cwd: repoPath,
    args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']
  })
  return { branch, hasUpstream: upstream.code === 0 }
}

export async function fetchRemote(repoPath: string, ctx: RemoteOpContext = {}): Promise<RemoteOpResult> {
  try {
    const result = await runNetwork(repoPath, ['fetch', '--progress', '--prune', '--all'], ctx)
    if (result.code !== 0) throw new Error(result.stderr.trim() || `git fetch failed (${result.code})`)
    return { outcome: 'done' }
  } catch (err) {
    if (err instanceof GitCancelledError) return { outcome: 'cancelled' }
    throw err
  }
}

/**
 * Fetch the branch's remote (cancellable), then fast-forward to its upstream (not cancellable:
 * stopping a work-tree update half way leaves changed files and a stale index.lock behind).
 */
export async function pullRemote(repoPath: string, ctx: RemoteOpContext = {}): Promise<RemoteOpResult> {
  const { branch, hasUpstream } = await upstreamOf(repoPath)
  if (!hasUpstream) {
    throw new Error(`Branch "${branch}" has no upstream to pull from. Push it first to publish it.`)
  }
  const remote = (await runGit({ cwd: repoPath, args: ['config', '--get', `branch.${branch}.remote`] })).stdout.trim()

  try {
    // An upstream in this repository (remote ".") needs no fetch.
    if (remote && remote !== '.') {
      const fetched = await runNetwork(repoPath, ['fetch', '--progress', '--prune', assertRevision(remote, 'remote')], ctx)
      if (fetched.code !== 0) throw new Error(fetched.stderr.trim() || `git fetch failed (${fetched.code})`)
    }
  } catch (err) {
    if (err instanceof GitCancelledError) return { outcome: 'cancelled' }
    throw err
  }

  ctx.onProgress?.({ phase: 'Updating files', percent: null, cancellable: false })
  const merged = await runGit({
    cwd: repoPath,
    args: ['merge', '--ff-only', '--progress', '@{upstream}'],
    onProgress: (line) => ctx.onProgress?.({ phase: line.phase, percent: line.percent, cancellable: false })
  })
  if (merged.code !== 0) {
    if (/not possible to fast-forward/i.test(merged.stderr)) {
      // Both sides have commits: the caller asks whether to merge or rebase.
      const upstream = (await gitOk(repoPath, ['rev-parse', '--symbolic-full-name', '@{upstream}'])).trim()
      return { outcome: 'diverged', branch, upstream }
    }
    throw new Error(merged.stderr.trim() || merged.stdout.trim() || `git merge failed (${merged.code})`)
  }
  return { outcome: 'done' }
}

/** Remote for a branch that has no upstream yet: `origin` if present, else the only remote. */
async function defaultPushRemote(repoPath: string): Promise<string> {
  const remotes = (await gitOk(repoPath, ['remote']))
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
  if (remotes.includes('origin')) return 'origin'
  if (remotes.length === 1) return remotes[0]
  throw new Error(
    remotes.length === 0
      ? 'This repository has no remote to push to.'
      : `This branch has no upstream and there are several remotes (${remotes.join(', ')}). Set one from a terminal with git push -u <remote>.`
  )
}

/** A ref Git refused to update: a non-fast-forward push, or a force push whose lease no longer holds. */
const REJECTED_RE = /^\s*! \[rejected\]/m

/** Maps raw `git push` stderr into actionable UI copy. */
export function friendlyPushError(raw: string, force = false): string {
  if (force && REJECTED_RE.test(raw)) {
    return 'Force push stopped: the remote branch changed since your last fetch, so it would have overwritten commits you have not seen. Fetch, look at what is new, then decide again.'
  }
  return raw.trim() || 'Push failed'
}

/**
 * Push the current branch. A push the remote rejects because it has commits this branch lacks resolves
 * `rejected`, for the caller to offer a pull or a force push.
 */
export async function pushRemote(repoPath: string, ctx: RemoteOpContext = {}): Promise<RemoteOpResult> {
  return pushBranch(repoPath, false, ctx)
}

/**
 * Overwrite the remote branch with this one, but only if it is still where the last fetch saw it
 * (`--force-with-lease`) and that state was integrated here (`--force-if-includes`, Git 2.30+).
 */
export async function forcePushRemote(repoPath: string, ctx: RemoteOpContext = {}): Promise<RemoteOpResult> {
  return pushBranch(repoPath, true, ctx)
}

async function pushBranch(repoPath: string, force: boolean, ctx: RemoteOpContext): Promise<RemoteOpResult> {
  const branch = await currentBranchName(repoPath)
  if (!branch) throw new Error('Check out a branch before pushing (HEAD is detached).')
  const upstream = await runGit({
    cwd: repoPath,
    args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']
  })
  // A branch created here has no upstream yet: publish it and remember where it went.
  const target =
    upstream.code === 0 ? [] : ['--set-upstream', await defaultPushRemote(repoPath), `HEAD:refs/heads/${branch}`]
  const forceArgs = force ? ['--force-with-lease', '--force-if-includes'] : []
  try {
    let result = await runNetwork(repoPath, ['push', '--progress', ...forceArgs, ...target], ctx)
    if (force && result.code !== 0 && /unknown option.*force-if-includes/i.test(result.stderr)) {
      result = await runNetwork(repoPath, ['push', '--progress', '--force-with-lease', ...target], ctx)
    }
    if (result.code !== 0) {
      const raw = result.stderr || result.stdout
      if (!force && REJECTED_RE.test(raw)) return { outcome: 'rejected', branch }
      throw new Error(friendlyPushError(raw, force))
    }
  } catch (err) {
    if (err instanceof GitCancelledError) return { outcome: 'cancelled' }
    throw err
  }
  await assertPushLanded(repoPath, branch)
  return { outcome: 'done' }
}

/**
 * `git push` also exits 0 when it sent nothing ("Everything up-to-date"), e.g. when push.default sends the
 * branch to a ref other than its upstream. Commits the upstream still lacks afterwards did not land.
 */
async function assertPushLanded(repoPath: string, branch: string): Promise<void> {
  const remote = (await runGit({ cwd: repoPath, args: ['config', '--get', `branch.${branch}.remote`] })).stdout.trim()
  // A push refspec sends commits elsewhere on purpose (refs/for/<branch> for code review, say).
  const pushSpecs = remote
    ? (await runGit({ cwd: repoPath, args: ['config', '--get-all', `remote.${remote}.push`] })).stdout.trim()
    : ''
  if (pushSpecs) return
  const ahead = await runGit({ cwd: repoPath, args: ['rev-list', '--count', '@{upstream}..HEAD'] })
  const count = Number(ahead.stdout.trim())
  if (ahead.code !== 0 || !Number.isFinite(count) || count === 0) return
  throw new Error(
    `The push finished, but ${count} commit${count === 1 ? '' : 's'} on "${branch}" did not reach its upstream. ` +
      `Check where this branch pushes (push.default and remote.${remote || '<name>'}.push), then push again.`
  )
}

export async function checkoutRef(repoPath: string, ref: string): Promise<void> {
  // Trailing `--` forces `ref` to be a revision. Without it, a name that is not a ref but matches
  // a path makes Git restore those files and silently discard uncommitted changes.
  await gitOk(repoPath, ['checkout', assertRevision(ref), '--'])
}

export async function checkoutRemoteBranch(repoPath: string, remoteRef: string): Promise<void> {
  assertRevision(remoteRef, 'remote branch')
  const slash = remoteRef.indexOf('/')
  if (slash <= 0) throw new Error(`Invalid remote branch ref: ${remoteRef}`)
  const shortName = remoteRef.slice(slash + 1)
  const locals = await getBranches(repoPath)
  if (locals.some((b) => b.name === shortName)) {
    await checkoutRef(repoPath, shortName)
    return
  }
  await gitOk(repoPath, ['checkout', '--track', remoteRef])
}

/** A branch at HEAD, or at `startPoint` (a commit picked in History). */
export async function createBranch(
  repoPath: string,
  name: string,
  doCheckout = true,
  startPoint?: string
): Promise<void> {
  assertRevision(name, 'branch name')
  const at = startPoint ? [assertRevision(startPoint, 'start point')] : []
  if (doCheckout) await gitOk(repoPath, ['checkout', '-b', name, ...at])
  else await gitOk(repoPath, ['branch', name, ...at])
}

/** Push one tag to the default push remote, or delete it there. */
export async function pushTag(
  repoPath: string,
  name: string,
  remove: boolean,
  ctx: RemoteOpContext = {}
): Promise<RemoteOpResult> {
  assertRevision(name, 'tag name')
  const remote = await defaultPushRemote(repoPath)
  const refspec = remove ? `:refs/tags/${name}` : `refs/tags/${name}:refs/tags/${name}`
  try {
    const result = await runNetwork(repoPath, ['push', '--progress', remote, refspec], ctx)
    if (result.code !== 0) {
      const raw = result.stderr || result.stdout
      if (/\[rejected\]|already exists/.test(raw)) {
        throw new Error(`The remote already has a different tag "${name}". Delete it there first, or pick another name.`)
      }
      throw new Error(raw.trim() || `git push failed (${result.code})`)
    }
  } catch (err) {
    if (err instanceof GitCancelledError) return { outcome: 'cancelled' }
    throw err
  }
  return { outcome: 'done' }
}

export async function mergeRef(repoPath: string, ref: string): Promise<{ conflicts: string[] }> {
  const result = await runGit({ cwd: repoPath, args: ['merge', '--no-edit', assertRevision(ref)] })
  if (result.code === 0) return { conflicts: [] }
  const conflicts = await listConflictFiles(repoPath)
  if (conflicts.length === 0) {
    throw new Error(result.stderr || result.stdout || `git merge failed (${result.code})`)
  }
  return { conflicts: conflicts.map((c) => c.path) }
}

async function rebaseResult(
  repoPath: string,
  result: { code: number; stderr: string; stdout: string }
): Promise<{ conflicts: string[] }> {
  if (result.code === 0) return { conflicts: [] }
  const conflicts = await listConflictFiles(repoPath)
  if (conflicts.length === 0) {
    throw new Error(result.stderr || result.stdout || `git rebase failed (${result.code})`)
  }
  return { conflicts: conflicts.map((c) => c.path) }
}

export async function rebaseOnto(repoPath: string, upstream: string): Promise<{ conflicts: string[] }> {
  const result = await runGit({ cwd: repoPath, args: ['rebase', assertRevision(upstream)] })
  return rebaseResult(repoPath, result)
}

export async function rebaseContinue(repoPath: string): Promise<{ conflicts: string[] }> {
  const result = await runGit({
    cwd: repoPath,
    args: ['-c', 'core.editor=true', 'rebase', '--continue']
  })
  return rebaseResult(repoPath, result)
}

export async function rebaseAbort(repoPath: string): Promise<void> {
  await gitOk(repoPath, ['rebase', '--abort'])
}

/** Drop the commit the rebase stopped on (e.g. it became empty after resolving) and continue. */
export async function rebaseSkip(repoPath: string): Promise<{ conflicts: string[] }> {
  const result = await runGit({ cwd: repoPath, args: ['-c', 'core.editor=true', 'rebase', '--skip'] })
  return rebaseResult(repoPath, result)
}

export async function isMergeInProgress(repoPath: string): Promise<boolean> {
  const result = await runGit({ cwd: repoPath, args: ['rev-parse', '-q', '--verify', 'MERGE_HEAD'] })
  return result.code === 0
}

export async function mergeAbort(repoPath: string): Promise<void> {
  await gitOk(repoPath, ['merge', '--abort'])
}

export async function isRebaseInProgress(repoPath: string): Promise<boolean> {
  const mergePath = (await gitOk(repoPath, ['rev-parse', '--git-path', 'rebase-merge'])).trim()
  const applyPath = (await gitOk(repoPath, ['rev-parse', '--git-path', 'rebase-apply'])).trim()
  const resolve = (p: string): string => (isAbsolute(p) ? p : join(repoPath, p))
  return existsSync(resolve(mergePath)) || existsSync(resolve(applyPath))
}

export async function deleteBranch(repoPath: string, name: string, force = false): Promise<void> {
  assertRevision(name, 'branch name')
  const branches = await getBranches(repoPath)
  const current = branches.find((b) => b.current)
  if (current?.name === name) throw new Error('Cannot delete the current branch')
  await gitOk(repoPath, ['branch', force ? '-D' : '-d', name])
}
