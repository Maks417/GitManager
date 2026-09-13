import { ipcMain } from 'electron'
import { IpcChannels } from '@shared/ipc'
import { loadPreferences, savePreferences } from '../storage'
import { applyWindowThemeBackground } from '../theme'
import { assertSender } from './assert-sender'

export function registerPrefsHandlers(): void {
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
}
