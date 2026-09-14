export interface ListNavOptions {
  /** Items PageUp and PageDown move by. */
  pageSize?: number
  /** Arrow keys go round from one end to the other, as in a menu. */
  wrap?: boolean
}

/**
 * Where a navigation key moves in a list of `count` items: ↑/↓, PageUp/PageDown, Home and End. Null for
 * other keys and for an empty list. `index` -1 means nothing is selected yet, so moving down starts at
 * the first item and moving up at the last. Without `wrap`, moves stop at the ends.
 */
export function nextListIndex(key: string, index: number, count: number, options: ListNavOptions = {}): number | null {
  if (count <= 0) return null
  const last = count - 1
  const pageSize = Math.max(1, options.pageSize ?? 10)
  const clamp = (i: number): number => Math.min(last, Math.max(0, i))
  const step = (delta: number): number => {
    if (index < 0) return delta > 0 ? 0 : last
    if (!options.wrap) return clamp(index + delta)
    return (((index + delta) % count) + count) % count
  }
  switch (key) {
    case 'ArrowDown':
      return step(1)
    case 'ArrowUp':
      return step(-1)
    case 'PageDown':
      return index < 0 ? 0 : clamp(index + pageSize)
    case 'PageUp':
      return index < 0 ? last : clamp(index - pageSize)
    case 'Home':
      return 0
    case 'End':
      return last
    default:
      return null
  }
}
