import { app } from 'electron'
import type { AppUpdater } from 'electron-updater'
import type { UpdateStatus } from '@shared/ipc'

/**
 * Loaded on first use to keep it off the startup path. electron-updater is CommonJS and defines
 * `autoUpdater` as a lazy getter, which import() does not detect as a named export (it comes back
 * undefined in the packaged app), so read it from the module object instead.
 */
async function loadAutoUpdater(): Promise<AppUpdater> {
  const mod = (await import('electron-updater')) as unknown as {
    default?: { autoUpdater: AppUpdater }
    autoUpdater?: AppUpdater
  }
  const autoUpdater = mod.default?.autoUpdater ?? mod.autoUpdater
  if (!autoUpdater) throw new Error('The updater is not available in this build.')
  return autoUpdater
}

let status: UpdateStatus = {
  checking: false,
  available: false,
  downloaded: false,
  version: null,
  releaseNotes: null,
  error: null,
  progress: null
}

const listeners = new Set<(s: UpdateStatus) => void>()

function emit(): void {
  for (const l of listeners) l({ ...status })
}

function setStatus(partial: Partial<UpdateStatus>): UpdateStatus {
  status = { ...status, ...partial }
  emit()
  return status
}

export function getUpdateStatus(): UpdateStatus {
  return { ...status }
}

export function subscribeUpdateStatus(cb: (s: UpdateStatus) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  setStatus({ checking: true, error: null })

  if (!app.isPackaged) {
    // Dev mode: simulate a no-op check so UI can be exercised
    await new Promise((r) => setTimeout(r, 400))
    return setStatus({
      checking: false,
      available: false,
      downloaded: false,
      version: app.getVersion(),
      releaseNotes: null,
      progress: null,
      error: null
    })
  }

  try {
    const autoUpdater = await loadAutoUpdater()
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.removeAllListeners()
    autoUpdater.on('checking-for-update', () => setStatus({ checking: true, error: null }))
    autoUpdater.on('update-available', (info) =>
      setStatus({
        checking: false,
        available: true,
        version: info.version,
        releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : null
      })
    )
    autoUpdater.on('update-not-available', () =>
      setStatus({ checking: false, available: false, version: app.getVersion() })
    )
    autoUpdater.on('download-progress', (p) => setStatus({ progress: p.percent }))
    autoUpdater.on('update-downloaded', (info) =>
      setStatus({
        downloaded: true,
        available: true,
        version: info.version,
        progress: 100
      })
    )
    autoUpdater.on('error', (err) => setStatus({ checking: false, error: err.message }))

    await autoUpdater.checkForUpdates()
    return getUpdateStatus()
  } catch (err) {
    return setStatus({
      checking: false,
      error: err instanceof Error ? err.message : String(err)
    })
  }
}

export function installUpdate(): void {
  if (!app.isPackaged) return
  loadAutoUpdater()
    .then((autoUpdater) => autoUpdater.quitAndInstall())
    .catch((err: unknown) => setStatus({ error: err instanceof Error ? err.message : String(err) }))
}

export function maybeCheckOnStartup(enabled: boolean): void {
  if (!enabled) return
  setTimeout(() => {
    void checkForUpdates()
  }, 2500)
}
