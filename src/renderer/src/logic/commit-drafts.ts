const PREFIX = 'git-manager:commit-draft:'
const memory = new Map<string, string>()

/** Writes synchronously so changing view cannot outrun a pending save. */
export function saveCommitDraft(repoPath: string, message: string): void {
  memory.set(repoPath, message)
  try {
    if (message) localStorage.setItem(PREFIX + repoPath, message)
    else localStorage.removeItem(PREFIX + repoPath)
  } catch {
    // Keep the draft for this session when disk storage is unavailable or full.
  }
}

export function loadCommitDraft(repoPath: string): string {
  if (memory.has(repoPath)) return memory.get(repoPath) ?? ''
  try {
    return localStorage.getItem(PREFIX + repoPath) ?? ''
  } catch {
    return ''
  }
}
