import type { ProviderAccount, RemoteRepo } from '@shared/ipc'
import { fetchJson, MAX_PAGES, nextLinkOnOrigin } from './http'

/** GitLab.com. Its accounts keep ids of the form `gitlab:<user id>`. */
export const GITLAB_COM = 'https://gitlab.com'

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

/**
 * The address of a GitLab instance as people type it — `gitlab.example.com`, `https://example.com/gitlab/`,
 * even with `/api/v4` — as `https://host[:port][/path]`. Empty means GitLab.com. Only HTTPS is accepted: the
 * access token goes with every request.
 */
export function normalizeGitLabUrl(raw: string | undefined): string {
  const text = raw?.trim() ?? ''
  if (!text) return GITLAB_COM
  let url: URL
  try {
    url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    throw new Error('Enter the address of your GitLab instance, like https://gitlab.example.com.')
  }
  if (url.protocol !== 'https:') {
    throw new Error('Use an https:// address for GitLab: over plain HTTP the access token would travel unencrypted.')
  }
  if (url.username || url.password) throw new Error('Leave the user name and password out of the GitLab address.')
  if (url.search || url.hash) throw new Error('Enter just the address of the GitLab instance, without ? or #.')
  const path = url.pathname.replace(/\/+$/, '').replace(/\/api\/v4$/i, '')
  return `${url.origin}${path}`
}

/** Connects to GitLab.com, or to the self-managed instance at `baseUrl`. */
export async function connectGitLab(token: string, baseUrl?: string): Promise<ProviderAccount> {
  const base = normalizeGitLabUrl(baseUrl)
  const host = base.replace(/^https:\/\//, '')
  const { data } = await fetchJson(`${base}/api/v4/user`, authHeaders(token), `GitLab auth failed at ${host}`)
  const user = data as { id: number; username: string; name?: string; avatar_url?: string }
  const selfManaged = base !== GITLAB_COM
  return {
    // User ids are only unique within one instance.
    id: selfManaged ? `gitlab:${host}:${user.id}` : `gitlab:${user.id}`,
    provider: 'gitlab',
    username: user.username,
    displayName: user.name || user.username,
    avatarUrl: user.avatar_url,
    host,
    ...(selfManaged ? { baseUrl: base } : {})
  }
}

export async function listGitLabRepos(token: string, baseUrl?: string): Promise<RemoteRepo[]> {
  const base = normalizeGitLabUrl(baseUrl)
  const projects: GitLabProject[] = []
  let url: string | null = `${base}/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const { data, headers } = await fetchJson(url, authHeaders(token), 'GitLab repos failed')
    projects.push(...(data as GitLabProject[]))
    url = nextLinkOnOrigin(headers.get('link'), base)
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
