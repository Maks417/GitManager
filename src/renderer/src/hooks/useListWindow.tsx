import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { listWindow, scrollTopToReveal } from '../logic/virtual-window'

/** Marks a rendered row of a windowed list; the first one gives the row height. */
export const LIST_ROW_ATTR = 'data-list-row'

export interface ListWindow {
  startIndex: number
  endIndex: number
  rowHeight: number
  /** Scroll the container just enough to show row `index`. */
  scrollToRow: (index: number) => void
}

/**
 * Renders only the rows of a long list that are near the viewport. The list (`listRef`) scrolls inside
 * `scrollerRef`, which may be the list itself or a container that also holds other content. The list
 * must start with a spacer element (see `ListSpacer`) and mark its rows with `LIST_ROW_ATTR`; every
 * row has the height of the first one.
 */
export function useListWindow(
  scrollerRef: React.RefObject<HTMLElement | null>,
  listRef: React.RefObject<HTMLElement | null>,
  count: number,
  { overscan = 10, fallbackRowHeight = 34 }: { overscan?: number; fallbackRowHeight?: number } = {}
): ListWindow {
  const [range, setRange] = useState(() => ({
    startIndex: 0,
    endIndex: Math.min(count, 40),
    rowHeight: fallbackRowHeight
  }))
  const rafRef = useRef(0)
  const countRef = useRef(count)
  const rowHeightRef = useRef(fallbackRowHeight)

  /** Where the rows start in the scroller's content, from the spacer before them. */
  const measure = useCallback((): { scroller: HTMLElement; rowsTop: number; rowHeight: number } | null => {
    const scroller = scrollerRef.current
    const list = listRef.current
    const spacer = list?.firstElementChild as HTMLElement | null | undefined
    if (!scroller || !spacer) return null
    const row = list?.querySelector<HTMLElement>(`:scope > [${LIST_ROW_ATTR}]`)
    if (row && row.offsetHeight > 0) rowHeightRef.current = row.offsetHeight
    const rowsTop = spacer.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
    return { scroller, rowsTop, rowHeight: rowHeightRef.current }
  }, [listRef, scrollerRef])

  const sync = useCallback((): void => {
    const m = measure()
    if (!m) return
    const next = listWindow(m.scroller.scrollTop, m.scroller.clientHeight, m.rowsTop, countRef.current, m.rowHeight, overscan)
    setRange((prev) =>
      prev.startIndex === next.startIndex && prev.endIndex === next.endIndex && prev.rowHeight === m.rowHeight
        ? prev
        : { ...next, rowHeight: m.rowHeight }
    )
  }, [measure, overscan])

  // Recompute before paint when the row count changes, and once the first rows can be measured.
  useLayoutEffect(() => {
    countRef.current = count
    sync()
  }, [count, sync])

  // A list may mount after this hook (a pane that renders it once loaded): attach once it has rows.
  const hasRows = count > 0
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !hasRows) return
    const onScroll = (): void => {
      if (rafRef.current) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0
        sync()
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      ro.disconnect()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }, [scrollerRef, sync, hasRows])

  const scrollToRow = useCallback(
    (index: number): void => {
      const m = measure()
      if (!m) return
      const top = scrollTopToReveal(m.scroller.scrollTop, m.scroller.clientHeight, m.rowsTop + index * m.rowHeight, m.rowHeight)
      if (top !== null) m.scroller.scrollTop = top
      // The scroll event re-renders the window; sync now as well, so the row exists for a menu opened next.
      sync()
    },
    [measure, sync]
  )

  const startIndex = Math.min(range.startIndex, count)
  return { startIndex, endIndex: Math.min(Math.max(startIndex, range.endIndex), count), rowHeight: range.rowHeight, scrollToRow }
}

/** The space taken by the rows before or after the rendered window. */
export function ListSpacer({ rows, rowHeight }: { rows: number; rowHeight: number }): React.JSX.Element {
  return <li className="list-spacer" role="presentation" aria-hidden style={{ height: rows * rowHeight }} />
}
