import { BrowserWindow, app, ipcMain, shell } from 'electron'
import { IpcChannels, type UpdateStatus } from '@shared/ipc'
import { checkForUpdates, getUpdateStatus, installUpdate, subscribeUpdateStatus } from '../updater'
import { subscribeRepoWatch } from '../repo-watcher'
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

  subscribeRepoWatch((payload) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IpcChannels.repo.onChanged, payload)
    }
  })
}
