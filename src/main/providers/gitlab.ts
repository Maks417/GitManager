import type { ProviderAccount, RemoteRepo } from '@shared/ipc'

async function glFetch(token: string, path: string, host = 'https://gitlab.com'): Promise<Response> {
  return fetch(`${host}/api/v4${path}`, {
    headers: {
      'PRIVATE-TOKEN': token,
      'User-Agent': 'GitManager'
    }
  })
}

export async function connectGitLab(token: string): Promise<ProviderAccount> {
  const res = await glFetch(token, '/user')
  if (!res.ok) throw new Error(`GitLab auth failed (${res.status})`)
  const user = (await res.json()) as { id: number; username: string; name?: string; avatar_url?: string }
  return {
    id: `gitlab:${user.id}`,
    provider: 'gitlab',
    username: user.username,
    displayName: user.name || user.username,
    avatarUrl: user.avatar_url,
    host: 'gitlab.com'
  }
}

export async function listGitLabRepos(token: string): Promise<RemoteRepo[]> {
  const res = await glFetch(token, '/projects?membership=true&per_page=100&order_by=last_activity_at')
  if (!res.ok) throw new Error(`GitLab repos failed (${res.status})`)
  const repos = (await res.json()) as Array<{
    id: number
    name: string
    path_with_namespace: string
    description: string | null
    visibility: string
    http_url_to_repo: string
    ssh_url_to_repo: string
    default_branch: string
    web_url: string
  }>
  return repos.map((r) => ({
    id: String(r.id),
    name: r.name,
    fullName: r.path_with_namespace,
    description: r.description,
    private: r.visibility !== 'public',
    cloneUrlHttps: r.http_url_to_repo,
    cloneUrlSsh: r.ssh_url_to_repo,
    defaultBranch: r.default_branch || 'main',
    webUrl: r.web_url
  }))
}
