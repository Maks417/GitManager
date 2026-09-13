/**
 * Helpers for building portable `git log` argv (Windows + macOS / Apple Git + Homebrew).
 */

/** Escape a user string for `--basic-regexp` so metacharacters match literally. */
export function escapeBasicRegexp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)
}

const SHA_PREFIX_RE = /^[0-9a-f]{4,40}$/i

export function isShaLike(text: string): boolean {
  return SHA_PREFIX_RE.test(text.trim())
}

export function looksLikeAuthorQuery(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.includes('@')) return true
  // "First Last" style — prefer --author over --grep
  return /\s/.test(t) && !/[\\/]/.test(t)
}
