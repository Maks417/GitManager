import { existsSync } from 'fs'
import { rm } from 'fs/promises'
import { basename, normalize } from 'path'
import type { Repository } from '@shared/ipc'
import { isGitRepo, runGit } from '../git-runner'
import { currentBranchName, gitOk } from './shared'

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
  const branch = await currentBranchName(path)
  const remotesOut = await runGit({ cwd: path, args: ['remote', '-v'] })
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
    remotes: [...remotes.entries()].map(([name, url]) => ({ name, url }))
  }
}

export async function initRepository(path: string): Promise<Repository> {
  await gitOk(path, ['init'])
  return inspectRepository(path)
}

export async function cloneRepository(url: string, targetDir: string): Promise<Repository> {
  const existed = existsSync(targetDir)
  const result = await runGit({
    cwd: process.cwd(),
    args: ['clone', '--', url, targetDir],
    timeoutMs: 60 * 60 * 1000
  }).catch(async (err: unknown) => {
    // A killed clone leaves a partial folder behind (Git cleans up only when it exits normally).
    if (!existed) await rm(targetDir, { recursive: true, force: true }).catch(() => undefined)
    throw err
  })
  if (result.code !== 0) {
    throw new Error(result.stderr || 'Clone failed')
  }
  return inspectRepository(targetDir)
}
