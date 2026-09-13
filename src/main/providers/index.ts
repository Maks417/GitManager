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

async function glFetch(token: string, path: string, host = 'https://gitlab.com'): Promise<Response> {
  return fetch(`${host}/api/v4${path}`, {
    headers: {
      'PRIVATE-TOKEN': token,
      'User-Agent': 'GitManager'
    }
  })
}

async function bbFetch(token: string, path: string, username: string): Promise<Response> {
  const auth = Buffer.from(`${username}:${token}`).toString('base64')
  return fetch(`https://api.bitbucket.org/2.0${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      'User-Agent': 'GitManager'
    }
  })
}

export async function connectWithToken(
  provider: ProviderAccount['provider'],
  token: string,
  username?: string
): Promise<ProviderAccount> {
  if (provider === 'github') {
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

  if (provider === 'gitlab') {
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

  // bitbucket
  const user = username || 'x-token-auth'
  const res = await bbFetch(token, '/user', user)
  if (!res.ok) throw new Error(`Bitbucket auth failed (${res.status})`)
  const data = (await res.json()) as { uuid: string; username?: string; display_name?: string; links?: { avatar?: { href?: string } } }
  return {
    id: `bitbucket:${data.uuid}`,
    provider: 'bitbucket',
    username: data.username || user,
    displayName: data.display_name || data.username || user,
    avatarUrl: data.links?.avatar?.href,
    host: 'bitbucket.org'
  }
}

export async function listRemoteRepos(account: ProviderAccount, token: string): Promise<RemoteRepo[]> {
  if (account.provider === 'github') {
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

  if (account.provider === 'gitlab') {
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

  const res = await bbFetch(token, '/repositories?role=member&pagelen=100', account.username)
  if (!res.ok) throw new Error(`Bitbucket repos failed (${res.status})`)
  const data = (await res.json()) as {
    values: Array<{
      uuid: string
      name: string
      full_name: string
      description: string | null
      is_private: boolean
      links: { clone: Array<{ name: string; href: string }>; html: { href: string } }
      mainbranch?: { name: string }
    }>
  }
  return data.values.map((r) => {
    const https = r.links.clone.find((c) => c.name === 'https')?.href || ''
    const ssh = r.links.clone.find((c) => c.name === 'ssh')?.href || ''
    return {
      id: r.uuid,
      name: r.name,
      fullName: r.full_name,
      description: r.description,
      private: r.is_private,
      cloneUrlHttps: https,
      cloneUrlSsh: ssh,
      defaultBranch: r.mainbranch?.name || 'main',
      webUrl: r.links.html.href
    }
  })
}
