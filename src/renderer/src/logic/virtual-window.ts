export interface VirtualWindow {
  startIndex: number
  endIndex: number
  offsetY: number
}

/**
 * Visible slice of a fixed-height virtual list, including `overscan` rows above and below the
 * viewport so scrolling does not flash empty space.
 */
export function virtualWindow(
  scrollTop: number,
  viewportH: number,
  totalRows: number,
  rowHeight: number,
  overscan: number
): VirtualWindow {
  if (totalRows <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, offsetY: 0 }
  }
  const startIndex = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowHeight) - overscan)
  const visibleCount = Math.ceil(Math.max(0, viewportH) / rowHeight) + overscan * 2
  const endIndex = Math.min(totalRows, startIndex + visibleCount)
  return { startIndex, endIndex, offsetY: startIndex * rowHeight }
}
