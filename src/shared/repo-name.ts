/** Names Windows reserves for devices, with or without an extension. */
const WINDOWS_DEVICE_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i

/**
 * Why `name` cannot be the folder of a new repository on Windows, macOS and Linux alike; null when it can.
 * Checked as the user types and again before anything is created.
 */
export function repoFolderNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a name for the repository folder.'
  if (name.trim() !== name) return 'The name cannot start or end with a space.'
  if (/[<>:"/\\|?*\x00-\x1f]/.test(name)) return 'The name cannot contain < > : " / \\ | ? * or control characters.'
  if (/^\.+$/.test(name)) return 'The name cannot be only dots.'
  // Windows silently drops a trailing dot, so the folder would get another name than the one typed.
  if (name.endsWith('.')) return 'The name cannot end with a dot.'
  if (WINDOWS_DEVICE_NAME.test(name)) return `"${name}" is reserved for devices on Windows.`
  if (name.length > 255) return 'The name is too long.'
  return null
}
