import { basename, normalize } from 'path'
import { RepositorySchema, type Repository } from '@shared/ipc'

/**
 * The saved repository list. An entry that no longer fits the schema (written by an older version, or edited
 * by hand) is repaired from its path rather than dropped: the list is saved again after every action, so a
 * dropped entry would be gone for good. The next inspection fills in its branch and remotes. Only entries
 * without a usable path are left out.
 */
export function parseStoredRepositories(raw: unknown): Repository[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): Repository[] => {
    const parsed = RepositorySchema.safeParse(item)
    if (parsed.success) return [parsed.data]
    const record = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
    const path = typeof record?.path === 'string' && record.path.trim() ? normalize(record.path) : null
    if (!path) return []
    return [
      {
        id: typeof record?.id === 'string' && record.id ? record.id : path,
        name: typeof record?.name === 'string' && record.name ? record.name : basename(path),
        path,
        currentBranch: typeof record?.currentBranch === 'string' ? record.currentBranch : null,
        remotes: [],
        worktreeOf: typeof record?.worktreeOf === 'string' ? record.worktreeOf : null
      }
    ]
  })
}
