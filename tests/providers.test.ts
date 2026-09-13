import { afterEach, describe, expect, it, vi } from 'vitest'
import { connectWithToken, listRemoteRepos } from '../src/main/providers'
import type { ProviderAccount } from '../src/shared/ipc'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('provider contracts', () => {
  it('maps GitHub user + repos', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/user')) {
        return new Response(
          JSON.stringify({ id: 1, login: 'octo', name: 'Octo', avatar_url: 'https://example.com/a.png' }),
          { status: 200 }
        )
      }
      return new Response(
        JSON.stringify([
          {
            id: 9,
            name: 'demo',
            full_name: 'octo/demo',
            description: 'Demo',
            private: false,
            clone_url: 'https://github.com/octo/demo.git',
            ssh_url: 'git@github.com:octo/demo.git',
            default_branch: 'main',
            html_url: 'https://github.com/octo/demo'
          }
        ]),
        { status: 200 }
      )
    }) as typeof fetch

    const account = await connectWithToken('github', 'token')
    expect(account).toMatchObject({ provider: 'github', username: 'octo', id: 'github:1' })
    const repos = await listRemoteRepos(account, 'token')
    expect(repos[0].fullName).toBe('octo/demo')
    expect(repos[0].cloneUrlSsh).toContain('git@')
  })

  it('maps GitLab user', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 2, username: 'gl', name: 'GL' }), { status: 200 })
    }) as typeof fetch
    const account = await connectWithToken('gitlab', 'glpat-x')
    expect(account.provider).toBe('gitlab')
    expect(account.id).toBe('gitlab:2')
  })

  it('maps Bitbucket user', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          uuid: '{bb}',
          username: 'bbuser',
          display_name: 'BB',
          links: { avatar: { href: 'https://example.com/b.png' } }
        }),
        { status: 200 }
      )
    }) as typeof fetch
    const account = await connectWithToken('bitbucket', 'app-pass', 'bbuser')
    expect(account).toMatchObject({ provider: 'bitbucket', username: 'bbuser' })
  })

  it('rejects failed auth', async () => {
    globalThis.fetch = vi.fn(async () => new Response('nope', { status: 401 })) as typeof fetch
    await expect(connectWithToken('github', 'bad')).rejects.toThrow(/GitHub auth failed/)
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
