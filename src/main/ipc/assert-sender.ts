import { isTrustedAppUrl } from '../app-url'

/** Only the app's own top-level document may call privileged IPC. */
export function assertSender(event: Electron.IpcMainInvokeEvent): void {
  const frame = event.senderFrame
  if (!frame || frame.parent !== null || !isTrustedAppUrl(frame.url)) {
    throw new Error('Blocked IPC from untrusted frame')
  }
}
