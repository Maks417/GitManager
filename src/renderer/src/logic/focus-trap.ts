/**
 * Where Tab should send focus inside a dialog: past the last focusable element to the first, and past
 * the first to the last with Shift+Tab. Returns
 * - an index into the dialog's focusable elements,
 * - -1 to focus the dialog itself (nothing inside can take focus),
 * - null to let the browser move focus, which then stays inside the dialog.
 */
export function nextFocusIndex(count: number, activeIndex: number, backwards: boolean): number | null {
  if (count === 0) return -1
  if (activeIndex < 0) return backwards ? count - 1 : 0
  if (backwards && activeIndex === 0) return count - 1
  if (!backwards && activeIndex === count - 1) return 0
  return null
}
