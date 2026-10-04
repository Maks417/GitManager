export type StartupStatus = 'loading' | 'ready' | 'failed'

/** An unresolved or failed saved-list read must never look like an empty repository list. */
export function startupView(
  hasActiveRepo: boolean, repositoryCount: number, status: StartupStatus
): 'workspace' | 'startup' | 'welcome' {
  if (hasActiveRepo) return 'workspace'
  return status === 'ready' && repositoryCount === 0 ? 'welcome' : 'startup'
}
