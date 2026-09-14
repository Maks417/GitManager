import { branchLocalName, isRemoteHead, splitBranchTokens, type BranchName } from '@shared/branch-search'

/** The word at the end of the search box that branch suggestions complete. */
export interface BranchQuery {
  /** Where the word starts; a chosen suggestion replaces the text from here on. */
  start: number
  /** Text to look for in branch names. */
  text: string
  /** Typed as `branch:…` rather than as a plain word. */
  explicit: boolean
}

/** Plain words shorter than this suggest nothing, so ordinary message searches stay quiet. */
const MIN_PLAIN_WORD = 2

export function branchQueryAt(input: string): BranchQuery | null {
  const word = /\S*$/.exec(input)?.[0] ?? ''
  const start = input.length - word.length
  const prefix = /^branch:/i.exec(word)
  if (prefix) return { start, text: word.slice(prefix[0].length), explicit: true }
  // Branch names never contain `:`, so `author:…` and the like are not branch words.
  if (word.length < MIN_PLAIN_WORD || word.includes(':')) return null
  // `author:` takes the rest of the search: a later word is part of the author's name.
  if (/^author:/i.test(splitBranchTokens(input.slice(0, start)).rest)) return null
  return { start, text: word, explicit: false }
}

/**
 * Branches for the suggestion list: exact names first, then names that start with the text, then
 * names that contain it. Local branches come before remote ones within each group.
 */
export function suggestBranches<T extends BranchName>(text: string, branches: readonly T[], limit = 8): T[] {
  const needle = text.toLowerCase()
  const ranked: Array<{ branch: T; rank: number; order: number }> = []
  branches.forEach((branch, order) => {
    if (isRemoteHead(branch)) return
    const name = branch.name.toLowerCase()
    const local = branchLocalName(branch).toLowerCase()
    let group: number
    if (!needle) group = 2
    else if (name === needle || local === needle) group = 0
    else if (name.startsWith(needle) || local.startsWith(needle)) group = 1
    else if (name.includes(needle)) group = 2
    else return
    ranked.push({ branch, rank: group * 2 + (branch.remote ? 1 : 0), order })
  })
  ranked.sort((a, b) => a.rank - b.rank || a.order - b.order)
  return ranked.slice(0, limit).map((r) => r.branch)
}

/** The search text with its last word replaced by a `branch:` filter for `name`. */
export function withBranchFilter(input: string, query: BranchQuery, name: string): string {
  return `${input.slice(0, query.start)}branch:${name}`
}

/** "main, origin/main", or "a, b, c and 2 more". */
export function describeBranches(names: readonly string[], shown = 3): string {
  if (names.length <= shown) return names.join(', ')
  return `${names.slice(0, shown).join(', ')} and ${names.length - shown} more`
}
