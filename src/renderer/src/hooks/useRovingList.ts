import { useState } from 'react'
import type React from 'react'
import { nextListIndex } from '../logic/list-nav'

export interface RovingRowProps {
  tabIndex: number
  'data-roving-row': ''
  onFocus: (e: React.FocusEvent<HTMLElement>) => void
}

/**
 * A list whose rows share one Tab stop: ↑/↓, Home and End move focus between the rows and Enter
 * activates the focused one. The row focused last keeps the Tab stop; before that, `preferredIndex`.
 */
export function useRovingList(
  count: number,
  preferredIndex: number,
  activate: (index: number) => void
): { rowProps: (index: number) => RovingRowProps; onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void } {
  const [focused, setFocused] = useState<number | null>(null)
  const tabStop =
    focused !== null && focused < count ? focused : Math.min(Math.max(preferredIndex, 0), Math.max(count - 1, 0))

  return {
    rowProps: (index) => ({
      tabIndex: index === tabStop ? 0 : -1,
      'data-roving-row': '',
      onFocus: (e) => {
        if (e.target === e.currentTarget) setFocused(index)
      }
    }),
    onKeyDown: (e) => {
      const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-roving-row]')]
      const index = rows.indexOf(e.target as HTMLElement)
      // Keys pressed on a button inside a row are the button's.
      if (index < 0) return
      if (e.key === 'Enter') {
        e.preventDefault()
        activate(index)
        return
      }
      const next = nextListIndex(e.key, index, rows.length)
      if (next === null) return
      e.preventDefault()
      rows[next].focus()
    }
  }
}
