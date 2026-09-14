import { useLayoutEffect, useRef } from 'react'
import type React from 'react'

/**
 * A ref holding the value from the latest committed render, for callbacks that must read fresh state
 * without being re-created whenever it changes. It is written after commit, never during render, so it
 * never exposes a render that React threw away.
 */
export function useLatestRef<T>(value: T): React.RefObject<T> {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
