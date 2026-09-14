/** Compare repository paths the way Windows and macOS file systems do (separators and case). */
export function sameRepoPath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

/** `parent` joined with a folder `name`, using the separator `parent` already uses (for display). */
export function joinDisplayPath(parent: string, name: string): string {
  const separator = parent.includes('\\') ? '\\' : '/'
  return `${parent.replace(/[\\/]+$/, '')}${separator}${name}`
}
