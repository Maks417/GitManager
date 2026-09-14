import type { BranchInfo, RemoteBranchInfo } from '@shared/ipc'
import { existsSync } from 'fs'
import { isAbsolute, join } from 'path'
import { listConflictFiles } from './merge'
import { assertRevision } from './guards'
import { currentBranchName, gitOk, runGit } from './shared'

export async function getBranches(repoPath: string): Promise<BranchInfo[]> {
  const out = await gitOk(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)',
    'refs/heads'
  ])
  const branches = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, head, upstream, track] = line.split('\0')
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
        behind
      }
    })

  // Unborn branch: no refs/heads yet, but symbolic-ref still names the branch
  if (branches.length === 0) {
    const name = await currentBranchName(repoPath)
    if (name) {
      branches.push({ name, current: true, upstream: null, ahead: 0, behind: 0 })
    }
  }
  return branches
}

export async function getRemoteBranches(repoPath: string): Promise<RemoteBranchInfo[]> {
  const out = await gitOk(repoPath, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'])
  const branches: RemoteBranchInfo[] = []
  for (const line of out.split('\n')) {
    const name = line.trim()
    if (!name || name.endsWith('/HEAD')) continue
    const slash = name.indexOf('/')
    if (slash <= 0) continue
    branches.push({
      name,
      remote: name.slice(0, slash),
      shortName: name.slice(slash + 1)
    })
  }
  return branches
}

export async function fetchRemote(repoPath: string): Promise<void> {
  await gitOk(repoPath, ['fetch', '--prune', '--all'])
}

export async function pullRemote(repoPath: string): Promise<void> {
  await gitOk(repoPath, ['pull', '--ff-only'])
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

/** Maps raw `git push` stderr into actionable UI copy. */
export function friendlyPushError(raw: string): string {
  if (/\[rejected\]/.test(raw)) {
    return 'Push rejected: the remote branch has commits that yours does not (or commits that were already pushed were amended or rebased). Pull first — or force-push from a terminal if you rewrote history on purpose.'
  }
  return raw.trim() || 'Push failed'
}

export async function pushRemote(repoPath: string): Promise<void> {
  const branch = await currentBranchName(repoPath)
  if (!branch) throw new Error('Check out a branch before pushing (HEAD is detached).')
  const upstream = await runGit({
    cwd: repoPath,
    args: ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']
  })
  // A branch created here has no upstream yet: publish it and remember where it went.
  const args =
    upstream.code === 0
      ? ['push']
      : ['push', '--set-upstream', await defaultPushRemote(repoPath), `HEAD:refs/heads/${branch}`]
  const result = await runGit({ cwd: repoPath, args })
  if (result.code !== 0) throw new Error(friendlyPushError(result.stderr || result.stdout))
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

export async function createBranch(repoPath: string, name: string, doCheckout = true): Promise<void> {
  assertRevision(name, 'branch name')
  if (doCheckout) await gitOk(repoPath, ['checkout', '-b', name])
  else await gitOk(repoPath, ['branch', name])
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
