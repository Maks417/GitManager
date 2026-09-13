import { normalize } from 'path'
import type { Repository } from '@shared/ipc'
import { loadRepositories, saveRepositories } from '../storage'

export function upsertRepository(repo: Repository): void {
  const repos = loadRepositories().filter(
    (r) => normalize(r.path).toLowerCase() !== normalize(repo.path).toLowerCase()
  )
  repos.unshift(repo)
  saveRepositories(repos)
}
