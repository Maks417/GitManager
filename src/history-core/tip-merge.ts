/**
 * Splice a freshly loaded first page on top of already loaded older commits.
 *
 * Returns `null` when splicing would show stale history: a loaded commit that belongs inside the
 * new page's range is missing from it (amend, rebase, reset, pruned branch), or the page no longer
 * reaches the loaded list. Callers then replace the list with the page.
 */
export function mergeTipPage<T extends { sha: string }>(
  loaded: T[],
  page: T[],
  pageIsPartial: boolean
): T[] | null {
  if (!pageIsPartial || loaded.length === 0) return page
  const last = page[page.length - 1]
  const boundary = last ? loaded.findIndex((c) => c.sha === last.sha) : -1
  if (boundary === -1) return null
  const pageShas = new Set(page.map((c) => c.sha))
  for (let i = 0; i < boundary; i++) {
    if (!pageShas.has(loaded[i].sha)) return null
  }
  return [...page, ...loaded.slice(boundary + 1).filter((c) => !pageShas.has(c.sha))]
}
