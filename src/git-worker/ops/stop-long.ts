import { existsSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'
import { stopLongGitIn } from '../git-runner'
import { getGitDirs } from './shared'

/** Commands younger than this are left running: refreshes and other quick reads, not the stuck one. */
const MIN_AGE_MS = 5000

/** How long the stopped commands get to exit before the index lock is looked at. */
const EXIT_WAIT_MS = 600

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
  const since = stopLongGitIn(repoPath, MIN_AGE_MS)
  if (since === null) return { stopped: false, removedLock: false }
  await new Promise((resolve) => setTimeout(resolve, EXIT_WAIT_MS))
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
