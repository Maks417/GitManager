import { useCallback, useEffect, useRef } from 'react'
import type React from 'react'
import { nextSizeForKey } from '../logic/resize-keys'

interface Props {
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  onChangeEnd?: (next: number) => void
  /** When true, dragging right decreases `value` (for a left-edge grip). */
  reverse?: boolean
  title?: string
}

/** Edge drag handle for a fixed-width table column. With keyboard focus, ←/→ resize it as well. */
export function ColumnResizeHandle({
  value,
  min,
  max,
  onChange,
  onChangeEnd,
  reverse = false,
  title = 'Drag to resize column'
}: Props): React.JSX.Element {
  const dragging = useRef(false)
  const startX = useRef(0)
  const startVal = useRef(0)
  const latest = useRef(value)
  const keyResized = useRef(false)

  useEffect(() => {
    latest.current = value
  }, [value])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      e.preventDefault()
      e.stopPropagation()
      dragging.current = true
      startX.current = e.clientX
      startVal.current = value
      e.currentTarget.setPointerCapture(e.pointerId)
      document.body.classList.add('resizing-col')
    },
    [value]
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging.current) return
      const delta = e.clientX - startX.current
      const signed = reverse ? -delta : delta
      const next = Math.min(max, Math.max(min, startVal.current + signed))
      latest.current = next
      onChange(next)
    },
    [max, min, onChange, reverse]
  )

  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (!dragging.current) return
      dragging.current = false
      document.body.classList.remove('resizing-col')
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
      const next = nextSizeForKey(e.key, { size: value, min, max, axis: 'x', reverse, shift: e.shiftKey })
      if (next === null) return
      // The handle sits inside the commit list, which would take the arrow keys as well.
      e.preventDefault()
      e.stopPropagation()
      latest.current = next
      keyResized.current = true
      onChange(next)
    },
    [max, min, onChange, reverse, value]
  )

  const onKeyUp = useCallback((): void => {
    if (!keyResized.current) return
    keyResized.current = false
    onChangeEnd?.(latest.current)
  }, [onChangeEnd])

  return (
    <div
      className={`history-col-resize${reverse ? ' history-col-resize-left' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={title}
      tabIndex={0}
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
