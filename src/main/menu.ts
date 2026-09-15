import { BrowserWindow, Menu, app } from 'electron'
import { MenuChannels } from '@shared/ipc'
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
                click: () => sendMenu(MenuChannels.about)
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
          label: 'New Repository…',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenu(MenuChannels.newRepo)
        },
        {
          label: 'Add Local Repository…',
          accelerator: 'CmdOrCtrl+O',
          click: () => sendMenu(MenuChannels.addRepo)
        },
        {
          label: 'Clone Repository…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => sendMenu(MenuChannels.cloneRepo)
        },
        { type: 'separator' },
        {
          label: 'Accounts…',
          click: () => sendMenu(MenuChannels.accounts)
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Required on macOS: without an Edit menu, Cmd+C / Cmd+V / Cmd+A / Cmd+Z do nothing in text inputs.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'History',
          accelerator: 'CmdOrCtrl+1',
          click: () => sendMenu(MenuChannels.viewHistory)
        },
        {
          label: 'Changes',
          accelerator: 'CmdOrCtrl+2',
          click: () => sendMenu(MenuChannels.viewChanges)
        },
        { type: 'separator' },
        {
          label: 'Focus History Search',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendMenu(MenuChannels.focusSearch)
        },
        {
          label: 'Toggle Inspector Dock',
          accelerator: 'CmdOrCtrl+Shift+D',
          click: () => sendMenu(MenuChannels.toggleDock)
        },
        {
          label: 'Toggle Side-by-Side Diff',
          click: () => sendMenu(MenuChannels.toggleDiffView)
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => sendMenu(MenuChannels.toggleSidebar)
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' }
      ]
    },
    {
      label: 'Repository',
      submenu: [
        {
          label: 'Fetch',
          accelerator: 'CmdOrCtrl+Shift+F',
          click: () => sendMenu(MenuChannels.fetch)
        },
        {
          label: 'Pull',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => sendMenu(MenuChannels.pull)
        },
        {
          // No accelerator on purpose: Ctrl/Cmd+Shift+P is the command palette in most editors,
          // and a push publishes commits.
          label: 'Push',
          click: () => sendMenu(MenuChannels.push)
        },
        { type: 'separator' },
        {
          label: 'New Branch…',
          click: () => sendMenu(MenuChannels.createBranch)
        },
        {
          label: 'Merge…',
          click: () => sendMenu(MenuChannels.merge)
        },
        {
          label: 'Rebase onto…',
          click: () => sendMenu(MenuChannels.rebase)
        },
        { type: 'separator' },
        {
          label: 'Git Identity…',
          click: () => sendMenu(MenuChannels.identity)
        }
      ]
    },
    ...(isMac ? [{ role: 'windowMenu' as const }] : []),
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => {
            void checkForUpdates()
            sendMenu(MenuChannels.updates)
          }
        },
        ...(!isMac
          ? [
              {
                label: 'About Git Manager',
                click: () => sendMenu(MenuChannels.about)
              }
            ]
          : [])
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
