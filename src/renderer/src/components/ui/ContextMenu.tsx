import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'
import { nextListIndex } from '../../logic/list-nav'

export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Destructive: shown in the danger color. */
  danger?: boolean
  /** Starts a new group: a line above it. */
  separatorBefore?: boolean
}

interface ContextMenuProps {
  /** Viewport point the menu opens at (the pointer, or a corner of the element it belongs to). */
  x: number
  y: number
  items: MenuItem[]
  ariaLabel: string
  onClose: () => void
}

const MENU_ITEMS = '[role="menuitem"]:not(:disabled)'
const EDGE = 8

/**
 * A menu at a point, above everything else. The first item takes focus; arrow keys, Home and End move,
 * Enter picks, and Escape, Tab, a click elsewhere or a scroll close it. Focus goes back where it was.
 */
export function ContextMenu({ x, y, items, ariaLabel, onClose }: ContextMenuProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  const [returnFocusTo] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  )

  // Keep the whole menu on screen: flip it to the left of or above the point when it does not fit.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const left = x + width + EDGE > window.innerWidth ? Math.max(EDGE, x - width) : x
    const top = y + height + EDGE > window.innerHeight ? Math.max(EDGE, y - height) : y
    setPosition({ left, top })
    el.querySelector<HTMLElement>(MENU_ITEMS)?.focus()
  }, [x, y])

  useEffect(() => {
    const onPointer = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onScroll = (e: Event): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onPointer, true)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      document.removeEventListener('mousedown', onPointer, true)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  const close = (): void => {
    onClose()
    returnFocusTo?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      close()
      return
    }
    const options = [...e.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEMS)]
    const next = nextListIndex(e.key, options.indexOf(document.activeElement as HTMLElement), options.length, {
      wrap: true
    })
    if (next === null) return
    e.preventDefault()
    options[next].focus()
  }

  return createPortal(
    <div
      ref={ref}
      className="dropdown-menu context-menu"
      role="menu"
      aria-label={ariaLabel}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, index) => (
        <div key={`${index}:${item.label}`} role="presentation" className="context-menu-entry">
          {item.separatorBefore && index > 0 && <div className="dropdown-sep" role="separator" />}
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            className={item.danger ? 'context-menu-danger' : undefined}
            onClick={() => {
              close()
              item.onSelect()
            }}
          >
            {item.label}
          </button>
        </div>
      ))}
    </div>,
    document.body
  )
}

/** Where a menu opened from the keyboard (Shift+F10, the Menu key) appears: below the element's start. */
export function menuPointFor(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: r.left + Math.min(24, r.width / 2), y: r.bottom }
}

/** Shift+F10 or the context-menu key. */
export function isMenuKey(e: React.KeyboardEvent): boolean {
  return e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)
}
