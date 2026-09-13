export interface ConflictRegion {
  id: string
  startLine: number
  endLine: number
  ours: string
  theirs: string
  base?: string
  resolved: boolean
  resolution?: 'ours' | 'theirs' | 'both' | 'manual'
  resultText?: string
}

const OURS_MARKER = /^<{7}(?: .*)?$/
const BASE_MARKER = /^\|{7}(?: .*)?$/
const SEPARATOR = /^={7}$/
const THEIRS_MARKER = /^>{7}(?: .*)?$/

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
    i++
    const oursLines: string[] = []
    while (i < lines.length && !BASE_MARKER.test(lines[i]) && !SEPARATOR.test(lines[i])) {
      oursLines.push(lines[i])
      i++
    }
    const baseLines: string[] = []
    if (i < lines.length && BASE_MARKER.test(lines[i])) {
      i++
      while (i < lines.length && !SEPARATOR.test(lines[i])) {
        baseLines.push(lines[i])
        i++
      }
    }
    if (i < lines.length && SEPARATOR.test(lines[i])) i++
    const theirsLines: string[] = []
    while (i < lines.length && !THEIRS_MARKER.test(lines[i])) {
      theirsLines.push(lines[i])
      i++
    }
    if (i < lines.length && THEIRS_MARKER.test(lines[i])) i++

    regions.push({
      id: `conflict-${regionIndex++}`,
      startLine,
      endLine: i - 1,
      ours: oursLines.join('\n'),
      theirs: theirsLines.join('\n'),
      base: baseLines.length ? baseLines.join('\n') : undefined,
      resolved: false
    })
  }

  return regions
}

export function buildInitialResult(ours: string, theirs: string, workingTree?: string): string {
  if (workingTree && (OURS_MARKER.test(workingTree) || workingTree.includes('<<<<<<<'))) {
    return workingTree
  }
  if (workingTree) return workingTree
  return ours.length ? ours : theirs
}

export function applyRegionResolution(
  resultText: string,
  region: ConflictRegion,
  choice: 'ours' | 'theirs' | 'both' | 'manual',
  manualText?: string
): { text: string; region: ConflictRegion } {
  let replacement: string
  switch (choice) {
    case 'ours':
      replacement = region.ours
      break
    case 'theirs':
      replacement = region.theirs
      break
    case 'both':
      replacement = [region.ours, region.theirs].filter(Boolean).join('\n')
      break
    case 'manual':
      replacement = manualText ?? region.resultText ?? region.ours
      break
  }

  const lines = resultText.split(/\r?\n/)
  // If markers still present, replace by line range; otherwise leave manual edits as-is
  if (OURS_MARKER.test(resultText) || resultText.includes('<<<<<<<')) {
    const before = lines.slice(0, region.startLine)
    const after = lines.slice(region.endLine + 1)
    const mid = replacement.length ? replacement.split('\n') : []
    const text = [...before, ...mid, ...after].join('\n')
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
  ].join('\n')
  return { result, regions: parseConflictMarkers(result) }
}
