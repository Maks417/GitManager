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

export { gitOk, runGit }
