import { existsSync } from 'fs'
import { resolve } from 'path'
import { gitOk, runGit } from '../git-runner'
import { SHA_RE } from '@shared/sha'

export { SHA_RE }

/** Resolves HEAD only when it points at a real commit (fails on unborn branches). */
export async function resolveHeadSha(repoPath: string): Promise<string | null> {
  const result = await runGit({ cwd: repoPath, args: ['rev-parse', '--verify', 'HEAD'] })
  if (result.code !== 0) return null
  const sha = result.stdout.trim()
  return SHA_RE.test(sha) ? sha : null
}

export async function currentBranchName(repoPath: string): Promise<string | null> {
  const sym = await runGit({ cwd: repoPath, args: ['symbolic-ref', '--short', 'HEAD'] })
  if (sym.code === 0 && sym.stdout.trim()) return sym.stdout.trim()
  const abbrev = await runGit({ cwd: repoPath, args: ['rev-parse', '--abbrev-ref', 'HEAD'] })
  const name = abbrev.stdout.trim()
  if (!name || name === 'HEAD') return null
  return name
}

/**
 * Absolute git directories of a work tree. `gitDir` holds HEAD, the index and merge/rebase state;
 * `commonDir` holds refs. Both lie outside the work tree for linked worktrees and submodules.
 */
/** Git directories by work-tree path: they never move while the work tree exists, and almost every refresh asks. */
const gitDirsCache = new Map<string, { gitDir: string; commonDir: string }>()

export async function getGitDirs(repoPath: string): Promise<{ gitDir: string; commonDir: string }> {
  const cached = gitDirsCache.get(repoPath)
  if (cached && existsSync(cached.gitDir)) return cached
  const dirs = await readGitDirs(repoPath)
  if (gitDirsCache.size > 200) gitDirsCache.clear()
  gitDirsCache.set(repoPath, dirs)
  return dirs
}

async function readGitDirs(repoPath: string): Promise<{ gitDir: string; commonDir: string }> {
  // Plain output (no --path-format, which needs Git 2.31): paths may be relative to the work tree.
  const [gitDir, commonDir] = (await gitOk(repoPath, ['rev-parse', '--git-dir', '--git-common-dir']))
    .split(/\r?\n/)
    .map((line) => line.trim())
  if (!gitDir || !commonDir) throw new Error(`Could not locate the Git directory of ${repoPath}`)
  return { gitDir: resolve(repoPath, gitDir), commonDir: resolve(repoPath, commonDir) }
}

export { gitOk, runGit }
