import { useEffect } from 'react'
import { nextPaneIndex, PANE_ORDER } from '../logic/pane-cycle'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const isShown = (el: Element): boolean => el.getClientRects().length > 0

/** Where focus lands in a pane: its marked target, the row holding a list's Tab stop, or its first control. */
function focusTarget(pane: HTMLElement): HTMLElement | null {
  const candidates = [
    ...pane.querySelectorAll<HTMLElement>('[data-pane-focus]'),
    ...pane.querySelectorAll<HTMLElement>('[data-roving-row][tabindex="0"]'),
    ...pane.querySelectorAll<HTMLElement>(FOCUSABLE)
  ]
  return candidates.find(isShown) ?? null
}

/**
 * F6 and Shift+F6 move focus between the sidebar, the history list or changes, the inspector and the
 * search box (`data-pane`), skipping panes that are hidden or have nothing to focus. An open dialog keeps
 * focus to itself.
 */
export function usePaneCycling(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'F6' || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return
      if (document.querySelector('[aria-modal="true"]')) return
      const panes = PANE_ORDER.flatMap((name) => {
        const pane = document.querySelector<HTMLElement>(`[data-pane="${name}"]`)
        return pane && isShown(pane) ? [pane] : []
      })
      let index = panes.findIndex((pane) => pane.contains(document.activeElement))
      for (let tried = 0; tried < panes.length; tried++) {
        const next = nextPaneIndex(index, panes.length, e.shiftKey)
        if (next === null) return
        index = next
        const target = focusTarget(panes[next])
        if (target) {
          e.preventDefault()
          target.focus()
          return
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
