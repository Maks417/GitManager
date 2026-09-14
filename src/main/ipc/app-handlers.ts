import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { IpcChannels, type UpdateStatus } from '@shared/ipc'
import { z } from 'zod'
import { checkForUpdates, getUpdateStatus, installUpdate, subscribeUpdateStatus } from '../updater'
import { subscribeRepoWatch, subscribeRepoWatchState } from '../repo-watcher'
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
