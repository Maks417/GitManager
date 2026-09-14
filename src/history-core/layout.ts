import type { Commit, GraphNode } from '@shared/ipc'
import { LANE_COLORS } from '@shared/theme'

export interface LayoutCommit {
  sha: string
  parents: string[]
}

function firstFreeLane(lanes: (string | null)[]): number {
  const free = lanes.indexOf(null)
  return free === -1 ? lanes.length : free
}

/**
 * Assigns lanes for commits in log order (children before parents, e.g. `git log --date-order`).
 *
 * Each lane remembers the commit it is waiting for. When several lanes wait for the same commit
 * (branches forked from it), all of them end at that commit's row and are freed, so lanes never
 * leak and the graph stays as narrow as the number of branches open at any row.
 */
export function layoutCommitGraph(commits: LayoutCommit[]): GraphNode[] {
  const nodes: GraphNode[] = []
  const lanes: (string | null)[] = []

  for (const commit of commits) {
    const incoming: number[] = []
    const passThrough: number[] = []
    lanes.forEach((sha, i) => {
      if (sha === commit.sha) incoming.push(i)
      else if (sha !== null) passThrough.push(i)
    })

    const hasIncoming = incoming.length > 0
    const lane = hasIncoming ? incoming[0] : firstFreeLane(lanes)
    const joins = incoming.slice(1)
    for (const i of joins) lanes[i] = null
    if (lane === lanes.length) lanes.push(null)

    const connections: GraphNode['connections'] = []
    const [firstParent, ...mergeParents] = commit.parents
    lanes[lane] = firstParent ?? null
    if (firstParent) connections.push({ fromLane: lane, toLane: lane, type: 'parent' })
    for (const parent of mergeParents) {
      let parentLane = lanes.indexOf(parent)
      if (parentLane === -1) {
        parentLane = firstFreeLane(lanes)
        if (parentLane === lanes.length) lanes.push(parent)
        else lanes[parentLane] = parent
      }
      connections.push({ fromLane: lane, toLane: parentLane, type: 'merge' })
    }

    const drawn = new Set([lane, ...passThrough, ...joins, ...connections.map((c) => c.toLane)])
    nodes.push({
      sha: commit.sha,
      lane,
      lanes: [...drawn].sort((a, b) => a - b),
      passThrough,
      joins,
      hasIncoming,
      connections
    })

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
  }

  return nodes
}

export function decorateCommitsWithColors(commits: Commit[]): Commit[] {
  const palette = [...LANE_COLORS]
  let colorIndex = 0
  const colorMap = new Map<string, string>()

  return commits.map((commit) => ({
    ...commit,
    refs: commit.refs.map((ref) => {
      if (!colorMap.has(ref.name)) {
        colorMap.set(ref.name, palette[colorIndex % palette.length])
        colorIndex++
      }
      return { ...ref, color: colorMap.get(ref.name) }
    })
  }))
}
