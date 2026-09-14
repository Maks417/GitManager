export interface ResizeKeyState {
  size: number
  min: number
  max: number
  /** `x` resizes a width with ←/→, `y` a height with ↑/↓. */
  axis: 'x' | 'y'
  /** The pane grows as the handle moves left or up (a handle on the pane's leading edge). */
  reverse?: boolean
  /** Shift moves further. */
  shift?: boolean
}

export const RESIZE_STEP = 10
export const RESIZE_STEP_LARGE = 50

/**
 * The size a key gives a resize handle: arrows move it 10 px (50 px with Shift) in the direction of the
 * arrow, Home and End go to the smallest and largest size. Null for other keys.
 */
export function nextSizeForKey(key: string, state: ResizeKeyState): number | null {
  const forward = state.axis === 'x' ? 'ArrowRight' : 'ArrowDown'
  const backward = state.axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
  let next: number
  if (key === forward || key === backward) {
    const step = state.shift ? RESIZE_STEP_LARGE : RESIZE_STEP
    const direction = (key === forward ? 1 : -1) * (state.reverse ? -1 : 1)
    next = state.size + direction * step
  } else if (key === 'Home') {
    next = state.min
  } else if (key === 'End') {
    next = state.max
  } else {
    return null
  }
  return Math.min(state.max, Math.max(state.min, next))
}
