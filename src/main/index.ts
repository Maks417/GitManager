import { BrowserWindow, app, nativeTheme, session } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { registerIpcHandlers } from './ipc'
import { buildAppMenu } from './menu'
import { loadPreferences } from './storage'
import { applyWindowThemeBackground, resolvedWindowBackground } from './theme'
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

/** Block Chromium chrome shortcuts (DevTools, fullscreen, reload, zoom). */
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
      return
    }

    if (ctrlOrCmd && (key === '=' || key === '+' || key === '-' || key === '_' || key === '0')) {
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
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed =
      url.startsWith('file:') ||
      url.startsWith('http://localhost') ||
      url.startsWith('http://127.0.0.1')
    if (!allowed) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isDev = Boolean(process.env.ELECTRON_RENDERER_URL)
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          isDev
            ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https: http://localhost:* ws://localhost:* wss://localhost:*"
            : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https:"
        ]
      }
    })
  })

  registerIpcHandlers()
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
