import { BrowserWindow, Menu, app } from 'electron'
import { checkForUpdates } from './updater'

function sendMenu(channel: string): void {
  BrowserWindow.getFocusedWindow()?.webContents.send(channel)
}

export function buildAppMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              {
                label: 'About Git Manager',
                click: () => sendMenu('menu:about')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Local Repository…',
          accelerator: 'CmdOrCtrl+O',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:add-repo')
        },
        {
          label: 'Clone Repository…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:clone-repo')
        },
        { type: 'separator' },
        {
          label: 'Accounts…',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:accounts')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'History',
          accelerator: 'CmdOrCtrl+1',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:view-history')
        },
        {
          label: 'Changes',
          accelerator: 'CmdOrCtrl+2',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:view-changes')
        },
        { type: 'separator' },
        {
          label: 'Focus History Search',
          accelerator: 'CmdOrCtrl+F',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:focus-search')
        },
        {
          label: 'Toggle Inspector Dock',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:toggle-dock')
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:toggle-sidebar')
        }
      ]
    },
    {
      label: 'Repository',
      submenu: [
        {
          label: 'Fetch',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:fetch')
        },
        {
          label: 'Pull',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:pull')
        },
        {
          label: 'Push',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:push')
        },
        { type: 'separator' },
        {
          label: 'New Branch…',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:create-branch')
        },
        {
          label: 'Merge…',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:merge')
        },
        {
          label: 'Rebase onto…',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:rebase')
        },
        { type: 'separator' },
        {
          label: 'Git Identity…',
          click: () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:identity')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => {
            void checkForUpdates()
            sendMenu('menu:updates')
          }
        },
        ...(!isMac
          ? [
              {
                label: 'About Git Manager',
                click: () => sendMenu('menu:about')
              }
            ]
          : [])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
