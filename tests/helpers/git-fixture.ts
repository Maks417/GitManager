import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach } from 'vitest'
import { runGit } from '../../src/git-worker/git-runner'

/** Returns a factory for temp directories that are removed after each test. */
export function trackTempDirs(): (prefix: string) => string {
  const dirs: string[] = []
  afterEach(() => {
    while (dirs.length) {
      const d = dirs.pop()
      if (d) rmSync(d, { recursive: true, force: true })
    }
  })
  return (prefix) => {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    dirs.push(dir)
    return dir
  }
}

/** Run git and fail loudly — unlike `runGit`, which resolves on a non-zero exit. */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await runGit({ cwd, args })
  if (result.code !== 0) throw new Error(`git ${args.join(' ')} failed (${result.code}): ${result.stderr}`)
  return result.stdout
}

export async function initRepo(dir: string, opts: { initialCommit?: boolean } = {}): Promise<string> {
  await git(dir, 'init', '-b', 'main')
  await git(dir, 'config', 'user.email', 'test@example.com')
  await git(dir, 'config', 'user.name', 'Test User')
  if (opts.initialCommit !== false) {
    writeFileSync(join(dir, 'README.md'), '# repo\n')
    await git(dir, 'add', 'README.md')
    await git(dir, 'commit', '-m', 'Initial commit')
  }
  return dir
}

/**
 * Commit `base`, then change files on a `theirs` branch and on `main`, and merge `theirs`
 * into `main`. Pass `null` to delete a file on that side. Returns once the merge has stopped.
 */
export async function mergeWithConflicts(
  dir: string,
  files: {
    base: Record<string, string | Buffer>
    theirs: Record<string, string | Buffer | null>
    ours: Record<string, string | Buffer | null>
  }
): Promise<void> {
  const write = async (changes: Record<string, string | Buffer | null>): Promise<void> => {
    for (const [name, content] of Object.entries(changes)) {
      if (content === null) await git(dir, 'rm', '-q', '--', name)
      else writeFileSync(join(dir, name), content)
    }
    await git(dir, 'add', '-A')
  }
  await write(files.base)
  await git(dir, 'commit', '-m', 'base')
  await git(dir, 'checkout', '-b', 'theirs')
  await write(files.theirs)
  await git(dir, 'commit', '-m', 'theirs')
  await git(dir, 'checkout', 'main')
  await write(files.ours)
  await git(dir, 'commit', '-m', 'ours')
  const merge = await runGit({ cwd: dir, args: ['merge', 'theirs'] })
  if (merge.code === 0) throw new Error('expected the merge to stop with conflicts')
}
