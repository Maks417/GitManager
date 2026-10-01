/**
 * Validation for values that reach git argv or the filesystem from the renderer.
 * Every op re-checks its inputs so a compromised renderer cannot inject options
 * (`--exec=…`, `--output=…`) or escape the repository work tree.
 */
import { lstat, open, readlink, realpath } from 'fs/promises'
import { dirname, isAbsolute, resolve } from 'path'
import { SHA_RE } from '@shared/sha'
import { isPathInside } from '../path-utils'

const STASH_REF_RE = /^stash@\{\d+\}$/

/** Branch, tag, remote-tracking ref or commit-ish. Rejects option-like and control-character values. */
export function assertRevision(value: string, label = 'reference'): string {
  if (typeof value !== 'string' || !value || value.startsWith('-') || /[\0\r\n]/.test(value)) {
    throw new Error(`Invalid ${label}: ${JSON.stringify(value)}`)
  }
  return value
}

export function assertSha(value: string): string {
  if (typeof value !== 'string' || !SHA_RE.test(value)) {
    throw new Error(`Invalid commit id: ${JSON.stringify(value)}`)
  }
  return value
}

export function assertStashRef(value: string): string {
  if (typeof value !== 'string' || !STASH_REF_RE.test(value)) {
    throw new Error(`Invalid stash reference: ${JSON.stringify(value)}`)
  }
  return value
}

/** Resolve a repository-relative path; throws when it is absolute or escapes the work tree. */
export function resolveRepoPath(repoPath: string, relPath: string): string {
  if (typeof relPath !== 'string' || !relPath || isAbsolute(relPath) || relPath.includes('\0')) {
    throw new Error(`Invalid repository path: ${JSON.stringify(relPath)}`)
  }
  const full = resolve(repoPath, relPath)
  if (full === resolve(repoPath) || !isPathInside(repoPath, full)) {
    throw new Error(`Path is outside the repository: ${relPath}`)
  }
  return full
}

/** Reject paths whose existing parent directories resolve (through symlinks) outside the repo. */
async function assertRealParentInside(repoPath: string, full: string, relPath: string): Promise<void> {
  const rootReal = await realpath(repoPath)
  let ancestor = dirname(full)
  for (;;) {
    const real = await realpath(ancestor).catch(() => null)
    if (real !== null) {
      if (!isPathInside(rootReal, real)) throw new Error(`Path is outside the repository: ${relPath}`)
      return
    }
    const parent = dirname(ancestor)
    if (parent === ancestor) return
    ancestor = parent
  }
}

/** Resolve a path that is about to be written; never writes through a symlink. */
export async function resolveRepoPathForWrite(repoPath: string, relPath: string): Promise<string> {
  const full = resolveRepoPath(repoPath, relPath)
  await assertRealParentInside(repoPath, full, relPath)
  const st = await lstat(full).catch(() => null)
  if (st?.isSymbolicLink()) throw new Error(`Refusing to write through a symbolic link: ${relPath}`)
  return full
}

export interface RepoFileRead {
  exists: boolean
  buffer: Buffer
  truncated: boolean
  /** Full size in bytes, also when only part of the file was read. */
  size: number
}

/** Read up to `maxBytes` of a work-tree file. Symlinks yield their target path, as Git stores them. */
export async function readRepoFile(repoPath: string, relPath: string, maxBytes: number): Promise<RepoFileRead> {
  const full = resolveRepoPath(repoPath, relPath)
  await assertRealParentInside(repoPath, full, relPath)
  const missing: RepoFileRead = { exists: false, buffer: Buffer.alloc(0), truncated: false, size: 0 }
  const st = await lstat(full).catch(() => null)
  if (!st) return missing
  if (st.isSymbolicLink()) {
    const target = Buffer.from(await readlink(full), 'utf8')
    return { exists: true, buffer: target, truncated: false, size: target.length }
  }
  if (!st.isFile()) return missing
  const handle = await open(full, 'r')
  try {
    const size = Math.min(st.size, maxBytes)
    const buffer = Buffer.alloc(size)
    const { bytesRead } = await handle.read(buffer, 0, size, 0)
    return { exists: true, buffer: buffer.subarray(0, bytesRead), truncated: st.size > maxBytes, size: st.size }
  } finally {
    await handle.close()
  }
}
