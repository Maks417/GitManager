import { createHash } from 'crypto'
import { runGit } from './shared'

/**
 * A hash of the repository's status, HEAD and refs, which changes whenever live updates would have reported
 * something. Compared on a timer when the operating system refuses more file watches.
 */
export async function getWatchFingerprint(repoPath: string): Promise<string> {
  const [status, refs] = await Promise.all([
    // Every new file, as the Changes list shows them: a file added inside a new folder changes the fingerprint too.
    // Capped like the Changes list's status, so a flood of new files cannot fill the worker's memory.
    runGit({
      cwd: repoPath,
      args: ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
      maxStdoutChars: 20_000_000
    }),
    runGit({ cwd: repoPath, args: ['for-each-ref', '--format=%(objectname) %(refname)'] })
  ])
  if (status.code !== 0) throw new Error(status.stderr.trim() || `git status failed (${status.code})`)
  return createHash('sha1').update(status.stdout).update('\0').update(refs.stdout).digest('hex')
}
