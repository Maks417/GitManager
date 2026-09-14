import type { RepoRemovalInfo } from '@shared/ipc'
import { getStatus } from './status'
import { listStashes } from './stash'
import { runGit } from './shared'

/** What would be lost if the repository folder were deleted. */
export async function inspectRepoForRemoval(repoPath: string): Promise<RepoRemovalInfo> {
  const [status, stashes, unpushed] = await Promise.all([
    getStatus(repoPath, 'normal'),
    listStashes(repoPath).catch(() => []),
    // Commits on local branches that no remote-tracking branch contains (all of them without a remote).
    runGit({ cwd: repoPath, args: ['rev-list', '--count', '--branches', '--not', '--remotes'] })
  ])
  const count = Number(unpushed.stdout.trim())
  return {
    uncommitted: status.length,
    stashes: stashes.length,
    unpushed: unpushed.code === 0 && Number.isFinite(count) ? count : 0
  }
}
