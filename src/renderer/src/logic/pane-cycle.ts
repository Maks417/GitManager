/** Panes F6 visits, in order. Each is marked in the page with `data-pane`. */
export const PANE_ORDER = ['sidebar', 'main', 'inspector', 'search'] as const
export type PaneName = (typeof PANE_ORDER)[number]

/**
 * The pane F6 (or Shift+F6, `backwards`) moves to among `count` visible panes, going round. `current` is
 * the pane that holds focus, or -1 when focus is outside every pane.
 */
export function nextPaneIndex(current: number, count: number, backwards: boolean): number | null {
  if (count <= 0) return null
  if (current < 0 || current >= count) return backwards ? count - 1 : 0
  return (current + (backwards ? count - 1 : 1)) % count
}
