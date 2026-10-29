import { normalize } from 'path'
import type { Repository } from '@shared/ipc'
import { loadRepositories, saveRepositories } from '../storage'

export function upsertRepository(repo: Repository): void {
  const stored = loadRepositories()
  // Refreshed after every action in the app: an entry already first and unchanged needs no write.
  if (stored[0] && JSON.stringify(stored[0]) === JSON.stringify(repo)) return
  const repos = stored.filter(
    (r) => normalize(r.path).toLowerCase() !== normalize(repo.path).toLowerCase()
  )
  repos.unshift(repo)
  saveRepositories(repos)
}
