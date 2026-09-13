import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import { basename, join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import {
  CloneRequestSchema,
  DiffRequestSchema,
  HistoryQuerySchema,
  IpcChannels,
  SetGitIdentityRequestSchema,
  WorkingTreeDiffRequestSchema,
  type ProviderAccount,
  type UpdateStatus
} from '@shared/ipc'
import * as git from '../git-worker/client'
import { probeGit } from '../git-worker/client'
import {
  getAccountToken,
  loadAccounts,
  loadPreferences,
  loadRepositories,
  saveAccounts,
  savePreferences,
  saveRepositories,
  storeAccountToken
} from './storage'
import { connectWithToken, listRemoteRepos } from './providers'
import { checkForUpdates, getUpdateStatus, installUpdate, subscribeUpdateStatus } from './updater'
import { applyWindowThemeBackground } from './theme'

function assertSender(event: Electron.IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (!url.startsWith('file:') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
    throw new Error('Blocked IPC from untrusted frame')
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannels.repo.list, async (event) => {
    assertSender(event)
    return loadRepositories()
  })

  ipcMain.handle(IpcChannels.repo.add, async (event, path: string) => {
    assertSender(event)
    const repo = await git.inspectRepository(path)
    const repos = loadRepositories().filter((r) => r.path !== repo.path)
    repos.unshift(repo)
    saveRepositories(repos)
    return repo
  })

  ipcMain.handle(IpcChannels.repo.remove, async (event, id: string) => {
    assertSender(event)
    saveRepositories(loadRepositories().filter((r) => r.id !== id))
  })

  ipcMain.handle(IpcChannels.repo.openDialog, async (event) => {
    assertSender(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    const repo = await git.inspectRepository(result.filePaths[0])
    const repos = loadRepositories().filter((r) => r.path !== repo.path)
    repos.unshift(repo)
    saveRepositories(repos)
    return repo
  })

  ipcMain.handle(IpcChannels.repo.create, async (event, path: string) => {
    assertSender(event)
    if (!existsSync(path)) mkdirSync(path, { recursive: true })
    const repo = await git.initRepository(path)
    const repos = loadRepositories().filter((r) => r.path !== repo.path)
    repos.unshift(repo)
    saveRepositories(repos)
    return repo
  })

  ipcMain.handle(IpcChannels.repo.clone, async (event, raw: unknown) => {
    assertSender(event)
    const request = CloneRequestSchema.parse(raw)
    const name = basename(request.url.replace(/\.git$/, '').replace(/\/$/, '').split('/').pop() || 'repo')
    const target = join(request.targetDir, name)
    const repo = await git.cloneRepository(request.url, target)
    const repos = loadRepositories().filter((r) => r.path !== repo.path)
    repos.unshift(repo)
    saveRepositories(repos)
    return repo
  })

  ipcMain.handle(IpcChannels.repo.pickDirectory, async (event) => {
    assertSender(event)
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle(IpcChannels.repo.get, async (event, id: string) => {
    assertSender(event)
    const existing = loadRepositories().find((r) => r.id === id)
    if (!existing) return null
    return git.inspectRepository(existing.path)
  })

  ipcMain.handle(IpcChannels.repo.status, async (event, repoPath: string) => {
    assertSender(event)
    const prefs = loadPreferences()
    return git.getStatus(repoPath, prefs.statusUntracked ?? 'normal')
  })

  ipcMain.handle(IpcChannels.repo.branches, async (event, repoPath: string) => {
    assertSender(event)
    return git.getBranches(repoPath)
  })

  ipcMain.handle(IpcChannels.history.load, async (event, raw: unknown) => {
    assertSender(event)
    return git.loadHistory(HistoryQuerySchema.parse(raw))
  })

  ipcMain.handle(IpcChannels.history.commitDetail, async (event, repoPath: string, sha: string) => {
    assertSender(event)
    return git.getCommitDetail(repoPath, sha)
  })

  ipcMain.handle(IpcChannels.history.fileDiff, async (event, raw: unknown) => {
    assertSender(event)
    const req = DiffRequestSchema.parse(raw)
    return git.getFileDiff(req.repoPath, req.sha, req.path, req.parentIndex)
  })

  ipcMain.handle(IpcChannels.history.workingTreeDiff, async (event, raw: unknown) => {
    assertSender(event)
    const req = WorkingTreeDiffRequestSchema.parse(raw)
    return git.getWorkingTreeDiff(req.repoPath, req.path, req.side)
  })

  ipcMain.handle(IpcChannels.git.probe, async (event) => {
    assertSender(event)
    return probeGit()
  })

  ipcMain.handle(IpcChannels.git.stage, async (event, repoPath: string, paths: string[]) => {
    assertSender(event)
    await git.stagePaths(repoPath, paths)
  })
  ipcMain.handle(IpcChannels.git.unstage, async (event, repoPath: string, paths: string[]) => {
    assertSender(event)
    await git.unstagePaths(repoPath, paths)
  })
  ipcMain.handle(IpcChannels.git.commit, async (event, repoPath: string, message: string, amend?: boolean) => {
    assertSender(event)
    return git.commit(repoPath, message, amend)
  })
  ipcMain.handle(IpcChannels.git.fetch, async (event, repoPath: string) => {
    assertSender(event)
    await git.fetchRemote(repoPath)
  })
  ipcMain.handle(IpcChannels.git.pull, async (event, repoPath: string) => {
    assertSender(event)
    await git.pullRemote(repoPath)
  })
  ipcMain.handle(IpcChannels.git.push, async (event, repoPath: string) => {
    assertSender(event)
    await git.pushRemote(repoPath)
  })
  ipcMain.handle(IpcChannels.git.checkout, async (event, repoPath: string, ref: string) => {
    assertSender(event)
    await git.checkoutRef(repoPath, ref)
  })
  ipcMain.handle(IpcChannels.git.createBranch, async (event, repoPath: string, name: string, checkout?: boolean) => {
    assertSender(event)
    await git.createBranch(repoPath, name, checkout ?? true)
  })
  ipcMain.handle(IpcChannels.git.deleteBranch, async (event, repoPath: string, name: string, force?: boolean) => {
    assertSender(event)
    await git.deleteBranch(repoPath, name, force ?? false)
  })
  ipcMain.handle(IpcChannels.git.merge, async (event, repoPath: string, ref: string) => {
    assertSender(event)
    return git.mergeRef(repoPath, ref)
  })
  ipcMain.handle(IpcChannels.git.rebase, async (event, repoPath: string, upstream: string) => {
    assertSender(event)
    return git.rebaseOnto(repoPath, upstream)
  })
  ipcMain.handle(IpcChannels.git.rebaseContinue, async (event, repoPath: string) => {
    assertSender(event)
    return git.rebaseContinue(repoPath)
  })
  ipcMain.handle(IpcChannels.git.rebaseAbort, async (event, repoPath: string) => {
    assertSender(event)
    await git.rebaseAbort(repoPath)
  })
  ipcMain.handle(IpcChannels.git.rebaseInProgress, async (event, repoPath: string) => {
    assertSender(event)
    return git.isRebaseInProgress(repoPath)
  })
  ipcMain.handle(IpcChannels.git.stash, async (event, repoPath: string, message?: string) => {
    assertSender(event)
    await git.stashSave(repoPath, message)
  })
  ipcMain.handle(IpcChannels.git.stashList, async (event, repoPath: string) => {
    assertSender(event)
    return git.listStashes(repoPath)
  })
  ipcMain.handle(IpcChannels.git.stashApply, async (event, repoPath: string, ref?: string) => {
    assertSender(event)
    await git.stashApply(repoPath, ref)
  })
  ipcMain.handle(IpcChannels.git.stashPop, async (event, repoPath: string, ref?: string) => {
    assertSender(event)
    await git.stashPop(repoPath, ref)
  })
  ipcMain.handle(IpcChannels.git.stashDrop, async (event, repoPath: string, ref?: string) => {
    assertSender(event)
    await git.stashDrop(repoPath, ref)
  })
  ipcMain.handle(IpcChannels.git.discard, async (event, repoPath: string, paths: string[]) => {
    assertSender(event)
    await git.discardPaths(repoPath, paths)
  })
  ipcMain.handle(IpcChannels.git.getIdentity, async (event, repoPath: string) => {
    assertSender(event)
    return git.getGitIdentity(repoPath)
  })
  ipcMain.handle(IpcChannels.git.setIdentity, async (event, raw: unknown) => {
    assertSender(event)
    const req = SetGitIdentityRequestSchema.parse(raw)
    return git.setGitIdentity(req.repoPath, req.name, req.email, req.scope)
  })

  ipcMain.handle(IpcChannels.merge.listConflicts, async (event, repoPath: string) => {
    assertSender(event)
    return git.listConflictFiles(repoPath)
  })
  ipcMain.handle(IpcChannels.merge.getSides, async (event, repoPath: string, path: string) => {
    assertSender(event)
    return git.getMergeSides(repoPath, path)
  })
  ipcMain.handle(IpcChannels.merge.saveResult, async (event, repoPath: string, path: string, content: string) => {
    assertSender(event)
    await git.saveMergeResult(repoPath, path, content)
  })

  ipcMain.handle(IpcChannels.providers.listAccounts, async (event) => {
    assertSender(event)
    return loadAccounts().map(({ tokenEnc: _t, tokenPlain: _p, ...rest }) => rest)
  })

  ipcMain.handle(IpcChannels.providers.connect, async (event, provider: ProviderAccount['provider']) => {
    assertSender(event)
    // Device/PAT flow is completed via saveToken from UI for all providers in v1
    throw new Error(`Use token connect for ${provider}. OAuth broker is available under services/oauth-broker.`)
  })

  ipcMain.handle(
    IpcChannels.providers.saveToken,
    async (event, provider: ProviderAccount['provider'], token: string, username?: string) => {
      assertSender(event)
      const account = await connectWithToken(provider, token, username)
      return storeAccountToken(account, token)
    }
  )

  ipcMain.handle(IpcChannels.providers.disconnect, async (event, accountId: string) => {
    assertSender(event)
    saveAccounts(loadAccounts().filter((a) => a.id !== accountId))
  })

  ipcMain.handle(IpcChannels.providers.listRepos, async (event, accountId: string) => {
    assertSender(event)
    const account = loadAccounts().find((a) => a.id === accountId)
    if (!account) throw new Error('Account not found')
    const token = getAccountToken(accountId)
    if (!token) throw new Error('Missing credentials')
    return listRemoteRepos(account, token)
  })

  ipcMain.handle(IpcChannels.prefs.get, async (event) => {
    assertSender(event)
    return loadPreferences()
  })
  ipcMain.handle(IpcChannels.prefs.set, async (event, partial: unknown) => {
    assertSender(event)
    const next = savePreferences(partial as Record<string, unknown>)
    applyWindowThemeBackground(next.theme)
    return next
  })

  ipcMain.handle(IpcChannels.updater.status, async (event) => {
    assertSender(event)
    return getUpdateStatus()
  })
  ipcMain.handle(IpcChannels.updater.check, async (event) => {
    assertSender(event)
    return checkForUpdates()
  })
  ipcMain.handle(IpcChannels.updater.install, async (event) => {
    assertSender(event)
    installUpdate()
  })

  ipcMain.handle(IpcChannels.app.getInfo, async (event) => {
    assertSender(event)
    return {
      name: 'Git Manager',
      version: app.getVersion(),
      architecture: process.arch,
      homepage: 'https://github.com/Maks417/GitManager'
    }
  })

  ipcMain.handle(IpcChannels.shell.openExternal, async (event, url: string) => {
    assertSender(event)
    if (!/^https?:/i.test(url)) throw new Error('Only http(s) URLs allowed')
    await shell.openExternal(url)
  })
  ipcMain.handle(IpcChannels.shell.openPath, async (event, path: string) => {
    assertSender(event)
    return shell.openPath(path)
  })
  ipcMain.handle(IpcChannels.shell.showItemInFolder, async (event, path: string) => {
    assertSender(event)
    shell.showItemInFolder(path)
  })

  subscribeUpdateStatus((status: UpdateStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.updater.onStatus, status)
    }
  })
}
