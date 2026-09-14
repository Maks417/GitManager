import { isSha } from '@shared/sha'

export type HistorySearch =
  | { kind: 'sha'; sha: string; text: string }
  | { kind: 'author'; text: string }
  | { kind: 'message'; text: string }

/**
 * Interpret the history search box: an explicit `author:` filter, a commit id (7–40 hex digits),
 * or plain text that is matched literally and case-insensitively against commit messages.
 */
export function parseHistorySearch(raw: string | undefined): HistorySearch | null {
  const text = raw?.trim() ?? ''
  if (!text) return null
  const author = /^author:\s*(.+)$/i.exec(text)
  if (author) return { kind: 'author', text: author[1].trim() }
  if (isSha(text)) return { kind: 'sha', sha: text, text }
  return { kind: 'message', text }
}
