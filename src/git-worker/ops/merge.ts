import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { ConflictFile, LineRange, MergeSides, SideChange } from '@shared/ipc'
import { readGitShowCapped } from '../git-runner'
import { readRepoFile, resolveRepoPath, resolveRepoPathForWrite } from './guards'
import { gitOk } from './shared'

/** Monaco can't usefully edit more than this; larger conflicts are resolved by taking a side. */
const MAX_MERGE_BYTES = 8 * 1024 * 1024
/** The renderer's syntax-color limit (HIGHLIGHT_MAX_CHARS); larger sides are shown without changed-line marks. */
const MAX_CHANGE_MARK_CHARS = 1_000_000

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
): Promise<{ exists: boolean; text: string; binary: boolean; tooLarge: boolean }> {
  const shown = await readGitShowCapped(repoPath, `:${stage}:${path}`, MAX_MERGE_BYTES)
  if (!shown.ok) return { exists: false, text: '', binary: false, tooLarge: false }
  const tooLarge = shown.truncated || shown.buffer.length >= MAX_MERGE_BYTES
  return { exists: true, text: shown.binary ? '' : shown.buffer.toString('utf8'), binary: shown.binary, tooLarge }
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** A hunk header's `start,count` as a range; with no lines, the header names the line before the gap. */
function headerRange(start: string, count: string | undefined): LineRange {
  const first = Number(start)
  const lines = count === undefined ? 1 : Number(count)
  return lines === 0 ? { start: first + 1, end: first + 1 } : { start: first, end: first + lines }
}

/**
 * The blocks of stage `side` that differ from the base stage, from a zero-context diff of the two blobs. Removed lines
 * become an empty range in the side, added lines an empty range in the base.
 */
async function changesFromBase(repoPath: string, side: 2 | 3, path: string): Promise<SideChange[]> {
  const out = await gitOk(repoPath, [
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '-U0',
    `:1:${path}`,
    `:${side}:${path}`
  ])
  const changes: SideChange[] = []
  for (const line of out.split('\n')) {
    const m = HUNK_HEADER_RE.exec(line)
    if (m) changes.push({ base: headerRange(m[1], m[2]), side: headerRange(m[3], m[4]) })
  }
  return changes
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
  // Marking changed lines is a guide, like syntax colors, and is left out for the same large files.
  const marksChanges =
    editable && base.exists && Math.max(base.text.length, ours.text.length, theirs.text.length) <= MAX_CHANGE_MARK_CHARS
  const [oursChanges, theirsChanges] = await Promise.all([
    marksChanges && ours.exists ? changesFromBase(repoPath, 2, path) : [],
    marksChanges && theirs.exists ? changesFromBase(repoPath, 3, path) : []
  ])
  return {
    path,
    base: editable ? base.text : '',
    ours: editable ? ours.text : '',
    theirs: editable ? theirs.text : '',
    result: editable && working.exists ? working.buffer.toString('utf8') : '',
    oursChanges,
    theirsChanges,
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
