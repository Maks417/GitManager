import type { ProviderAccount, RemoteRepo } from '@shared/ipc'
import type { ProviderId } from '@shared/providers'
import { connectBitbucket, listBitbucketRepos } from './bitbucket'
import { connectGitHub, listGitHubRepos } from './github'
import { connectGitLab, listGitLabRepos } from './gitlab'

/**
 * Validates the token against the host. `authUser` is the identity the token must be paired with
 * for later API calls (the Atlassian email for Bitbucket); it is stored with the token.
 */
export async function connectWithToken(
  provider: ProviderId,
  token: string,
  username?: string
): Promise<{ account: ProviderAccount; authUser?: string }> {
  if (provider === 'github') return { account: await connectGitHub(token) }
  if (provider === 'gitlab') return { account: await connectGitLab(token) }
  return connectBitbucket(token, username)
}

export async function listRemoteRepos(
  account: ProviderAccount,
  token: string,
  authUser?: string
): Promise<RemoteRepo[]> {
  if (account.provider === 'github') return listGitHubRepos(token)
  if (account.provider === 'gitlab') return listGitLabRepos(token)
  if (!authUser) {
    throw new Error('Reconnect this Bitbucket account with your Atlassian account email and an API token.')
  }
  return listBitbucketRepos(authUser, token)
}
