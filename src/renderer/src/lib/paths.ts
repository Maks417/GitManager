/** Compare repository paths the way Windows and macOS file systems do (separators and case). */
export function sameRepoPath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}
