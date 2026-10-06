import type { ConflictRegion, RegionAnchor } from '@merge-core/conflict'
import type { SideChange } from '@shared/ipc'

/** A line of one pane and the line shown next to it in another; 1-based, line `n + 1` being the end of line `n`. */
export type LinePair = readonly [from: number, to: number]

/**
 * Points where the result and one side must line up: the file starts and ends, and each conflict's block of that
 * side, which sits next to its text in the result. The other parts of a conflict (markers, the other side) face the
 * block's edges. Between the points lines are spread evenly, which absorbs the lines Git merged on its own.
 */
export function sideLinePairs(
  regions: readonly ConflictRegion[],
  anchors: readonly RegionAnchor[],
  side: 'ours' | 'theirs',
  resultLineCount: number,
  sideLineCount: number
): LinePair[] {
  const pairs: LinePair[] = [[1, 1]]
  regions.forEach((region, i) => {
    const anchor = anchors[i]?.[side]
    if (!anchor) return
    const lines = side === 'ours' ? region.oursLines : region.theirsLines
    pairs.push(
      [region.startLine + 1, anchor.start],
      [lines.start + 1, anchor.start],
      [lines.end + 1, anchor.end],
      [region.endLine + 2, anchor.end]
    )
  })
  pairs.push([resultLineCount + 1, sideLineCount + 1])
  return forward(pairs)
}

/** Only the points that move forward on both sides; an edited result can break the order. */
function forward(pairs: readonly LinePair[]): LinePair[] {
  const kept: LinePair[] = []
  for (const pair of pairs) {
    const last = kept[kept.length - 1]
    if (!last || (pair[0] >= last[0] && pair[1] >= last[1])) kept.push(pair)
  }
  return kept
}

/** Side lines paired with base lines at the edges of every block the side changed. */
export function baseLinePairs(changes: readonly SideChange[], sideLineCount: number, baseLineCount: number): LinePair[] {
  const pairs: LinePair[] = [[1, 1]]
  for (const change of changes) pairs.push([change.side.start, change.base.start], [change.side.end, change.base.end])
  pairs.push([sideLineCount + 1, baseLineCount + 1])
  return forward(pairs)
}

/**
 * Maps a (fractional) line through `pairs`, from the result to the side, or back with `reverse`. Where several points
 * share the line being mapped from, the first one wins.
 */
export function mapLine(pairs: readonly LinePair[], line: number, reverse = false): number {
  const from = reverse ? 1 : 0
  const to = reverse ? 0 : 1
  if (pairs.length === 0) return line
  if (line <= pairs[0][from]) return pairs[0][to] - (pairs[0][from] - line)
  for (let i = 0; i < pairs.length - 1; i++) {
    const a = pairs[i]
    const b = pairs[i + 1]
    if (line > b[from]) continue
    const span = b[from] - a[from]
    if (span === 0) return a[to]
    return a[to] + ((line - a[from]) / span) * (b[to] - a[to])
  }
  const last = pairs[pairs.length - 1]
  return last[to] + (line - last[from])
}
