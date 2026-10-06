import type { ConflictRegion, LineRange, RegionAnchor } from '@merge-core/conflict'
import type { SideChange } from '@shared/ipc'
import * as monaco from '../../lib/monaco-api'

type Decoration = monaco.editor.IModelDeltaDecoration
export type MergeSide = 'ours' | 'theirs'

/** Scrollbar marks. Plain colors: Monaco paints them on a canvas, where CSS variables don't apply. */
const RULER = {
  conflict: '#e87070',
  ours: '#5fa86a',
  theirs: '#5b8fd9'
}

function lineDecoration(
  start: number,
  end: number,
  className: string,
  gutter?: string,
  ruler?: { color: string; lane: monaco.editor.OverviewRulerLane }
): Decoration {
  return {
    range: new monaco.Range(start, 1, end, 1),
    options: {
      isWholeLine: true,
      className,
      linesDecorationsClassName: gutter,
      overviewRuler: ruler ? { color: ruler.color, position: ruler.lane } : undefined
    }
  }
}

/**
 * A 1-based empty range, drawn as a line across the gap where a side has no lines: at the top of the line that follows,
 * or under the last line.
 */
function gapDecoration(at: number, lineCount: number, className: string, ruler?: string): Decoration {
  const below = at > lineCount
  const line = Math.max(1, Math.min(at, lineCount))
  return {
    range: new monaco.Range(line, 1, line, 1),
    options: {
      isWholeLine: true,
      className: `${className} ${below ? 'merge-gap-below' : 'merge-gap-above'}`,
      overviewRuler: ruler ? { color: ruler, position: monaco.editor.OverviewRulerLane.Full } : undefined
    }
  }
}

/** 0-based half-open `range` of the result as 1-based inclusive lines, or null when it is empty. */
function resultLines(range: LineRange | undefined): [number, number] | null {
  return range && range.end > range.start ? [range.start + 1, range.end] : null
}

/** The result: each conflict's ours, base and theirs text in its side's color, its marker lines dimmed. */
export function resultDecorations(regions: readonly ConflictRegion[], activeId: string | null): Decoration[] {
  const decorations: Decoration[] = []
  for (const region of regions) {
    const active = region.id === activeId ? ' merge-active' : ''
    const sections: [LineRange | undefined, string][] = [
      [region.oursLines, 'ours'],
      [region.baseLines, 'base'],
      [region.theirsLines, 'theirs']
    ]
    const content = new Set<number>()
    for (const [range, kind] of sections) {
      const lines = resultLines(range)
      if (!lines) continue
      for (let line = lines[0]; line <= lines[1]; line++) content.add(line)
      decorations.push(lineDecoration(lines[0], lines[1], `merge-${kind}-line${active}`, `merge-${kind}-gutter`))
    }
    for (let line = region.startLine + 1; line <= region.endLine + 1; line++) {
      if (!content.has(line)) decorations.push(lineDecoration(line, line, `merge-marker-line${active}`))
    }
    decorations.push({
      range: new monaco.Range(region.startLine + 1, 1, region.endLine + 1, 1),
      options: {
        isWholeLine: true,
        overviewRuler: { color: RULER.conflict, position: monaco.editor.OverviewRulerLane.Full },
        ...(active ? { marginClassName: 'merge-active-margin' } : {})
      }
    })
  }
  return decorations
}

/**
 * Ours or theirs: lines the side changed from the base lightly tinted, the conflicting blocks strongly, each marked on
 * the scrollbar.
 */
export function sideDecorations(
  side: MergeSide,
  lineCount: number,
  changes: readonly SideChange[],
  anchors: readonly RegionAnchor[],
  activeIndex: number
): Decoration[] {
  const decorations: Decoration[] = []
  const lane = side === 'ours' ? monaco.editor.OverviewRulerLane.Left : monaco.editor.OverviewRulerLane.Right
  for (const { side: range } of changes) {
    if (range.end > range.start) {
      decorations.push(
        lineDecoration(range.start, range.end - 1, `merge-${side}-changed`, undefined, { color: RULER[side], lane })
      )
    } else {
      decorations.push(gapDecoration(range.start, lineCount, `merge-${side}-gap`))
    }
  }
  anchors.forEach((anchor, index) => {
    const range = anchor[side]
    const active = index === activeIndex ? ' merge-active' : ''
    if (range.end > range.start) {
      decorations.push(
        lineDecoration(range.start, range.end - 1, `merge-${side}-line${active}`, `merge-${side}-gutter`, {
          color: RULER.conflict,
          lane: monaco.editor.OverviewRulerLane.Full
        })
      )
    } else {
      decorations.push(gapDecoration(range.start, lineCount, `merge-conflict-gap${active}`, RULER.conflict))
    }
  })
  return decorations
}

/** The base: the lines each side replaced, in that side's color. */
export function baseDecorations(
  lineCount: number,
  oursChanges: readonly SideChange[],
  theirsChanges: readonly SideChange[]
): Decoration[] {
  const decorations: Decoration[] = []
  const add = (changes: readonly SideChange[], side: MergeSide): void => {
    const lane = side === 'ours' ? monaco.editor.OverviewRulerLane.Left : monaco.editor.OverviewRulerLane.Right
    for (const { base } of changes) {
      if (base.end > base.start) {
        decorations.push(
          lineDecoration(base.start, base.end - 1, `merge-${side}-changed`, `merge-${side}-gutter`, {
            color: RULER[side],
            lane
          })
        )
      } else {
        decorations.push(gapDecoration(base.start, lineCount, `merge-${side}-gap`))
      }
    }
  }
  add(oursChanges, 'ours')
  add(theirsChanges, 'theirs')
  return decorations
}
