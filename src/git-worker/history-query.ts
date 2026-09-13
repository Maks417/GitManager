/**
 * Helpers for building portable `git log` argv (Windows + macOS / Apple Git + Homebrew).
 */
import { isShaPrefix } from '@shared/sha'

/** Escape a user string for `--basic-regexp` so metacharacters match literally. */
export function escapeBasicRegexp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)
}

export function isShaLike(text: string): boolean {
  return isShaPrefix(text)
}

export function looksLikeAuthorQuery(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (t.includes('@')) return true
  // "First Last" style — prefer --author over --grep
  return /\s/.test(t) && !/[\\/]/.test(t)
}
