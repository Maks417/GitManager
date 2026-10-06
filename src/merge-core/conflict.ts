/** Lines `start` up to, not including, `end`; `start === end` is an empty range placed before line `start`. */
export interface LineRange {
  start: number
  end: number
}

export type RegionChoice = 'ours' | 'theirs' | 'both' | 'both-theirs-first'

export interface ConflictRegion {
  id: string
  /** 0-based line of the `<<<<<<<` marker in the text that was parsed. */
  startLine: number
  /** 0-based line of the `>>>>>>>` marker (the last line, when the region is never closed). */
  endLine: number
  ours: string
  theirs: string
  base?: string
  /** What follows the markers, such as `HEAD` or the merged branch; empty when Git wrote none. */
  oursLabel: string
  theirsLabel: string
  /** 0-based lines holding each side's text in the parsed text, without the marker lines. */
  oursLines: LineRange
  baseLines?: LineRange
  theirsLines: LineRange
  resolved: boolean
  resolution?: RegionChoice | 'manual'
  resultText?: string
}

const OURS_MARKER = /^<{7}(?: .*)?$/
const BASE_MARKER = /^\|{7}(?: .*)?$/
const SEPARATOR = /^={7}$/
const THEIRS_MARKER = /^>{7}(?: .*)?$/

const markerLabel = (line: string): string => line.slice(7).trim()

/** Dominant line ending of `text`, so edits keep a CRLF file CRLF. */
export function detectEol(text: string): '\r\n' | '\n' {
  let crlf = 0
  let lf = 0
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++
    else lf++
  }
  return crlf > lf ? '\r\n' : '\n'
}

/**
 * Parse conflict-marker files into editable regions, or synthesize
 * a single region when sides are provided without markers.
 */
export function parseConflictMarkers(text: string): ConflictRegion[] {
  const lines = text.split(/\r?\n/)
  const regions: ConflictRegion[] = []
  let i = 0
  let regionIndex = 0

  while (i < lines.length) {
    if (!OURS_MARKER.test(lines[i])) {
      i++
      continue
    }
    const startLine = i
    const oursLabel = markerLabel(lines[i])
    i++
    const oursStart = i
    while (i < lines.length && !BASE_MARKER.test(lines[i]) && !SEPARATOR.test(lines[i])) i++
    const oursLines = { start: oursStart, end: i }
    let baseLines: LineRange | undefined
    if (i < lines.length && BASE_MARKER.test(lines[i])) {
      i++
      const baseStart = i
      while (i < lines.length && !SEPARATOR.test(lines[i])) i++
      baseLines = { start: baseStart, end: i }
    }
    if (i < lines.length && SEPARATOR.test(lines[i])) i++
    const theirsStart = i
    while (i < lines.length && !THEIRS_MARKER.test(lines[i])) i++
    const theirsLines = { start: theirsStart, end: i }
    let theirsLabel = ''
    if (i < lines.length && THEIRS_MARKER.test(lines[i])) {
      theirsLabel = markerLabel(lines[i])
      i++
    }

    const text = (range: LineRange): string => lines.slice(range.start, range.end).join('\n')
    regions.push({
      id: `conflict-${regionIndex++}`,
      startLine,
      endLine: i - 1,
      ours: text(oursLines),
      theirs: text(theirsLines),
      base: baseLines && baseLines.end > baseLines.start ? text(baseLines) : undefined,
      oursLabel,
      theirsLabel,
      oursLines,
      baseLines,
      theirsLines,
      resolved: false
    })
  }

  return regions
}

/** The text that replaces a region, markers included, when `choice` resolves it. Lines are joined with `\n`. */
export function resolutionText(region: ConflictRegion, choice: RegionChoice): string {
  switch (choice) {
    case 'ours':
      return region.ours
    case 'theirs':
      return region.theirs
    case 'both':
      return [region.ours, region.theirs].filter(Boolean).join('\n')
    case 'both-theirs-first':
      return [region.theirs, region.ours].filter(Boolean).join('\n')
  }
}

export function applyRegionResolution(
  resultText: string,
  region: ConflictRegion,
  choice: RegionChoice | 'manual',
  manualText?: string
): { text: string; region: ConflictRegion } {
  const replacement =
    choice === 'manual' ? (manualText ?? region.resultText ?? region.ours) : resolutionText(region, choice)

  const lines = resultText.split(/\r?\n/)
  // If markers still present, replace by line range; otherwise leave manual edits as-is
  if (OURS_MARKER.test(resultText) || resultText.includes('<<<<<<<')) {
    const before = lines.slice(0, region.startLine)
    const after = lines.slice(region.endLine + 1)
    const mid = replacement.length ? replacement.split(/\r?\n/) : []
    const text = [...before, ...mid, ...after].join(detectEol(resultText))
    return {
      text,
      region: {
        ...region,
        resolved: true,
        resolution: choice,
        resultText: replacement
      }
    }
  }

  return {
    text: resultText,
    region: {
      ...region,
      resolved: true,
      resolution: choice,
      resultText: replacement
    }
  }
}

/** Where a region's sides sit in the ours and theirs files, as 1-based lines like editors number them. */
export interface RegionAnchor {
  ours: LineRange
  theirs: LineRange
}

function findBlock(lines: readonly string[], block: readonly string[], from: number): number {
  outer: for (let i = from; i + block.length <= lines.length; i++) {
    for (let j = 0; j < block.length; j++) if (lines[i + j] !== block[j]) continue outer
    return i
  }
  return -1
}

/**
 * Finds each region's text in one side's file. Git copies a conflict's sides verbatim from the files, so each block is
 * searched for after the previous region's match, which keeps repeated blocks in order. A side with no lines (it
 * removed them), or text that was edited in the result, is placed after the line just above the region instead.
 */
function locateSide(
  resultLines: readonly string[],
  regions: readonly ConflictRegion[],
  sideText: string,
  side: 'ours' | 'theirs'
): LineRange[] {
  const lines = sideText.split(/\r?\n/)
  let cursor = 0
  return regions.map((region, index) => {
    const range = side === 'ours' ? region.oursLines : region.theirsLines
    const length = range.end - range.start
    if (length > 0) {
      const at = findBlock(lines, resultLines.slice(range.start, range.end), cursor)
      if (at !== -1) {
        cursor = at + length
        return { start: at + 1, end: at + length + 1 }
      }
    }
    // The line just above the region, unless that line closes the previous region.
    const previousEnd = index > 0 ? regions[index - 1].endLine : -1
    if (region.startLine - 1 > previousEnd) {
      const at = findBlock(lines, [resultLines[region.startLine - 1]], cursor)
      if (at !== -1) cursor = at + 1
    }
    return { start: cursor + 1, end: cursor + 1 }
  })
}

/** Locates every region of `resultText` (as parsed from it) in the ours and theirs files. */
export function locateRegions(
  resultText: string,
  regions: readonly ConflictRegion[],
  oursText: string,
  theirsText: string
): RegionAnchor[] {
  const resultLines = resultText.split(/\r?\n/)
  const ours = locateSide(resultLines, regions, oursText, 'ours')
  const theirs = locateSide(resultLines, regions, theirsText, 'theirs')
  return regions.map((_, i) => ({ ours: ours[i], theirs: theirs[i] }))
}

export function hasUnresolvedMarkers(text: string): boolean {
  return /<<<<<<< /.test(text) || /^<<<<<<< /m.test(text) || text.includes('<<<<<<<')
}

export function mergeSidesToEditable(base: string, ours: string, theirs: string): {
  result: string
  regions: ConflictRegion[]
} {
  // Prefer a conflict-marker style result so the editor can highlight blocks
  if (ours === theirs) {
    return { result: ours, regions: [] }
  }
  const result = [
    '<<<<<<< Ours',
    ours,
    '||||||| Base',
    base,
    '=======',
    theirs,
    '>>>>>>> Theirs'
  ].join(detectEol(ours || theirs || base))
  return { result, regions: parseConflictMarkers(result) }
}
