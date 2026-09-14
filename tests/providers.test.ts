import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectWithToken, listRemoteRepos } from '../src/main/providers'
import { nextLink } from '../src/main/providers/http'
import type { ProviderAccount } from '../src/shared/ipc'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function githubRepo(id: number): Record<string, unknown> {
  return {
    id,
    name: `repo-${id}`,
    full_name: `octo/repo-${id}`,
    description: null,
    private: false,
    clone_url: `https://github.com/octo/repo-${id}.git`,
    ssh_url: `git@github.com:octo/repo-${id}.git`,
    default_branch: 'main',
    html_url: `https://github.com/octo/repo-${id}`
  }
}

describe('provider contracts', () => {
  it('maps a GitHub user and follows repository pages', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/user')) {
        return new Response(JSON.stringify({ id: 1, login: 'octo', name: 'Octo' }), { status: 200 })
      }
      if (url.includes('page=2')) return new Response(JSON.stringify([githubRepo(3)]), { status: 200 })
      return new Response(JSON.stringify([githubRepo(1), githubRepo(2)]), {
        status: 200,
        headers: { link: '<https://api.github.com/user/repos?per_page=100&page=2>; rel="next"' }
      })
    }) as typeof fetch

    const { account } = await connectWithToken('github', 'token')
    expect(account).toMatchObject({ provider: 'github', username: 'octo', id: 'github:1' })
    const repos = await listRemoteRepos(account, 'token')
    expect(repos.map((r) => r.fullName)).toEqual(['octo/repo-1', 'octo/repo-2', 'octo/repo-3'])
    expect(repos[0].cloneUrlSsh).toContain('git@')
  })

  it('maps a GitLab user', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 2, username: 'gl', name: 'GL' }), { status: 200 })
    }) as typeof fetch
    const { account } = await connectWithToken('gitlab', 'glpat-x')
    expect(account.provider).toBe('gitlab')
    expect(account.id).toBe('gitlab:2')
  })

  it('authenticates Bitbucket with the Atlassian email and pages with `next`', async () => {
    const auth = `Basic ${Buffer.from('me@example.com:api-token').toString('base64')}`
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe(auth)
      const url = String(input)
      if (url.endsWith('/user')) {
        return new Response(JSON.stringify({ uuid: '{bb}', username: 'bbuser', display_name: 'BB' }), { status: 200 })
      }
      const repo = (name: string): Record<string, unknown> => ({
        uuid: `{${name}}`,
        name,
        full_name: `team/${name}`,
        description: null,
        is_private: true,
        links: { clone: [{ name: 'https', href: `https://bitbucket.org/team/${name}.git` }], html: { href: '' } }
      })
      if (url.includes('page=2')) return new Response(JSON.stringify({ values: [repo('b')] }), { status: 200 })
      return new Response(
        JSON.stringify({ values: [repo('a')], next: 'https://api.bitbucket.org/2.0/repositories?page=2' }),
        { status: 200 }
      )
    })
    globalThis.fetch = fetchMock as typeof fetch

    const { account, authUser } = await connectWithToken('bitbucket', 'api-token', 'me@example.com')
    expect(account).toMatchObject({ provider: 'bitbucket', username: 'bbuser' })
    expect(authUser).toBe('me@example.com')
    const repos = await listRemoteRepos(account, 'api-token', authUser)
    expect(repos.map((r) => r.fullName)).toEqual(['team/a', 'team/b'])
  })

  it('requires the Atlassian email for Bitbucket', async () => {
    await expect(connectWithToken('bitbucket', 'api-token')).rejects.toThrow(/Atlassian account email/)
    const legacy: ProviderAccount = {
      id: 'bitbucket:{x}',
      provider: 'bitbucket',
      username: 'x',
      displayName: 'X',
      host: 'bitbucket.org'
    }
    await expect(listRemoteRepos(legacy, 'token')).rejects.toThrow(/Reconnect/)
  })

  it('rejects failed auth', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch
    await expect(connectWithToken('github', 'bad')).rejects.toThrow(/GitHub auth failed \(401\)/)
  })

  it('parses Link headers', () => {
    expect(nextLink('<https://x/?page=3>; rel="next", <https://x/?page=9>; rel="last"')).toBe('https://x/?page=3')
    expect(nextLink('<https://x/?page=1>; rel="prev"')).toBeNull()
    expect(nextLink(null)).toBeNull()
  })
})

describe('provider account shape', () => {
  it('keeps transport credentials out of account DTO', () => {
    const account: ProviderAccount = {
      id: 'github:1',
      provider: 'github',
      username: 'a',
      displayName: 'A',
      host: 'github.com'
    }
    expect('token' in account).toBe(false)
  })
})
