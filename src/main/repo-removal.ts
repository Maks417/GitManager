import { existsSync } from 'fs'
import { join, parse, resolve } from 'path'
import { isPathInside } from '../git-worker/path-utils'

export interface DeletionGuardContext {
  /** User home directory — never deletable, nor any folder that contains it. */
  home: string
  /** Other folders that must survive (app data, install location). */
  protectedPaths: string[]
}

/** Throws unless `target` is a Git repository root that is safe to move to the Trash. */
export function assertDeletableRepoDir(target: string, ctx: DeletionGuardContext): string {
  const dir = resolve(target)
  if (parse(dir).root === dir) throw new Error(`Refusing to delete a filesystem root: ${dir}`)
  for (const kept of [ctx.home, ...ctx.protectedPaths].filter(Boolean)) {
    if (isPathInside(dir, kept)) throw new Error(`Refusing to delete ${dir}: it contains ${resolve(kept)}`)
  }
  if (!existsSync(join(dir, '.git'))) {
    throw new Error(`Refusing to delete ${dir}: it is not a Git repository root`)
  }
  return dir
}
