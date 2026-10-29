import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { IpcChannels, type UpdateStatus } from '@shared/ipc'
import { z } from 'zod'
import { checkForUpdates, getUpdateStatus, installUpdate, subscribeUpdateStatus } from '../updater'
import { subscribeRepoWatch, subscribeRepoWatchState } from '../repo-watcher'
import { listWorktreeItems } from '../../git-worker/client'
import { resolveRepoPath } from '../../git-worker/ops/guards'
import { samePath } from '../../git-worker/ops/worktrees'
import { assertSender } from './assert-sender'

export function registerAppHandlers(): void {
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

  ipcMain.handle(IpcChannels.shell.openExternal, async (event, raw: unknown) => {
    assertSender(event)
    const url = new URL(z.string().parse(raw))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Only http(s) URLs allowed')
    }
    await shell.openExternal(url.href)
  })

  ipcMain.handle(IpcChannels.shell.showInFolder, async (event, repoPath: unknown, path: unknown) => {
    assertSender(event)
    // Only paths inside the repository, never one that climbs out of it.
    shell.showItemInFolder(resolveRepoPath(z.string().min(1).parse(repoPath), z.string().min(1).parse(path)))
  })
  ipcMain.handle(IpcChannels.shell.openWorktreeFolder, async (event, repoPath: unknown, path: unknown) => {
    assertSender(event)
    // Only a folder Git lists as a worktree of the repository.
    const folder = z.string().min(1).parse(path)
    const items = await listWorktreeItems(z.string().min(1).parse(repoPath))
    const item = items.find((i) => samePath(i.path, folder))
    if (!item) throw new Error(`${folder} is not a worktree of this repository.`)
    const failure = await shell.openPath(item.path)
    if (failure) throw new Error(failure)
  })

  subscribeUpdateStatus((status: UpdateStatus) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.updater.onStatus, status)
    }
  })

  subscribeRepoWatch((payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.repo.onChanged, payload)
    }
  })

  subscribeRepoWatchState((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.repo.onWatchState, state)
    }
  })
}
