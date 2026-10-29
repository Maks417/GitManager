import { existsSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { stopLongGitIn } from '../git-runner'
import { getGitDirs } from './shared'

/** Commands younger than this are left running: refreshes and other quick reads, not the stuck one. */
const MIN_AGE_MS = 5000

/**
 * Longest wait for the stopped commands to exit before the index lock is looked at. A live Git still holds the
 * lock open, and on Windows taskkill takes a while on a busy machine.
 */
const EXIT_WAIT_MS = 4000

export interface StopLongGitResult {
  /** Whether any command was running long enough to be stopped. */
  stopped: boolean
  /** A stopped command left `.git/index.lock` behind, and it was removed. */
  removedLock: boolean
}

/**
 * Stop what keeps a local Git action from finishing (a commit waiting on a signing prompt or a hook, a checkout
 * in an LFS download). Git leaves `index.lock` behind when stopped mid-write, which would make every later
 * action fail; it is removed only when it was created after the oldest stopped command started, so a lock
 * another program holds stays.
 */
export async function stopLongGit(repoPath: string): Promise<StopLongGitResult> {
  const stopped = stopLongGitIn(repoPath, MIN_AGE_MS)
  if (stopped === null) return { stopped: false, removedLock: false }
  const { since, exited } = stopped
  let waited: ReturnType<typeof setTimeout> | undefined
  await Promise.race([exited, new Promise((resolve) => (waited = setTimeout(resolve, EXIT_WAIT_MS)))])
  clearTimeout(waited)
  const { gitDir } = await getGitDirs(repoPath)
  const lock = join(gitDir, 'index.lock')
  if (!existsSync(lock)) return { stopped: true, removedLock: false }
  try {
    // A second of slack for file systems that store coarse modification times.
    if (statSync(lock).mtimeMs < since - 1000) return { stopped: true, removedLock: false }
    unlinkSync(lock)
    return { stopped: true, removedLock: true }
  } catch {
    return { stopped: true, removedLock: false }
  }
}
