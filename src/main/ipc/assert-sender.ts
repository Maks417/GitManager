export function assertSender(event: Electron.IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? ''
  if (!url.startsWith('file:') && !url.startsWith('http://localhost') && !url.startsWith('http://127.0.0.1')) {
    throw new Error('Blocked IPC from untrusted frame')
  }
}
