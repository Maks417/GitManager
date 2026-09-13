import { ipcMain } from 'electron'
import { IpcChannels, ProviderIdSchema } from '@shared/ipc'
import type { ProviderId } from '@shared/providers'
import { connectWithToken, listRemoteRepos } from '../providers'
import { getAccountToken, loadAccounts, saveAccounts, storeAccountToken } from '../storage'
import { assertSender } from './assert-sender'
import { NonEmptyStringSchema, parseAccountId } from './parse'

export function registerProvidersHandlers(): void {
  ipcMain.handle(IpcChannels.providers.listAccounts, async (event) => {
    assertSender(event)
    return loadAccounts().map(({ tokenEnc: _t, tokenPlain: _p, ...rest }) => rest)
  })

  ipcMain.handle(
    IpcChannels.providers.saveToken,
    async (event, providerRaw: unknown, tokenRaw: unknown, username?: unknown) => {
      assertSender(event)
      const provider = ProviderIdSchema.parse(providerRaw) as ProviderId
      const token = NonEmptyStringSchema.parse(tokenRaw)
      const user =
        username === undefined || username === null || username === ''
          ? undefined
          : NonEmptyStringSchema.parse(username)
      const account = await connectWithToken(provider, token, user)
      return storeAccountToken(account, token)
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
    return listRemoteRepos(account, token)
  })
}
