import { app } from 'electron'
import type { UpdateStatus } from '@shared/ipc'

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
    const { autoUpdater } = await import('electron-updater')
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
  void import('electron-updater').then(({ autoUpdater }) => {
    autoUpdater.quitAndInstall()
  })
}

export function maybeCheckOnStartup(enabled: boolean): void {
  if (!enabled) return
  setTimeout(() => {
    void checkForUpdates()
  }, 2500)
}
