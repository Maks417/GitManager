import type { ProviderAccount, RemoteRepo } from '@shared/ipc'
import { fetchJson, MAX_PAGES, sameOrigin } from './http'

const API = 'https://api.bitbucket.org/2.0'

interface BitbucketRepo {
  uuid: string
  name: string
  full_name: string
  description: string | null
  is_private: boolean
  links: { clone: Array<{ name: string; href: string }>; html: { href: string } }
  mainbranch?: { name: string }
}

/**
 * Atlassian API tokens authenticate to the Bitbucket Cloud REST API with HTTP Basic auth: the
 * Atlassian account email as the user name and the API token as the password. (Bitbucket app
 * passwords, which used the Bitbucket username instead, have been retired.)
 */
function basicAuth(email: string, token: string): Record<string, string> {
  return { Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}` }
}

export async function connectBitbucket(
  token: string,
  email?: string
): Promise<{ account: ProviderAccount; authUser: string }> {
  if (!email) throw new Error('Bitbucket needs the Atlassian account email that owns the API token.')
  const { data } = await fetchJson(`${API}/user`, basicAuth(email, token), 'Bitbucket auth failed')
  const user = data as {
    uuid: string
    username?: string
    nickname?: string
    display_name?: string
    links?: { avatar?: { href?: string } }
  }
  const username = user.username || user.nickname || email
  return {
    account: {
      id: `bitbucket:${user.uuid}`,
      provider: 'bitbucket',
      username,
      displayName: user.display_name || username,
      avatarUrl: user.links?.avatar?.href,
      host: 'bitbucket.org'
    },
    authUser: email
  }
}

/** `authUser` must be the same email that was used to connect. */
export async function listBitbucketRepos(authUser: string, token: string): Promise<RemoteRepo[]> {
  const repos: BitbucketRepo[] = []
  let url: string | null = `${API}/repositories?role=member&pagelen=100`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    const { data } = await fetchJson(url, basicAuth(authUser, token), 'Bitbucket repos failed')
    const body = data as { values: BitbucketRepo[]; next?: string }
    repos.push(...body.values)
    // The credentials go with every page: follow `next` only on Bitbucket's own API.
    url = body.next && sameOrigin(body.next, API) ? body.next : null
  }
  return repos.map((r) => ({
    id: r.uuid,
    name: r.name,
    fullName: r.full_name,
    description: r.description,
    private: r.is_private,
    cloneUrlHttps: r.links.clone.find((c) => c.name === 'https')?.href || '',
    cloneUrlSsh: r.links.clone.find((c) => c.name === 'ssh')?.href || '',
    defaultBranch: r.mainbranch?.name || 'main',
    webUrl: r.links.html.href
  }))
}
