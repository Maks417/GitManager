import type { ProviderAccount, RemoteRepo } from '@shared/ipc'
import { fetchJson, MAX_PAGES, nextLink } from './http'

const API = 'https://gitlab.com/api/v4'

interface GitLabProject {
  id: number
  name: string
  path_with_namespace: string
  description: string | null
  visibility: string
  http_url_to_repo: string
  ssh_url_to_repo: string
  default_branch: string
  web_url: string
}

function authHeaders(token: string): Record<string, string> {
  return { 'PRIVATE-TOKEN': token }
}

export async function connectGitLab(token: string): Promise<ProviderAccount> {
  const { data } = await fetchJson(`${API}/user`, authHeaders(token), 'GitLab auth failed')
  const user = data as { id: number; username: string; name?: string; avatar_url?: string }
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
  const projects: GitLabProject[] = []
  let url: string | null = `${API}/projects?membership=true&per_page=100&order_by=last_activity_at`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const { data, headers } = await fetchJson(url, authHeaders(token), 'GitLab repos failed')
    projects.push(...(data as GitLabProject[]))
    url = nextLink(headers.get('link'))
  }
  return projects.map((r) => ({
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
