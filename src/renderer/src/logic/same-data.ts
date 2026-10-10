/**
 * Deep equality for data that came over IPC: plain objects, arrays and primitives. Refreshes return
 * new objects even when nothing changed; keeping the previous value when this holds lets components
 * that read it skip rendering.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false
    return true
  }
  if (Array.isArray(b)) return false
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false
    if (!sameData((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false
  }
  return true
}

/** `next`, or `prev` when it holds the same data: a state updater that keeps unchanged values. */
export function keepIfSame<T>(next: T): (prev: T) => T {
  return (prev) => (sameData(prev, next) ? prev : next)
}
