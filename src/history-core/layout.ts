import type { Commit, GraphNode } from '@shared/ipc'
import { LANE_COLORS } from '@shared/theme'

export interface LayoutCommit {
  sha: string
  parents: string[]
}

/**
 * Assigns lanes for a topology commit graph (newest-first / git log order).
 */
export function layoutCommitGraph(commits: LayoutCommit[]): GraphNode[] {
  const nodes: GraphNode[] = []
  let activeLanes: (string | null)[] = []

  for (const commit of commits) {
    let lane = activeLanes.indexOf(commit.sha)
    if (lane === -1) {
      lane = activeLanes.indexOf(null)
      if (lane === -1) {
        lane = activeLanes.length
        activeLanes.push(commit.sha)
      } else {
        activeLanes[lane] = commit.sha
      }
    }

    const connections: GraphNode['connections'] = []
    const parents = commit.parents

    if (parents.length === 0) {
      activeLanes[lane] = null
    } else {
      const firstParent = parents[0]
      activeLanes[lane] = firstParent
      connections.push({ fromLane: lane, toLane: lane, type: 'parent' })

      for (let i = 1; i < parents.length; i++) {
        const parent = parents[i]
        let parentLane = activeLanes.indexOf(parent)
        if (parentLane === -1) {
          parentLane = activeLanes.indexOf(null)
          if (parentLane === -1) {
            parentLane = activeLanes.length
            activeLanes.push(parent)
          } else {
            activeLanes[parentLane] = parent
          }
        }
        connections.push({ fromLane: lane, toLane: parentLane, type: 'merge' })
      }
    }

    // Compact trailing nulls for stable lane count snapshot
    const lanesSnapshot = activeLanes.map((_, i) => i).filter((i) => activeLanes[i] !== null)

    nodes.push({
      sha: commit.sha,
      lane,
      lanes: lanesSnapshot.length > 0 ? lanesSnapshot : [lane],
      connections
    })

    // Remove closed lanes from the end only to keep mid-lane indices stable
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop()
    }
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

export function filterCommits(
  commits: Commit[],
  opts: { search?: string; author?: string; mergesOnly?: boolean }
): Commit[] {
  const search = opts.search?.trim().toLowerCase()
  const author = opts.author?.trim().toLowerCase()

  return commits.filter((c) => {
    if (opts.mergesOnly && c.parents.length < 2) return false
    if (author && !c.authorName.toLowerCase().includes(author) && !c.authorEmail.toLowerCase().includes(author)) {
      return false
    }
    if (search) {
      const haystack = `${c.subject} ${c.body} ${c.sha} ${c.shortSha} ${c.refs.map((r) => r.name).join(' ')}`.toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

export function findCommitIndex(commits: Commit[], shaOrPrefix: string): number {
  const q = shaOrPrefix.toLowerCase()
  return commits.findIndex((c) => c.sha.toLowerCase() === q || c.sha.toLowerCase().startsWith(q))
}
