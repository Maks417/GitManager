import { BrowserWindow, app, nativeTheme } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { getDevServerUrl, getRendererEntryFile, isTrustedAppUrl } from './app-url'
import { registerIpcHandlers } from './ipc'
import { buildAppMenu } from './menu'
import { loadPreferences } from './storage'
import { applyThemePreference, applyWindowThemeBackground, resolvedWindowBackground } from './theme'
import { maybeCheckOnStartup } from './updater'

function resolveAppIcon(): string | undefined {
  const candidates = app.isPackaged
    ? [
        join(process.resourcesPath, 'icon.ico'),
        join(process.resourcesPath, 'icon.png'),
        join(process.resourcesPath, 'build', 'icon.ico'),
        join(process.resourcesPath, 'build', 'icon.png')
      ]
    : [join(process.cwd(), 'build', 'icon.ico'), join(process.cwd(), 'build', 'icon.png')]
  return candidates.find((p) => existsSync(p))
}

/** Block Chromium chrome shortcuts (DevTools, fullscreen, reload). Zoom stays available via View. */
function blockChromiumShortcuts(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return

    const key = input.key.toLowerCase()
    const ctrlOrCmd = input.control || input.meta

    if (key === 'f12') {
      event.preventDefault()
      return
    }
    if (ctrlOrCmd && input.shift && (key === 'i' || key === 'j' || key === 'c')) {
      event.preventDefault()
      return
    }

    if (key === 'f11') {
      event.preventDefault()
      return
    }

    if (key === 'f5') {
      event.preventDefault()
      return
    }
    if (ctrlOrCmd && key === 'r') {
      event.preventDefault()
    }
  })

  win.webContents.on('devtools-opened', () => {
    win.webContents.closeDevTools()
  })
}

function createWindow(): void {
  const icon = resolveAppIcon()
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'Git Manager',
    backgroundColor: resolvedWindowBackground(),
    ...(icon ? { icon } : {}),
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      devTools: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())
  blockChromiumShortcuts(mainWindow)

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  // The renderer never navigates. This also stops a dropped file (e.g. an .html from a cloned
  // repo) from loading into a window that has the privileged preload bridge.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedAppUrl(url)) event.preventDefault()
  })

  const devServerUrl = getDevServerUrl()
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl)
  } else {
    void mainWindow.loadFile(getRendererEntryFile())
  }
}

// One instance per profile: two would overwrite each other's state files and run two updaters.
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return
  // CSP is a <meta> tag generated per build mode (see electron.vite.config.ts): response-header
  // injection does not apply to the file:// page of packaged builds.
  registerIpcHandlers()
  // Before any window exists, so its frame and menu bar start in the saved theme.
  applyThemePreference()
  buildAppMenu()
  createWindow()

  const prefs = loadPreferences()
  maybeCheckOnStartup(prefs.checkUpdatesOnStart)

  nativeTheme.on('updated', () => {
    if (loadPreferences().theme === 'system') applyWindowThemeBackground('system')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
