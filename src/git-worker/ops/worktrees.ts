import { existsSync, readdirSync, readFileSync, realpathSync } from 'fs'
import { readdir, rm, rmdir, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'path'
import type { AddWorktreeRequest, WorktreeInfo, WorktreeItem } from '@shared/ipc'
import { WORKTREE_HAS_CHANGES } from '@shared/git-messages'
import { assertRevision } from './guards'
import { getGitDirs, gitOk, runGit } from './shared'

export interface WorktreeEntry {
  path: string
  /** Commit checked out (all zeros on an unborn branch); null for a bare repository. */
  head: string | null
  /** Branch checked out, without `refs/heads/`; null when detached or bare. */
  branch: string | null
  /** HEAD points at a commit instead of a branch. */
  detached: boolean
  bare: boolean
  locked: boolean
  /** Why it was locked, when a reason was given. */
  lockReason: string | null
  /** Git found the worktree's folder missing. */
  prunable: boolean
}

/** Reads `git worktree list --porcelain`: the main work tree first, then every linked worktree. */
export function parseWorktreeList(output: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = []
  let current: WorktreeEntry | null = null
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      current = {
        path: line.slice('worktree '.length),
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false
      }
      entries.push(current)
    } else if (!current) {
      continue
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length).trim() || null
    } else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '') || null
    } else if (line === 'detached') {
      current.detached = true
    } else if (line === 'bare') {
      current.bare = true
    } else if (line === 'locked' || line.startsWith('locked ')) {
      current.locked = true
      current.lockReason = line.slice('locked'.length).trim() || null
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      current.prunable = true
    }
  }
  return entries
}

/** A path as the file system names it (symlinks, 8.3 names), even once the folder itself is gone. */
function canonicalPath(path: string): string {
  const absolute = resolve(path)
  let real: string
  try {
    real = realpathSync.native(absolute)
  } catch {
    try {
      real = join(realpathSync.native(dirname(absolute)), basename(absolute))
    } catch {
      real = absolute
    }
  }
  const normalized = normalize(real)
  return process.platform === 'win32' || process.platform === 'darwin' ? normalized.toLowerCase() : normalized
}

export function samePath(a: string, b: string): boolean {
  return canonicalPath(a) === canonicalPath(b)
}

async function listWorktrees(repoPath: string): Promise<WorktreeEntry[]> {
  const result = await runGit({ cwd: repoPath, args: ['worktree', 'list', '--porcelain'] })
  return result.code === 0 ? parseWorktreeList(result.stdout) : []
}

/** Every work tree of the repository at `repoPath`, the main one first. */
export async function listWorktreeItems(repoPath: string): Promise<WorktreeItem[]> {
  const entries = await listWorktrees(repoPath)
  return entries.map((entry, index) => ({
    path: normalize(entry.path),
    branch: entry.branch,
    head: entry.head,
    detached: entry.detached,
    bare: entry.bare,
    locked: entry.locked,
    lockReason: entry.lockReason,
    prunable: entry.prunable,
    isMain: index === 0,
    isCurrent: samePath(entry.path, repoPath)
  }))
}

/** A folder Git can create a worktree in: absolute, and missing or empty. */
async function assertNewWorktreeFolder(path: string): Promise<string> {
  if (!path || !isAbsolute(path) || path.includes('\0')) throw new Error(`Invalid worktree folder: ${JSON.stringify(path)}`)
  const info = await stat(path).catch(() => null)
  if (info && (!info.isDirectory() || (await readdir(path)).length > 0)) {
    throw new Error(`${path} already exists and is not empty. Pick another folder for the worktree.`)
  }
  return normalize(path)
}

/** Adds a linked worktree and returns its folder. */
export async function addWorktree(repoPath: string, request: Omit<AddWorktreeRequest, 'repoPath'>): Promise<string> {
  const path = await assertNewWorktreeFolder(request.path)
  const startPoint = request.startPoint ? [assertRevision(request.startPoint, 'start point')] : []
  let args: string[]
  if (request.newBranch) {
    const track = request.track ? ['--track'] : []
    args = ['worktree', 'add', ...track, '-b', assertRevision(request.newBranch, 'branch name'), path, ...startPoint]
  } else if (request.branch) {
    args = ['worktree', 'add', path, assertRevision(request.branch, 'branch')]
  } else {
    args = ['worktree', 'add', '--detach', path, ...(startPoint.length ? startPoint : ['HEAD'])]
  }
  await gitOk(repoPath, args)
  return path
}

/** A linked worktree of the repository at `repoPath`: never its main work tree, nor `repoPath` itself. */
async function linkedEntry(repoPath: string, path: string): Promise<WorktreeEntry> {
  const entries = await listWorktrees(repoPath)
  const index = entries.findIndex((e) => samePath(e.path, path))
  if (index < 0) throw new Error(`${path} is not a worktree of this repository.`)
  if (index === 0) throw new Error('The main work tree cannot be removed or locked from here.')
  if (samePath(path, repoPath)) throw new Error('Switch to another worktree before removing this one.')
  return entries[index]
}

/**
 * Removes a linked worktree's folder and Git's record of it. Without `force`, Git refuses a worktree with
 * changes or untracked files: the error then starts with WORKTREE_HAS_CHANGES.
 */
export async function removeWorktree(repoPath: string, path: string, force = false): Promise<void> {
  const entry = await linkedEntry(repoPath, path)
  if (entry.locked) {
    throw new Error(`The worktree is locked${entry.lockReason ? ` (${entry.lockReason})` : ''}. Unlock it first.`)
  }
  const result = await runGit({ cwd: repoPath, args: ['worktree', 'remove', ...(force ? ['--force'] : []), entry.path] })
  if (result.code === 0) return
  const message = result.stderr.trim()
  if (!force && /modified or untracked files/.test(message)) {
    throw new Error(`${WORKTREE_HAS_CHANGES}: removing it deletes its uncommitted and untracked files.`)
  }
  throw new Error(message || `git worktree remove exited with code ${result.code}`)
}

export async function lockWorktree(repoPath: string, path: string, reason?: string): Promise<void> {
  const entry = await linkedEntry(repoPath, path)
  const why = reason?.trim() ? ['--reason', reason.trim()] : []
  await gitOk(repoPath, ['worktree', 'lock', ...why, entry.path])
}

export async function unlockWorktree(repoPath: string, path: string): Promise<void> {
  const entry = await linkedEntry(repoPath, path)
  await gitOk(repoPath, ['worktree', 'unlock', entry.path])
}

/** `git worktree prune`: drops the records of every worktree whose folder is gone. Returns how many went. */
export async function pruneMissingWorktrees(repoPath: string): Promise<number> {
  const before = (await listWorktrees(repoPath)).length
  await gitOk(repoPath, ['worktree', 'prune'])
  return before - (await listWorktrees(repoPath)).length
}

/** For a linked worktree, the main work tree of its repository; null for anything else. */
export async function linkedWorktreeMain(repoPath: string): Promise<string | null> {
  const { gitDir, commonDir } = await getGitDirs(repoPath)
  // A linked worktree's git directory is <common dir>/worktrees/<name>; a submodule's is a repository of its own.
  const linked =
    !samePath(gitDir, commonDir) &&
    basename(dirname(gitDir)) === 'worktrees' &&
    samePath(dirname(dirname(gitDir)), commonDir)
  if (!linked) return null
  const [main] = await listWorktrees(repoPath)
  return main ? normalize(main.path) : null
}

/**
 * Whether `repoPath` still exists and how it relates to other worktrees. A worktree whose folder is gone can
 * only be described through `knownMainPath`, the main work tree remembered when it was added.
 */
export async function getWorktreeInfo(repoPath: string, knownMainPath: string | null): Promise<WorktreeInfo> {
  if (!existsSync(repoPath)) {
    if (!knownMainPath) return { exists: false, linkedTo: null, otherWorktrees: 0 }
    const mainExists = existsSync(knownMainPath)
    const entry = mainExists ? (await listWorktrees(knownMainPath)).find((e) => samePath(e.path, repoPath)) : undefined
    return {
      exists: false,
      linkedTo: { mainPath: knownMainPath, mainExists, locked: Boolean(entry?.locked) },
      otherWorktrees: 0
    }
  }
  const [entries, mainPath] = await Promise.all([
    listWorktrees(repoPath),
    linkedWorktreeMain(repoPath).catch(() => null)
  ])
  if (mainPath) {
    const self = entries.find((e) => samePath(e.path, repoPath))
    return {
      exists: true,
      linkedTo: { mainPath, mainExists: existsSync(mainPath), locked: Boolean(self?.locked) },
      otherWorktrees: 0
    }
  }
  // The main work tree: its linked worktrees, while their folders exist, need its .git folder.
  return { exists: true, linkedTo: null, otherWorktrees: entries.slice(1).filter((e) => !e.prunable).length }
}

/**
 * The administrative folder `<common dir>/worktrees/<id>` of the linked worktree at `worktreePath`. Its `gitdir`
 * file holds the path of the worktree's `.git` file, absolute or relative to that folder (gitrepository-layout(5)).
 */
function findAdminDir(commonDir: string, worktreePath: string): string | null {
  const root = join(commonDir, 'worktrees')
  let ids: string[]
  try {
    ids = readdirSync(root)
  } catch {
    return null
  }
  for (const id of ids) {
    const adminDir = join(root, id)
    let dotGit: string
    try {
      dotGit = readFileSync(join(adminDir, 'gitdir'), 'utf8').trim()
    } catch {
      continue
    }
    if (dotGit && samePath(dirname(resolve(adminDir, dotGit)), worktreePath)) return adminDir
  }
  return null
}

const quoted = (path: string): string => `"${path}"`

function lockedMessage(mainPath: string, worktreePath: string): string {
  return (
    `The worktree is locked, so ${mainPath} still lists it. To remove it, run git worktree unlock ` +
    `${quoted(worktreePath)} and then git worktree remove ${quoted(worktreePath)} there.`
  )
}

/**
 * Removes the record that the repository at `mainPath` keeps of the linked worktree at `worktreePath`, once that
 * folder is gone. Only that worktree's administrative folder goes, as `git worktree prune` would remove it; unlike
 * that command, the records of other missing worktrees stay, since their folders may only be unavailable for now
 * (an unmounted drive). The record also stays while the worktree is locked, or while its detached HEAD holds
 * commits that no branch, tag or remote contains. Returns why the record stays, or null when there is none left.
 */
export async function pruneWorktree(mainPath: string, worktreePath: string): Promise<string | null> {
  if (!existsSync(mainPath)) return null
  const listed = async (): Promise<WorktreeEntry | undefined> =>
    (await listWorktrees(mainPath)).find((e) => samePath(e.path, worktreePath))
  const entry = await listed()
  if (!entry) return null
  if (existsSync(worktreePath)) {
    return 'The worktree folder still exists, so its repository keeps listing it.'
  }
  if (entry.locked) return lockedMessage(mainPath, worktreePath)
  const removeCommand = `git worktree remove ${quoted(worktreePath)}`

  // Commits only a detached HEAD reaches stay reachable through the record alone.
  if (entry.detached && entry.head) {
    const onlyHere = await runGit({
      cwd: mainPath,
      args: ['rev-list', '--count', entry.head, '--not', '--branches', '--tags', '--remotes']
    })
    const count = Number(onlyHere.stdout.trim())
    if (onlyHere.code !== 0 || !Number.isFinite(count)) {
      return `Could not check the worktree's commits, so ${mainPath} still lists it. Run ${removeCommand} there to remove it.`
    }
    if (count > 0) {
      return (
        `${mainPath} still lists the worktree: its detached HEAD has ${count} commit${count === 1 ? '' : 's'} on ` +
        `no branch, which would be lost with the record. To keep them, run git branch <name> ${entry.head} there; ` +
        `then ${removeCommand} removes the record.`
      )
    }
  }

  const { commonDir } = await getGitDirs(mainPath)
  const adminDir = findAdminDir(commonDir, worktreePath)
  // Checked again right before removing: the worktree may have been locked meanwhile.
  if (adminDir && !existsSync(join(adminDir, 'locked'))) {
    await rm(adminDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    // Git removes the worktrees folder too once it is empty.
    await rmdir(dirname(adminDir)).catch(() => undefined)
  }
  const left = await listed()
  if (!left) return null
  return left.locked
    ? lockedMessage(mainPath, worktreePath)
    : `${mainPath} still lists the worktree. Run ${removeCommand} there to remove it.`
}
