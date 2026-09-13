/** Full/short SHA used for commit selection and git object checks (7–40 hex). */
export const SHA_RE = /^[0-9a-f]{7,40}$/i

/** Looser prefix match for history search (4–40 hex). */
export const SHA_PREFIX_RE = /^[0-9a-f]{4,40}$/i

export function isSha(text: string): boolean {
  return SHA_RE.test(text.trim())
}

export function isShaPrefix(text: string): boolean {
  return SHA_PREFIX_RE.test(text.trim())
}
