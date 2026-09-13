/** Strip Electron IPC wrapper so banners show the actionable message. */
export function toErrorMessage(err: unknown): string {
  let msg = err instanceof Error ? err.message : String(err)
  msg = msg.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/i, '')
  return msg.trim() || 'Something went wrong'
}
