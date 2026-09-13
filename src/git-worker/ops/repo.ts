import { basename } from 'path'
import type { Repository } from '@shared/ipc'
import { isGitRepo, runGit } from '../git-runner'
import { currentBranchName, gitOk } from './shared'

export async function inspectRepository(path: string): Promise<Repository> {
  if (!isGitRepo(path)) {
    throw new Error(`Not a git repository: ${path}`)
  }
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
  const result = await runGit({
    cwd: process.cwd(),
    args: ['clone', '--', url, targetDir],
    timeoutMs: 10 * 60 * 1000
  })
  if (result.code !== 0) {
    throw new Error(result.stderr || 'Clone failed')
  }
  return inspectRepository(targetDir)
}
