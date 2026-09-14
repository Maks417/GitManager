const TIMEOUT_MS = 20_000

/** Upper bound on listing pages (100 repositories each), so a huge account can't stall the dialog. */
export const MAX_PAGES = 10

export async function fetchJson(
  url: string,
  headers: Record<string, string>,
  errorPrefix: string
): Promise<{ data: unknown; headers: Headers }> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GitManager', ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  if (!res.ok) throw new Error(`${errorPrefix} (${res.status})`)
  return { data: await res.json(), headers: res.headers }
}

/** URL of the next page from an RFC 8288 `Link` header (GitHub, GitLab). */
export function nextLink(link: string | null): string | null {
  if (!link) return null
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part)
    if (m) return m[1]
  }
  return null
}

/** Whether `url` has the scheme, host and port of `base`. */
export function sameOrigin(url: string, base: string): boolean {
  try {
    return new URL(url).origin === new URL(base).origin
  } catch {
    return false
  }
}

/**
 * The next page, only while it stays on the origin of `base`: every request carries the account's token, so a
 * paging link to any other host is not followed.
 */
export function nextLinkOnOrigin(link: string | null, base: string): string | null {
  const next = nextLink(link)
  return next && sameOrigin(next, base) ? next : null
}
