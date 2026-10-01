import type { DiffHunk } from '@shared/ipc'

/** Lines of the new file a hunk covers, context included; a hunk that only removes lines covers the line after. */
export function hunkLineRange(hunk: DiffHunk): { start: number; end: number } {
  const start = Math.max(1, hunk.newStart + (hunk.newLines === 0 ? 1 : 0))
  return { start, end: Math.max(start, hunk.newStart + hunk.newLines - 1) }
}

/** The hunk whose lines include `line` of the new file, or -1. */
export function hunkAtLine(hunks: DiffHunk[], line: number): number {
  return hunks.findIndex((h) => {
    const { start, end } = hunkLineRange(h)
    return line >= start && line <= end
  })
}

/**
 * Where a hunk's first change shows in the new file: an added line itself, or the line that follows removed ones.
 */
export function firstChangeLine(hunk: DiffHunk): number {
  let next = hunk.newStart
  for (const line of hunk.lines) {
    if (line.kind !== 'context') return Math.max(1, line.kind === 'add' ? (line.newLine ?? next) : next)
    next = (line.newLine ?? next) + 1
  }
  return Math.max(1, hunk.newStart)
}

/**
 * Changed lines picked by an editor selection.
 *
 * `newLines` are selected lines of the new file: they pick added lines, and the lines removed right before an
 * added or kept line (what that line replaced). `oldLines` are selected lines of the old file (the left side of a
 * side-by-side diff): they pick removed lines.
 */
export function selectedChanges(
  hunks: DiffHunk[],
  newLines: ReadonlySet<number>,
  oldLines: ReadonlySet<number>
): { oldLines: number[]; newLines: number[] } {
  const pickedOld: number[] = []
  const pickedNew: number[] = []
  for (const hunk of hunks) {
    let pendingRemoved: number[] = []
    const settle = (newLine: number | null): void => {
      if (newLine !== null && newLines.has(newLine)) pickedOld.push(...pendingRemoved.filter((n) => !oldLines.has(n)))
      pendingRemoved = []
    }
    for (const line of hunk.lines) {
      if (line.kind === 'del' && line.oldLine !== null) {
        if (oldLines.has(line.oldLine)) pickedOld.push(line.oldLine)
        pendingRemoved.push(line.oldLine)
      } else if (line.kind === 'add' && line.newLine !== null) {
        if (newLines.has(line.newLine)) pickedNew.push(line.newLine)
        settle(line.newLine)
      } else {
        settle(line.newLine)
      }
    }
    // Removed lines at the very end of the file: the last line before them stands in for them.
    if (pendingRemoved.length > 0) settle(hunk.newStart + hunk.newLines - 1 >= 1 ? hunk.newStart + hunk.newLines - 1 : null)
  }
  return { oldLines: [...new Set(pickedOld)].sort((a, b) => a - b), newLines: pickedNew }
}

/** Lines an editor selection covers; a selection ending at the start of a line does not cover that line. */
export function selectionLines(
  ranges: readonly { startLineNumber: number; endLineNumber: number; endColumn: number; isEmpty(): boolean }[]
): Set<number> {
  const lines = new Set<number>()
  for (const r of ranges) {
    if (r.isEmpty()) continue
    const end = r.endColumn === 1 && r.endLineNumber > r.startLineNumber ? r.endLineNumber - 1 : r.endLineNumber
    for (let n = r.startLineNumber; n <= end; n++) lines.add(n)
  }
  return lines
}
