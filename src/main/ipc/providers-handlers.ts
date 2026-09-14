import { ipcMain } from 'electron'
import { IpcChannels, ProviderIdSchema } from '@shared/ipc'
import type { ProviderId } from '@shared/providers'
import { connectWithToken, listRemoteRepos } from '../providers'
import { getAccountToken, loadAccounts, saveAccounts, storeAccountToken } from '../storage'
import { assertSender } from './assert-sender'
import { NonEmptyStringSchema, parseAccountId } from './parse'

/** An optional text argument: missing or empty means not given. */
function optionalText(raw: unknown): string | undefined {
  return raw === undefined || raw === null || raw === '' ? undefined : NonEmptyStringSchema.parse(raw)
}

export function registerProvidersHandlers(): void {
  ipcMain.handle(IpcChannels.providers.listAccounts, async (event) => {
    assertSender(event)
    return loadAccounts().map(({ tokenEnc: _t, tokenScheme, authUser: _u, ...rest }) => ({
      ...rest,
      secureStorage: tokenScheme !== 'plain'
    }))
  })

  ipcMain.handle(
    IpcChannels.providers.saveToken,
    async (event, providerRaw: unknown, tokenRaw: unknown, username?: unknown, baseUrl?: unknown) => {
      assertSender(event)
      const provider = ProviderIdSchema.parse(providerRaw) as ProviderId
      const token = NonEmptyStringSchema.parse(tokenRaw)
      const { account, authUser } = await connectWithToken(provider, token, optionalText(username), {
        baseUrl: optionalText(baseUrl)
      })
      return storeAccountToken(account, token, authUser)
    }
  )

  ipcMain.handle(IpcChannels.providers.disconnect, async (event, accountId: unknown) => {
    assertSender(event)
    const id = parseAccountId(accountId)
    saveAccounts(loadAccounts().filter((a) => a.id !== id))
  })

  ipcMain.handle(IpcChannels.providers.listRepos, async (event, accountId: unknown) => {
    assertSender(event)
    const id = parseAccountId(accountId)
    const account = loadAccounts().find((a) => a.id === id)
    if (!account) throw new Error('Account not found')
    const token = getAccountToken(id)
    if (!token) throw new Error('Missing credentials')
    return listRemoteRepos(account, token, account.authUser)
  })
}
