import type { RemoteConfig, SaveRemoteRequest, SetUpstreamRequest } from '@shared/ipc'
import { assertRevision } from './guards'
import { gitOk, runGit } from './shared'

export function assertRemoteName(name: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error('Remote names must start with a letter or number and contain only letters, numbers, dots, underscores or hyphens.')
  return name
}

function assertRemoteUrl(url: string): string {
  if (!url.trim() || url.startsWith('-') || /[\0\r\n]/.test(url)) throw new Error('Enter a valid Git remote URL or local repository path.')
  return url
}

export async function getRemotes(repoPath: string): Promise<RemoteConfig[]> {
  const names = (await gitOk(repoPath, ['remote'])).trim().split(/\r?\n/).filter(Boolean)
  return Promise.all(names.map(async (name) => ({
    name,
    fetchUrl: (await gitOk(repoPath, ['remote', 'get-url', name])).trim(),
    pushUrl: (await gitOk(repoPath, ['remote', 'get-url', '--push', name])).trim()
  })))
}

export async function saveRemote(repoPath: string, request: SaveRemoteRequest): Promise<void> {
  const name = assertRemoteName(request.name)
  const url = assertRemoteUrl(request.url)
  const pushUrl = request.pushUrl?.trim()
  if (pushUrl) assertRemoteUrl(pushUrl)
  const remotes = await getRemotes(repoPath)
  const existing = remotes.find((remote) => remote.name === name)
  if (request.create && existing) throw new Error(`A remote named "${name}" already exists.`)
  if (!request.create && !existing) throw new Error(`Remote "${name}" no longer exists.`)
  // Validate all input before changing configuration.
  await gitOk(repoPath, request.create ? ['remote', 'add', name, url] : ['remote', 'set-url', name, url])
  if (pushUrl && pushUrl !== url) {
    await gitOk(repoPath, ['config', '--replace-all', `remote.${name}.pushurl`, pushUrl])
  } else {
    const result = await runGit({ cwd: repoPath, args: ['config', '--unset-all', `remote.${name}.pushurl`] })
    if (result.code !== 0 && result.code !== 5) throw new Error(result.stderr.trim() || 'Could not clear the push URL.')
  }
}

export async function removeRemote(repoPath: string, name: string): Promise<void> {
  await gitOk(repoPath, ['remote', 'remove', assertRemoteName(name)])
}

export async function setUpstream(repoPath: string, request: SetUpstreamRequest): Promise<void> {
  const branch = assertRevision(request.branch, 'branch')
  await gitOk(repoPath, ['show-ref', '--verify', `refs/heads/${branch}`])
  if (request.upstream === null) {
    const current = await runGit({ cwd: repoPath, args: ['config', '--get', `branch.${branch}.merge`] })
    if (current.code !== 0) return
    await gitOk(repoPath, ['branch', '--unset-upstream', branch])
  } else {
    const upstream = assertRevision(request.upstream, 'upstream')
    await gitOk(repoPath, ['show-ref', '--verify', `refs/remotes/${upstream}`])
    await gitOk(repoPath, ['branch', `--set-upstream-to=refs/remotes/${upstream}`, branch])
  }
}
