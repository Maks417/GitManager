import { isAbsolute, relative, resolve, sep } from 'path'

/** True when `target` is `base` itself or lives underneath it (lexical check, no symlink resolution). */
export function isPathInside(base: string, target: string): boolean {
  const rel = relative(resolve(base), resolve(target))
  if (rel === '') return true
  if (isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${sep}`)
}
