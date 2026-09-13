import type { ProviderAccount, RemoteRepo } from '@shared/ipc'

async function ghFetch(token: string, path: string): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': 'GitManager'
    }
  })
}

export async function connectGitHub(token: string): Promise<ProviderAccount> {
  const res = await ghFetch(token, '/user')
  if (!res.ok) throw new Error(`GitHub auth failed (${res.status})`)
  const user = (await res.json()) as { id: number; login: string; name?: string; avatar_url?: string }
  return {
    id: `github:${user.id}`,
    provider: 'github',
    username: user.login,
    displayName: user.name || user.login,
    avatarUrl: user.avatar_url,
    host: 'github.com'
  }
}

export async function listGitHubRepos(token: string): Promise<RemoteRepo[]> {
  const res = await ghFetch(token, '/user/repos?per_page=100&sort=updated')
  if (!res.ok) throw new Error(`GitHub repos failed (${res.status})`)
  const repos = (await res.json()) as Array<{
    id: number
    name: string
    full_name: string
    description: string | null
    private: boolean
    clone_url: string
    ssh_url: string
    default_branch: string
    html_url: string
  }>
  return repos.map((r) => ({
    id: String(r.id),
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    private: r.private,
    cloneUrlHttps: r.clone_url,
    cloneUrlSsh: r.ssh_url,
    defaultBranch: r.default_branch,
    webUrl: r.html_url
  }))
}
