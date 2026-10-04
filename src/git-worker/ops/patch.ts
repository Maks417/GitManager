/**
 * Partial staging: stage, unstage or discard single hunks or lines of one file.
 *
 * The renderer only names hunks or line numbers and the fingerprint of the diff it shows. The patch itself is
 * always rebuilt here from a fresh `git diff`, and refused when that diff is no longer the one on screen.
 */
import { createHash } from 'crypto'
import type { ApplyPartialRequest, DiffHunk, HunkSet } from '@shared/ipc'
import { runGit } from '../git-runner'
import { resolveRepoPath } from './guards'
import { saveWorktreeRecovery } from './recovery'

export type PatchLineKind = 'context' | 'add' | 'del'

export interface PatchLine {
  kind: PatchLineKind
  /** The line without its +/-/space prefix (a CR of a CRLF file stays). */
  text: string
  /** Followed by `\ No newline at end of file`. */
  noNewline: boolean
  oldLine: number | null
  newLine: number | null
}

export interface PatchHunk {
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  lines: PatchLine[]
}

export interface ParsedPatch {
  /** `diff --git`, `index`, `---`, `+++` and mode lines, verbatim. */
  header: string[]
  hunks: PatchHunk[]
}

/** Diffs larger than this are only staged as whole files. */
const MAX_PARTIAL_DIFF_CHARS = 2_000_000

const NO_NEWLINE = '\\ No newline at end of file'
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

export const STALE_DIFF_MESSAGE = 'The file changed since its diff was shown. The latest version is shown now; try again.'
export const UNAPPLIABLE_SELECTION_MESSAGE =
  'Git could not apply just these lines. Include the lines next to them, or the whole hunk.'

/**
 * Parse the `git diff` of a single file. Null for diffs that cannot be split into hunks: binary files,
 * combined (conflict) diffs and submodules.
 */
export function parseUnifiedDiff(raw: string): ParsedPatch | null {
  const lines = raw.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  const header: string[] = []
  const hunks: PatchHunk[] = []
  let i = 0
  for (; i < lines.length && !lines[i].startsWith('@@'); i++) {
    const line = lines[i]
    if (line.startsWith('diff --cc') || line.startsWith('diff --combined')) return null
    if (line.startsWith('Binary files') || line.startsWith('GIT binary patch')) return null
    if (/^(index [0-9a-f]+\.\.[0-9a-f]+ |(new|deleted) file mode |old mode |new mode )160000\b/.test(line)) return null
    header.push(line)
  }
  while (i < lines.length) {
    const m = HUNK_HEADER_RE.exec(lines[i])
    if (!m) return null
    const hunk: PatchHunk = {
      oldStart: Number(m[1]),
      oldLines: m[2] === undefined ? 1 : Number(m[2]),
      newStart: Number(m[3]),
      newLines: m[4] === undefined ? 1 : Number(m[4]),
      lines: []
    }
    i++
    let oldLine = hunk.oldStart
    let newLine = hunk.newStart
    let oldLeft = hunk.oldLines
    let newLeft = hunk.newLines
    while (i < lines.length && (oldLeft > 0 || newLeft > 0 || lines[i].startsWith('\\'))) {
      const line = lines[i++]
      const prefix = line[0]
      const text = line.slice(1)
      if (prefix === '\\') {
        const last = hunk.lines[hunk.lines.length - 1]
        if (last) last.noNewline = true
      } else if (prefix === ' ' || (prefix === undefined && line === '')) {
        hunk.lines.push({ kind: 'context', text, noNewline: false, oldLine: oldLine++, newLine: newLine++ })
        oldLeft--
        newLeft--
      } else if (prefix === '-') {
        hunk.lines.push({ kind: 'del', text, noNewline: false, oldLine: oldLine++, newLine: null })
        oldLeft--
      } else if (prefix === '+') {
        hunk.lines.push({ kind: 'add', text, noNewline: false, oldLine: null, newLine: newLine++ })
        newLeft--
      } else {
        return null
      }
    }
    if (oldLeft !== 0 || newLeft !== 0) return null
    hunks.push(hunk)
  }
  return { header, hunks }
}

/** First line a hunk covers once its line count is known; a count of 0 names the line before. */
function firstLine(start: number, count: number): number {
  return count === 0 ? start + 1 : start
}

/**
 * The patch made of the selected changes only.
 *
 * Applied forward (stage), it starts from the old side: an unselected removal stays as context and an
 * unselected addition is left out. Applied in reverse (unstage, discard), it starts from the new side:
 * an unselected addition stays as context and an unselected removal is left out. Null when nothing is selected;
 * throws when the selection would put a line after one that has no newline.
 */
export function buildPartialPatch(
  parsed: ParsedPatch,
  isSelected: (line: PatchLine, hunkIndex: number) => boolean,
  reverse: boolean
): string | null {
  const out = [...parsed.header]
  let delta = 0
  let any = false
  parsed.hunks.forEach((hunk, hunkIndex) => {
    const body: string[] = []
    let oldCount = 0
    let newCount = 0
    let selected = false
    // A line without a newline ends its side: nothing may follow it there.
    let oldEnded = false
    let newEnded = false
    for (const line of hunk.lines) {
      let prefix: string | null
      if (line.kind === 'context') prefix = ' '
      else if (isSelected(line, hunkIndex)) {
        prefix = line.kind === 'add' ? '+' : '-'
        selected = true
      } else if ((line.kind === 'del' && !reverse) || (line.kind === 'add' && reverse)) prefix = ' '
      else prefix = null
      if (prefix === null) continue
      const onOld = prefix !== '+'
      const onNew = prefix !== '-'
      // Git would apply it, but join the two lines (`b` + `c` → `bc`).
      if ((onOld && oldEnded) || (onNew && newEnded)) throw new Error(UNAPPLIABLE_SELECTION_MESSAGE)
      body.push(prefix + line.text)
      if (line.noNewline) {
        body.push(NO_NEWLINE)
        if (onOld) oldEnded = true
        if (onNew) newEnded = true
      }
      if (onOld) oldCount++
      if (onNew) newCount++
    }
    if (!selected) return
    any = true
    // The side the patch is applied to keeps its positions; the other side moves by the earlier hunks' changes.
    let oldStart: number
    let newStart: number
    if (!reverse) {
      oldStart = hunk.oldStart
      const first = firstLine(oldStart, oldCount) + delta
      newStart = newCount === 0 ? first - 1 : first
    } else {
      newStart = hunk.newStart
      const first = firstLine(newStart, newCount) - delta
      oldStart = oldCount === 0 ? first - 1 : first
    }
    delta += newCount - oldCount
    out.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`, ...body)
  })
  return any ? `${out.join('\n')}\n` : null
}

async function readFileDiff(repoPath: string, path: string, side: 'staged' | 'unstaged'): Promise<string> {
  const args = [
    '--literal-pathspecs',
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--src-prefix=a/',
    '--dst-prefix=b/',
    '-U3',
    ...(side === 'staged' ? ['--cached'] : []),
    '--',
    path
  ]
  const result = await runGit({ cwd: repoPath, args })
  if (result.code !== 0) throw new Error(result.stderr.trim() || `git diff failed (${result.code})`)
  return result.stdout
}

function fingerprintOf(raw: string): string {
  return createHash('sha1').update(raw).digest('hex')
}

/** Parse a diff that may be split; null for the ones only whole files can be staged from. */
function splittable(raw: string): ParsedPatch | null {
  // U+FFFD: the file is not UTF-8, so a rebuilt patch would not match its bytes.
  if (!raw || raw.length > MAX_PARTIAL_DIFF_CHARS || raw.includes('�')) return null
  const parsed = parseUnifiedDiff(raw)
  if (!parsed || parsed.hunks.length === 0) return null
  // A whole new or deleted file has one hunk; Stage / Unstage of the file already does that.
  if (parsed.header.some((l) => l.startsWith('new file mode') || l.startsWith('deleted file mode'))) return null
  return parsed
}

function toHunks(parsed: ParsedPatch): DiffHunk[] {
  return parsed.hunks.map((h) => ({
    oldStart: h.oldStart,
    oldLines: h.oldLines,
    newStart: h.newStart,
    newLines: h.newLines,
    lines: h.lines.map((l) => ({ kind: l.kind, oldLine: l.oldLine, newLine: l.newLine }))
  }))
}

/** Hunks of a file's staged or unstaged changes, or undefined when only the whole file can be staged. */
export async function getDiffHunks(
  repoPath: string,
  path: string,
  side: 'staged' | 'unstaged'
): Promise<HunkSet | undefined> {
  resolveRepoPath(repoPath, path)
  const raw = await readFileDiff(repoPath, path, side)
  const parsed = splittable(raw)
  if (!parsed) return undefined
  return { fingerprint: fingerprintOf(raw), hunks: toHunks(parsed) }
}

export async function applyPartial(repoPath: string, request: ApplyPartialRequest): Promise<void> {
  const { path, side, action, fingerprint, selection } = request
  resolveRepoPath(repoPath, path)
  if ((action === 'unstage') !== (side === 'staged')) {
    throw new Error(`Cannot ${action} ${side} changes`)
  }
  const raw = await readFileDiff(repoPath, path, side)
  if (fingerprintOf(raw) !== fingerprint) throw new Error(STALE_DIFF_MESSAGE)
  const parsed = splittable(raw)
  if (!parsed) throw new Error('Only the whole file can be staged, unstaged or discarded.')

  let isSelected: (line: PatchLine, hunkIndex: number) => boolean
  if ('hunk' in selection) {
    isSelected = (_line, hunkIndex) => hunkIndex === selection.hunk
  } else {
    const oldLines = new Set(selection.oldLines)
    const newLines = new Set(selection.newLines)
    isSelected = (line) =>
      line.kind === 'del' ? oldLines.has(line.oldLine ?? -1) : newLines.has(line.newLine ?? -1)
  }
  const patch = buildPartialPatch(parsed, isSelected, action !== 'stage')
  if (!patch) throw new Error('No changed lines are selected.')

  if (action === 'discard') {
    await saveWorktreeRecovery(repoPath, `Before discarding lines in ${path}`)
  }

  const args = ['apply', '--whitespace=nowarn']
  if (action !== 'discard') args.push('--cached')
  if (action !== 'stage') args.push('-R')
  args.push('-')
  const result = await runGit({ cwd: repoPath, args, input: patch })
  if (result.code !== 0) {
    const detail = result.stderr.trim()
    throw new Error(detail ? `${UNAPPLIABLE_SELECTION_MESSAGE}\n\n${detail}` : UNAPPLIABLE_SELECTION_MESSAGE)
  }
}
