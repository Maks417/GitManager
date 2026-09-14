import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'
import { nextSizeForKey } from '../logic/resize-keys'

interface Props {
  /** `x` = vertical bar (resize width), `y` = horizontal bar (resize height). */
  axis: 'x' | 'y'
  /** Current size in px or percent (same unit as min/max/onChange). */
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  onChangeEnd?: (next: number) => void
  className?: string
  /** When true, dragging increases size as pointer moves left/up. */
  reverse?: boolean
  disabled?: boolean
  title?: string
}

/**
 * Drag handle for resizable panes. Parent should size layout from `value`. With keyboard focus the
 * arrow keys resize too (Shift for larger steps, Home and End for the limits); the size is saved when
 * the key is released.
 */
export function Splitter({
  axis,
  value,
  min,
  max,
  onChange,
  onChangeEnd,
  className = '',
  reverse = false,
  disabled = false,
  title = 'Drag to resize'
}: Props): React.JSX.Element {
  const dragging = useRef(false)
  const startPtr = useRef(0)
  const startVal = useRef(0)
  const latest = useRef(value)
  const keyResized = useRef(false)

  useEffect(() => {
    latest.current = value
  }, [value])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (disabled) return
      e.preventDefault()
      dragging.current = true
      startPtr.current = axis === 'x' ? e.clientX : e.clientY
      startVal.current = value
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.classList.add(axis === 'x' ? 'resizing-col' : 'resizing-row')
    },
    [axis, disabled, value]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging.current) return
      const ptr = axis === 'x' ? e.clientX : e.clientY
      const delta = ptr - startPtr.current
      const signed = reverse ? -delta : delta
      const next = Math.min(max, Math.max(min, startVal.current + signed))
      latest.current = next
      onChange(next)
    },
    [axis, max, min, onChange, reverse]
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('resizing-col', 'resizing-row')
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
      onChangeEnd?.(latest.current)
    },
    [onChangeEnd]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>): void => {
      if (disabled) return
      const next = nextSizeForKey(e.key, { size: value, min, max, axis, reverse, shift: e.shiftKey })
      if (next === null) return
      e.preventDefault()
      latest.current = next
      keyResized.current = true
      onChange(next)
    },
    [axis, disabled, max, min, onChange, reverse, value]
  )

  const onKeyUp = useCallback((): void => {
    if (!keyResized.current) return
    keyResized.current = false
    onChangeEnd?.(latest.current)
  }, [onChangeEnd])

  return (
    <div
      className={`splitter splitter-${axis} ${disabled ? 'disabled' : ''} ${className}`.trim()}
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={title}
      tabIndex={disabled ? undefined : 0}
      title={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
    />
  )
}
