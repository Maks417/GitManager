import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectWithToken, listRemoteRepos } from '../src/main/providers'
import { normalizeGitLabUrl } from '../src/main/providers/gitlab'
import { nextLinkOnOrigin } from '../src/main/providers/http'
import type { ProviderAccount } from '../src/shared/ipc'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function project(id: number, host: string): Record<string, unknown> {
  return {
    id,
    name: `p${id}`,
    path_with_namespace: `team/p${id}`,
    description: null,
    visibility: 'private',
    http_url_to_repo: `https://${host}/team/p${id}.git`,
    ssh_url_to_repo: `git@${host}:team/p${id}.git`,
    default_branch: 'main',
    web_url: `https://${host}/team/p${id}`
  }
}

describe('normalizeGitLabUrl', () => {
  it('turns what people type into the address of the instance', () => {
    expect(normalizeGitLabUrl(undefined)).toBe('https://gitlab.com')
    expect(normalizeGitLabUrl('   ')).toBe('https://gitlab.com')
    expect(normalizeGitLabUrl('gitlab.example.com')).toBe('https://gitlab.example.com')
    expect(normalizeGitLabUrl('https://example.com/gitlab/')).toBe('https://example.com/gitlab')
    expect(normalizeGitLabUrl('https://gitlab.example.com:8443/api/v4/')).toBe('https://gitlab.example.com:8443')
  })

  it('refuses addresses that would expose the token or are not an instance address', () => {
    expect(() => normalizeGitLabUrl('http://gitlab.example.com')).toThrow(/https/)
    expect(() => normalizeGitLabUrl('https://me:secret@gitlab.example.com')).toThrow(/user name and password/)
    expect(() => normalizeGitLabUrl('https://gitlab.example.com/?page=1')).toThrow(/without \?/)
    expect(() => normalizeGitLabUrl('https://')).toThrow(/address of your GitLab instance/)
  })
})

describe('self-managed GitLab', () => {
  it('connects to the instance, remembers its address, and lists its projects page by page', async () => {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      expect((init?.headers as Record<string, string>)['PRIVATE-TOKEN']).toBe('glpat-self')
      if (url.endsWith('/api/v4/user')) {
        return new Response(JSON.stringify({ id: 7, username: 'me', name: 'Me' }), { status: 200 })
      }
      if (url.includes('page=2')) return new Response(JSON.stringify([project(2, 'git.example.org')]), { status: 200 })
      return new Response(JSON.stringify([project(1, 'git.example.org')]), {
        status: 200,
        headers: { link: '<https://git.example.org/gitlab/api/v4/projects?page=2>; rel="next"' }
      })
    }) as typeof fetch

    const { account } = await connectWithToken('gitlab', 'glpat-self', undefined, { baseUrl: 'git.example.org/gitlab' })
    expect(account).toMatchObject({
      id: 'gitlab:git.example.org/gitlab:7',
      provider: 'gitlab',
      host: 'git.example.org/gitlab',
      baseUrl: 'https://git.example.org/gitlab'
    })
    const repos = await listRemoteRepos(account, 'glpat-self')
    expect(repos.map((r) => r.fullName)).toEqual(['team/p1', 'team/p2'])
    expect(calls.every((url) => url.startsWith('https://git.example.org/gitlab/api/v4/'))).toBe(true)
  })

  it('keeps GitLab.com accounts as they were', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://gitlab.com/api/v4/user')
      return new Response(JSON.stringify({ id: 2, username: 'gl' }), { status: 200 })
    }) as typeof fetch
    const { account } = await connectWithToken('gitlab', 'glpat-x')
    expect(account).toEqual({ id: 'gitlab:2', provider: 'gitlab', username: 'gl', displayName: 'gl', host: 'gitlab.com' })
  })

  it('never sends the token to another host through a paging link', async () => {
    const calls: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response(JSON.stringify([project(1, 'git.example.org')]), {
        status: 200,
        headers: { link: '<https://elsewhere.example.net/api/v4/projects?page=2>; rel="next"' }
      })
    }) as typeof fetch
    const account: ProviderAccount = {
      id: 'gitlab:git.example.org:7',
      provider: 'gitlab',
      username: 'me',
      displayName: 'Me',
      host: 'git.example.org',
      baseUrl: 'https://git.example.org'
    }
    expect(await listRemoteRepos(account, 'glpat-self')).toHaveLength(1)
    expect(calls).toEqual(['https://git.example.org/api/v4/projects?membership=true&per_page=100&order_by=last_activity_at'])
  })

  it('reports the instance a failed sign-in was made at', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch
    await expect(connectWithToken('gitlab', 'bad', undefined, { baseUrl: 'git.example.org' })).rejects.toThrow(
      /GitLab auth failed at git\.example\.org \(401\)/
    )
  })
})

describe('nextLinkOnOrigin', () => {
  it('follows only links on the same scheme, host and port', () => {
    const link = (url: string): string => `<${url}>; rel="next"`
    expect(nextLinkOnOrigin(link('https://api.github.com/user/repos?page=2'), 'https://api.github.com')).toBe(
      'https://api.github.com/user/repos?page=2'
    )
    expect(nextLinkOnOrigin(link('https://example.com/?page=2'), 'https://api.github.com')).toBeNull()
    expect(nextLinkOnOrigin(link('http://api.github.com/?page=2'), 'https://api.github.com')).toBeNull()
    expect(nextLinkOnOrigin(null, 'https://api.github.com')).toBeNull()
  })
})
