import type { RepoRemovalInfo } from '@shared/ipc'
import { getStatus } from './status'
import { listStashes } from './stash'
import { runGit } from './shared'
import { linkedWorktreeMain } from './worktrees'

/** What would be lost if the repository folder were deleted. */
export async function inspectRepoForRemoval(repoPath: string): Promise<RepoRemovalInfo> {
  const [status, mainPath] = await Promise.all([
    getStatus(repoPath),
    linkedWorktreeMain(repoPath).catch(() => null)
  ])
  // A linked worktree's commits, branches and stashes live in its main repository: only its changes go with the folder.
  if (mainPath) return { uncommitted: status.length, stashes: 0, unpushed: 0 }
  const [stashes, unpushed] = await Promise.all([
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
