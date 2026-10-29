/** Branch folders opened or closed by hand, per repository: `local:feature` or `remote:origin/feature` → open. */
export type BranchFolderState = Readonly<Record<string, boolean>>

const PREFIX = 'git-manager:branch-folders:'
const memory = new Map<string, BranchFolderState>()

export function loadBranchFolders(repoPath: string): BranchFolderState {
  const known = memory.get(repoPath)
  if (known) return known
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFIX + repoPath) ?? '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
  } catch {
    return {}
  }
}

export function saveBranchFolders(repoPath: string, state: BranchFolderState): void {
  memory.set(repoPath, state)
  try {
    localStorage.setItem(PREFIX + repoPath, JSON.stringify(state))
  } catch {
    // Kept for this session when disk storage is unavailable or full.
  }
}
