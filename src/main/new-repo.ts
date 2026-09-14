import { existsSync, readdirSync, statSync } from 'fs'
import { isAbsolute, join } from 'path'
import { repoFolderNameProblem } from '@shared/repo-name'

/**
 * Where a new repository named `name` goes in `parentDir`, and why it cannot go there when it cannot:
 * the location must exist, and the repository folder must be missing or empty.
 */
export function describeNewRepoTarget(parentDir: string, name: string): { path: string | null; problem: string | null } {
  const nameProblem = repoFolderNameProblem(name)
  if (nameProblem) return { path: null, problem: nameProblem }
  if (!parentDir) return { path: null, problem: 'Choose the location to create the repository in.' }
  if (!isAbsolute(parentDir)) {
    return { path: null, problem: 'Enter the full path of the location, or choose it with Browse….' }
  }
  const path = join(parentDir, name)
  try {
    if (!existsSync(parentDir) || !statSync(parentDir).isDirectory()) {
      return { path, problem: 'The location does not exist.' }
    }
    if (existsSync(path)) {
      if (!statSync(path).isDirectory()) return { path, problem: 'A file with this name already exists there.' }
      if (readdirSync(path).length > 0) {
        return { path, problem: 'A folder with this name already exists there and is not empty.' }
      }
    }
  } catch (err) {
    return { path, problem: `The location cannot be read: ${err instanceof Error ? err.message : String(err)}` }
  }
  return { path, problem: null }
}
