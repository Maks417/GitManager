import { existsSync, readdirSync, statSync } from 'fs'
import { mkdir, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, dirname, join, normalize } from 'path'
import type { CloneResult, CreateRepoResult, Repository } from '@shared/ipc'
import { GitCancelledError, isGitRepo, runGit, type GitRunResult } from '../git-runner'
import { throttleProgress } from '../progress'
import { NETWORK_IDLE_TIMEOUT_MS, type RemoteOpContext } from './branches'
import { currentBranchName, gitOk } from './shared'
import { linkedWorktreeMain } from './worktrees'

export { getGitDirs } from './shared'

/** Work-tree root for `path`, which may be the root itself or any folder inside it. */
async function workTreeRoot(path: string): Promise<string> {
  if (isGitRepo(path)) return path
  const result = await runGit({ cwd: path, args: ['rev-parse', '--show-toplevel'] }).catch(() => null)
  const top = result?.code === 0 ? result.stdout.trim() : ''
  if (!top) throw new Error(`Not a git repository: ${path}`)
  return normalize(top)
}

export async function inspectRepository(requestedPath: string): Promise<Repository> {
  const path = await workTreeRoot(requestedPath)
  const [branch, remotesOut, worktreeOf] = await Promise.all([
    currentBranchName(path),
    runGit({ cwd: path, args: ['remote', '-v'] }),
    linkedWorktreeMain(path).catch(() => null)
  ])
  const remotes = new Map<string, string>()
  for (const line of remotesOut.stdout.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/)
    if (m) remotes.set(m[1], m[2])
  }
  return {
    id: path,
    name: basename(path),
    path,
    currentBranch: branch,
    remotes: [...remotes.entries()].map(([name, url]) => ({ name, url })),
    worktreeOf
  }
}

/** Work tree that contains `path`, or null when none does. */
export async function getEnclosingWorkTree(path: string): Promise<string | null> {
  if (!existsSync(path)) return null
  const result = await runGit({ cwd: path, args: ['rev-parse', '--show-toplevel'] }).catch(() => null)
  const top = result?.code === 0 ? result.stdout.trim() : ''
  return top ? normalize(top) : null
}

/** Git's `init.defaultBranch` for new repositories, else `main`. */
export async function getDefaultBranchName(): Promise<string> {
  const result = await runGit({ cwd: tmpdir(), args: ['config', '--get', 'init.defaultBranch'] })
  return (result.code === 0 && result.stdout.trim()) || 'main'
}

/** Removes what an interrupted clone or init left in `target`, which was missing or an empty folder before. */
async function removeLeftovers(target: string, existedBefore: boolean): Promise<void> {
  // Files of a stopped process tree can stay locked for a moment on Windows.
  const options = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }
  if (!existedBefore) {
    await rm(target, options).catch(() => undefined)
    return
  }
  const entries = existsSync(target) ? readdirSync(target) : []
  await Promise.all(entries.map((entry) => rm(join(target, entry), options).catch(() => undefined)))
}

/** Why the first commit of a new repository failed, in words that say what to do next. */
function firstCommitProblem(output: string): string {
  if (/tell me who you are|author identity unknown|unable to auto-detect|no (email|name) was given|empty ident/i.test(output)) {
    return 'Git does not know your name and email yet. Set them, then commit README.md from Changes.'
  }
  const reason = output.trim().split(/\r?\n/).pop()?.replace(/^(fatal|error):\s*/i, '')
  return `${reason || 'Git could not commit'}. README.md is staged; commit it from Changes.`
}

/**
 * Create a repository in `path` (a missing or empty folder) whose first branch is `initialBranch`, with a
 * first commit of README.md when `readme` is set. When only that commit fails (no Git identity yet, say), the
 * repository stays and the reason comes back as `warning`.
 */
export async function createRepository(opts: {
  path: string
  name: string
  initialBranch: string
  readme: boolean
}): Promise<CreateRepoResult> {
  const { path, initialBranch } = opts
  // Checked before anything is written: a repository on an invalid branch name would be unusable.
  const refCheck = initialBranch.startsWith('-')
    ? null
    : await runGit({ cwd: tmpdir(), args: ['check-ref-format', '--branch', initialBranch] })
  if (!refCheck || refCheck.code !== 0) throw new Error(`"${initialBranch}" is not a valid branch name.`)

  const existedBefore = existsSync(path)
  try {
    await mkdir(path, { recursive: true })
    await gitOk(path, ['init', '--quiet'])
    // `git init -b` needs Git 2.28; pointing HEAD at the unborn branch works with every version.
    await gitOk(path, ['symbolic-ref', 'HEAD', `refs/heads/${initialBranch}`])
  } catch (err) {
    await removeLeftovers(path, existedBefore)
    throw err
  }

  let warning: string | null = null
  if (opts.readme) {
    await writeFile(join(path, 'README.md'), `# ${opts.name}\n`)
    await gitOk(path, ['add', '--', 'README.md'])
    const commit = await runGit({ cwd: path, args: ['commit', '--quiet', '-m', 'Initial commit'] })
    if (commit.code !== 0) {
      warning = `The repository was created, but its first commit failed. ${firstCommitProblem(commit.stderr || commit.stdout)}`
    }
  }
  return { repo: await inspectRepository(path), warning }
}

/**
 * Clone `url` into `targetDir`. Reports progress, stops when cancelled or after the network idle timeout,
 * and never leaves a partly cloned folder behind.
 */
export async function cloneRepository(
  url: string,
  targetDir: string,
  ctx: RemoteOpContext = {}
): Promise<CloneResult> {
  const parent = dirname(targetDir)
  if (!existsSync(parent)) throw new Error(`The parent folder does not exist: ${parent}`)
  const existedBefore = existsSync(targetDir)
  // Git only clones into a missing or empty folder; saying so before connecting is quicker and clearer.
  if (existedBefore && (!statSync(targetDir).isDirectory() || readdirSync(targetDir).length > 0)) {
    throw new Error(`${targetDir} already exists and is not an empty folder. Choose another parent folder.`)
  }
  const report = ctx.onProgress ? throttleProgress(ctx.onProgress) : undefined
  let result: GitRunResult
  try {
    result = await runGit({
      // Not the parent folder: a running process locks its working folder on Windows.
      cwd: tmpdir(),
      args: ['clone', '--progress', '--', url, targetDir],
      signal: ctx.signal,
      idleTimeoutMs: ctx.idleTimeoutMs ?? NETWORK_IDLE_TIMEOUT_MS,
      onProgress: (line) => report?.({ phase: line.phase, percent: line.percent, cancellable: true })
    })
  } catch (err) {
    // Git removes a failed clone's folder only when it exits on its own.
    await removeLeftovers(targetDir, existedBefore)
    if (err instanceof GitCancelledError) return { outcome: 'cancelled' }
    throw err
  }
  if (result.code !== 0) {
    await removeLeftovers(targetDir, existedBefore)
    const message = result.stderr.replace(/^Cloning into .*$/m, '').trim()
    throw new Error(message || `git clone failed (${result.code})`)
  }
  return { outcome: 'done', repo: await inspectRepository(targetDir) }
}
