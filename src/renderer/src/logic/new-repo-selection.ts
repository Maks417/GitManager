/**
 * The selection when another repository opens: nothing in History, where the first page then selects a
 * commit, but still the working copy in Changes. A commit selected under the Changes view would leave its
 * diff showing there, and the file list would never load another.
 */
export function selectionForNewRepository(viewMode: 'history' | 'changes'): { kind: 'working-copy' } | null {
  return viewMode === 'changes' ? { kind: 'working-copy' } : null
}
