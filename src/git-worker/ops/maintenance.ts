import { existsSync } from 'fs'
import { join } from 'path'
import { getGitDirs, runGit } from './shared'

/** Repositories whose commit-graph this worker already wrote or found, by common directory. */
const checked = new Set<string>()

function hasCommitGraph(commonDir: string): { any: boolean; split: boolean } {
  const info = join(commonDir, 'objects', 'info')
  const split = existsSync(join(info, 'commit-graphs', 'commit-graph-chain'))
  return { any: split || existsSync(join(info, 'commit-graph')), split }
}

/**
 * Writes Git's commit-graph file when a repository has none. Without it, `git log --date-order --all`
 * reads and sorts every commit before printing the first one, on every history page; with it, Git
 * streams the first page from the generation numbers. Clones start without one until `git gc` or
 * `git maintenance` runs.
 *
 * Only `objects/info` changes, which the repository watcher ignores. Runs at most once per repository
 * while the worker lives; `afterFetch` adds a layer for fetched commits when the graph is split (the
 * layout this writes), leaving a single-file graph from Git's own maintenance alone. Never throws.
 */
export async function ensureCommitGraph(repoPath: string, opts: { afterFetch?: boolean } = {}): Promise<boolean> {
  try {
    const { commonDir } = await getGitDirs(repoPath)
    const key = commonDir.toLowerCase()
    const existing = hasCommitGraph(commonDir)
    const write = opts.afterFetch ? existing.split || !existing.any : !checked.has(key) && !existing.any
    checked.add(key)
    if (!write) return false
    const enabled = await runGit({ cwd: repoPath, args: ['config', '--type=bool', 'core.commitGraph'] })
    if (enabled.stdout.trim() === 'false') return false
    const written = await runGit({
      cwd: repoPath,
      args: ['commit-graph', 'write', '--reachable', '--split', '--no-progress']
    })
    return written.code === 0
  } catch {
    return false
  }
}
