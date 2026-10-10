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

/**
 * Visible slice of a fixed-height list whose first row sits `rowsTop` pixels into a scrolling container
 * that may hold other content above or below it (section headers, other lists). A list scrolled out of
 * view gets an empty slice at its nearer end.
 */
export function listWindow(
  scrollTop: number,
  viewportH: number,
  rowsTop: number,
  totalRows: number,
  rowHeight: number,
  overscan: number
): { startIndex: number; endIndex: number } {
  const { startIndex, endIndex } = virtualWindow(scrollTop - rowsTop, viewportH, totalRows, rowHeight, overscan)
  const start = Math.min(startIndex, totalRows)
  // Below the viewport, the window from virtualWindow (clamped to row 0) is already the right one.
  return { startIndex: start, endIndex: Math.max(start, endIndex) }
}

/** The scroll position that brings a row just inside the viewport, or null when it is already in view. */
export function scrollTopToReveal(scrollTop: number, viewportH: number, rowTop: number, rowHeight: number): number | null {
  if (rowTop < scrollTop) return rowTop
  if (rowTop + rowHeight > scrollTop + viewportH) return rowTop + rowHeight - viewportH
  return null
}
