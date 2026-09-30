import { describe, expect, it, vi } from 'vitest'

const fakeUpdater = vi.hoisted(() => {
  // A stand-in for electron-updater's AppUpdater that finds no newer release.
  const listeners = new Map<string, Array<(arg?: unknown) => void>>()
  const emit = (event: string, arg?: unknown): void => listeners.get(event)?.forEach((fn) => fn(arg))
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    on(event: string, fn: (arg?: unknown) => void) {
      listeners.set(event, [...(listeners.get(event) ?? []), fn])
      return this
    },
    removeAllListeners() {
      listeners.clear()
      return this
    },
    checkForUpdates: vi.fn(async () => {
      emit('checking-for-update')
      emit('update-not-available', { version: '1.0.0' })
      return null
    }),
    quitAndInstall: vi.fn()
  }
})

vi.mock('electron', () => ({ app: { isPackaged: true, getVersion: () => '1.0.0' } }))
// What import() of electron-updater gives the packaged app: CommonJS, with `autoUpdater` defined as a
// getter that Node does not detect as a named export, so it is only reachable through `default`.
vi.mock('electron-updater', () => ({ default: { autoUpdater: fakeUpdater } }))

describe('updater in a packaged app', () => {
  it('checks for updates when electron-updater only exposes autoUpdater on its default export', async () => {
    const { checkForUpdates } = await import('../src/main/updater')
    const status = await checkForUpdates()
    expect(status).toMatchObject({ checking: false, available: false, error: null, version: '1.0.0' })
    expect(fakeUpdater.autoDownload).toBe(true)
    expect(fakeUpdater.checkForUpdates).toHaveBeenCalledOnce()
  })

  it('installs a downloaded update through the same updater', async () => {
    const { installUpdate } = await import('../src/main/updater')
    installUpdate()
    await vi.waitFor(() => expect(fakeUpdater.quitAndInstall).toHaveBeenCalledOnce())
  })
})
