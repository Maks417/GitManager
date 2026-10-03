import type { Commit, GraphNode } from '@shared/ipc'
import { LANE_COLORS } from '@shared/theme'

export interface LayoutCommit {
  sha: string
  parents: string[]
}

/** Lane wait map after laying out a prefix of the commit list. Safe to resume for append-only growth. */
export type LayoutCheckpoint = (string | null)[]

export interface LayoutResult {
  nodes: GraphNode[]
  checkpoint: LayoutCheckpoint
  maxLane: number
}

function firstFreeLane(lanes: (string | null)[]): number {
  const free = lanes.indexOf(null)
  return free === -1 ? lanes.length : free
}

function layoutCommitStep(lanes: (string | null)[], commit: LayoutCommit): GraphNode {
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
  const node: GraphNode = {
    sha: commit.sha,
    lane,
    lanes: [...drawn].sort((a, b) => a - b),
    passThrough,
    joins,
    hasIncoming,
    connections
  }

  while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
  return node
}

function maxLaneOf(nodes: GraphNode[]): number {
  let max = 0
  for (const node of nodes) {
    for (const lane of node.lanes) if (lane > max) max = lane
  }
  return max
}

/**
 * Assigns lanes for commits in log order (children before parents, e.g. `git log --date-order`),
 * returning the nodes plus a checkpoint that can resume an append-only continuation.
 */
export function layoutCommitGraphWithCheckpoint(commits: LayoutCommit[]): LayoutResult {
  return appendLayoutCommitGraph([], commits)
}

/**
 * Continues a layout from `checkpoint` for commits appended after the previously laid-out prefix.
 * The returned `nodes` cover only `newCommits`; concatenate them onto the existing graph.
 */
export function appendLayoutCommitGraph(
  checkpoint: LayoutCheckpoint,
  newCommits: LayoutCommit[]
): LayoutResult {
  const lanes = [...checkpoint]
  const nodes: GraphNode[] = []
  for (const commit of newCommits) {
    nodes.push(layoutCommitStep(lanes, commit))
  }
  return {
    nodes,
    checkpoint: [...lanes],
    maxLane: maxLaneOf(nodes)
  }
}

/**
 * Assigns lanes for commits in log order (children before parents, e.g. `git log --date-order`).
 *
 * Each lane remembers the commit it is waiting for. When several lanes wait for the same commit
 * (branches forked from it), all of them end at that commit's row and are freed, so lanes never
 * leak and the graph stays as narrow as the number of branches open at any row.
 */
export function layoutCommitGraph(commits: LayoutCommit[]): GraphNode[] {
  return layoutCommitGraphWithCheckpoint(commits).nodes
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
