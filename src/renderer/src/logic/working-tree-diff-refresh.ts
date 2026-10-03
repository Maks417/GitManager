/**
 * Delay before reloading the focused working-tree diff. A new file/side selection loads at once;
 * a status refresh for the same key waits so save bursts coalesce into one Git/diff request.
 */
export function workingTreeDiffDelayMs(
  previousKey: string | null,
  nextKey: string,
  debounceMs: number
): number {
  return previousKey === nextKey ? debounceMs : 0
}
