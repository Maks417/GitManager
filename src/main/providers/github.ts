import type { ProviderAccount, RemoteRepo } from '@shared/ipc'
import { fetchJson, MAX_PAGES, nextLinkOnOrigin } from './http'

const API = 'https://api.github.com'

interface GitHubRepo {
  id: number
  name: string
  full_name: string
  description: string | null
  private: boolean
  clone_url: string
  ssh_url: string
  default_branch: string
  html_url: string
}

function authHeaders(token: string): Record<string, string> {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` }
}

export async function connectGitHub(token: string): Promise<ProviderAccount> {
  const { data } = await fetchJson(`${API}/user`, authHeaders(token), 'GitHub auth failed')
  const user = data as { id: number; login: string; name?: string; avatar_url?: string }
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
  const repos: GitHubRepo[] = []
  let url: string | null = `${API}/user/repos?per_page=100&sort=updated`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const { data, headers } = await fetchJson(url, authHeaders(token), 'GitHub repos failed')
    repos.push(...(data as GitHubRepo[]))
    url = nextLinkOnOrigin(headers.get('link'), API)
  }
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
