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

/**
 * Whether a status refresh may have changed this file's diff: the watcher names the work-tree files it saw
 * change; staging, Git actions and anything it could not name (`paths: null`) may have changed any diff.
 */
export function statusChangeTouches(paths: readonly string[] | null, path: string | null): boolean {
  if (!path) return false
  if (!paths) return true
  const wanted = path.toLowerCase()
  // An untracked folder shown as one entry (`build/`) covers the files inside it.
  if (wanted.endsWith('/')) return paths.some((changed) => changed.toLowerCase().startsWith(wanted))
  return paths.some((changed) => changed.toLowerCase() === wanted)
}
