import type { ProviderAccount, RemoteRepo } from '@shared/ipc'
import type { ProviderId } from '@shared/providers'
import { connectBitbucket, listBitbucketRepos } from './bitbucket'
import { connectGitHub, listGitHubRepos } from './github'
import { connectGitLab, listGitLabRepos } from './gitlab'

export async function connectWithToken(
  provider: ProviderId,
  token: string,
  username?: string
): Promise<ProviderAccount> {
  if (provider === 'github') return connectGitHub(token)
  if (provider === 'gitlab') return connectGitLab(token)
  return connectBitbucket(token, username)
}

export async function listRemoteRepos(account: ProviderAccount, token: string): Promise<RemoteRepo[]> {
  if (account.provider === 'github') return listGitHubRepos(token)
  if (account.provider === 'gitlab') return listGitLabRepos(token)
  return listBitbucketRepos(account, token)
}
