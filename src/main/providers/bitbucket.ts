import type { ProviderAccount, RemoteRepo } from '@shared/ipc'

async function bbFetch(token: string, path: string, username: string): Promise<Response> {
  const auth = Buffer.from(`${username}:${token}`).toString('base64')
  return fetch(`https://api.bitbucket.org/2.0${path}`, {
    headers: {
      Authorization: `Basic ${auth}`,
      'User-Agent': 'GitManager'
    }
  })
}

export async function connectBitbucket(token: string, username?: string): Promise<ProviderAccount> {
  const user = username || 'x-token-auth'
  const res = await bbFetch(token, '/user', user)
  if (!res.ok) throw new Error(`Bitbucket auth failed (${res.status})`)
  const data = (await res.json()) as {
    uuid: string
    username?: string
    display_name?: string
    links?: { avatar?: { href?: string } }
  }
  return {
    id: `bitbucket:${data.uuid}`,
    provider: 'bitbucket',
    username: data.username || user,
    displayName: data.display_name || data.username || user,
    avatarUrl: data.links?.avatar?.href,
    host: 'bitbucket.org'
  }
}

export async function listBitbucketRepos(account: ProviderAccount, token: string): Promise<RemoteRepo[]> {
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
