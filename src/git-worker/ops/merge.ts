import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { ConflictFile, MergeSides } from '@shared/ipc'
import { readGitShowCapped } from '../git-runner'
import { readRepoFile, resolveRepoPath, resolveRepoPathForWrite } from './guards'
import { gitOk } from './shared'

/** Monaco can't usefully edit more than this; larger conflicts are resolved by taking a side. */
const MAX_MERGE_BYTES = 8 * 1024 * 1024

export async function listConflictFiles(repoPath: string): Promise<ConflictFile[]> {
  const out = await gitOk(repoPath, ['ls-files', '-u', '-z'])
  const byPath = new Map<string, ConflictFile>()
  for (const record of out.split('\0')) {
    // <mode> SP <object> SP <stage> TAB <path>
    const m = /^\d+ [0-9a-f]+ ([123])\t([\s\S]+)$/.exec(record)
    if (!m) continue
    const stage = Number(m[1])
    const path = m[2]
    const entry = byPath.get(path) || { path, hasBase: false, hasOurs: false, hasTheirs: false }
    if (stage === 1) entry.hasBase = true
    if (stage === 2) entry.hasOurs = true
    if (stage === 3) entry.hasTheirs = true
    byPath.set(path, entry)
  }
  return [...byPath.values()]
}

async function readStage(
  repoPath: string,
  stage: 1 | 2 | 3,
  path: string
): Promise<{ text: string; binary: boolean; tooLarge: boolean }> {
  const shown = await readGitShowCapped(repoPath, `:${stage}:${path}`, MAX_MERGE_BYTES)
  if (!shown.ok) return { text: '', binary: false, tooLarge: false }
  const tooLarge = shown.truncated || shown.buffer.length >= MAX_MERGE_BYTES
  return { text: shown.binary ? '' : shown.buffer.toString('utf8'), binary: shown.binary, tooLarge }
}

export async function getMergeSides(repoPath: string, path: string): Promise<MergeSides> {
  resolveRepoPath(repoPath, path)
  const [base, ours, theirs, working] = await Promise.all([
    readStage(repoPath, 1, path),
    readStage(repoPath, 2, path),
    readStage(repoPath, 3, path),
    // Git leaves the auto-merged file in the work tree, with markers only around real conflicts.
    // Index stage 0 does not exist for conflicted paths, so it must be read from disk.
    readRepoFile(repoPath, path, MAX_MERGE_BYTES)
  ])
  const binary = base.binary || ours.binary || theirs.binary || working.buffer.includes(0)
  const tooLarge = base.tooLarge || ours.tooLarge || theirs.tooLarge || working.truncated
  const editable = !binary && !tooLarge
  return {
    path,
    base: editable ? base.text : '',
    ours: editable ? ours.text : '',
    theirs: editable ? theirs.text : '',
    result: editable && working.exists ? working.buffer.toString('utf8') : '',
    binary,
    tooLarge
  }
}

export async function saveMergeResult(repoPath: string, path: string, content: string): Promise<void> {
  const full = await resolveRepoPathForWrite(repoPath, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf8')
  await gitOk(repoPath, ['--literal-pathspecs', 'add', '--', path])
}

/**
 * Resolve a conflicted path by taking one side as a whole file. When that side deleted
 * the file (modify/delete conflict) the resolution is the deletion.
 */
export async function resolveConflictSide(
  repoPath: string,
  path: string,
  side: 'ours' | 'theirs'
): Promise<void> {
  resolveRepoPath(repoPath, path)
  if (side !== 'ours' && side !== 'theirs') throw new Error(`Invalid conflict side: ${String(side)}`)
  const conflict = (await listConflictFiles(repoPath)).find((c) => c.path === path)
  if (!conflict) throw new Error(`No unresolved conflict for ${path}`)
  const sidePresent = side === 'ours' ? conflict.hasOurs : conflict.hasTheirs
  if (!sidePresent) {
    await gitOk(repoPath, ['--literal-pathspecs', 'rm', '--quiet', '--', path])
    return
  }
  await gitOk(repoPath, ['--literal-pathspecs', 'checkout', `--${side}`, '--', path])
  await gitOk(repoPath, ['--literal-pathspecs', 'add', '--', path])
}
