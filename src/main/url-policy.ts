function withoutHashAndQuery(url: string): URL | null {
  try {
    const u = new URL(url)
    u.hash = ''
    u.search = ''
    return u
  } catch {
    return null
  }
}

/**
 * True when `candidate` is the renderer entry point. Packaged builds must match the exact
 * `file://…/index.html` (any other local file is foreign content); the dev server is matched
 * by origin because Vite serves the app from many paths.
 */
export function isAppUrl(candidate: string, appUrl: string, platform: string = process.platform): boolean {
  const c = withoutHashAndQuery(candidate)
  const a = withoutHashAndQuery(appUrl)
  if (!c || !a) return false
  if (a.protocol === 'file:') {
    if (c.protocol !== 'file:') return false
    const norm = (u: URL): string => {
      const path = decodeURIComponent(u.pathname)
      return platform === 'win32' || platform === 'darwin' ? path.toLowerCase() : path
    }
    return c.host === a.host && norm(c) === norm(a)
  }
  return c.origin === a.origin
}
