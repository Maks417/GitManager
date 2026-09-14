/** A local or remote-tracking branch, as `branch:` searches see it. */
export interface BranchName {
  /** `main`, or `origin/main` for a remote-tracking branch. */
  name: string
  /** Remote of a remote-tracking branch; null for a local branch. */
  remote: string | null
}

const BRANCH_TOKEN_RE = /(^|\s)branch:(\S+)/gi

/**
 * Take `branch:<pattern>` tokens out of a history search. They may appear anywhere; the rest of the
 * text is searched as before (`author:`, a commit id, or message text).
 */
export function splitBranchTokens(raw: string | undefined): { branchPatterns: string[]; rest: string } {
  const branchPatterns: string[] = []
  const rest = (raw ?? '').replace(BRANCH_TOKEN_RE, (_token, _lead: string, pattern: string) => {
    branchPatterns.push(pattern)
    return ''
  })
  return { branchPatterns, rest: rest.trim() }
}

/** The name without its remote: `main` for both `main` and `origin/main`. */
export function branchLocalName(branch: BranchName): string {
  return branch.remote ? branch.name.slice(branch.remote.length + 1) : branch.name
}

/** `origin/HEAD` points at a remote's default branch; it is not a branch of its own. */
export function isRemoteHead(branch: BranchName): boolean {
  return branch.remote !== null && branchLocalName(branch) === 'HEAD'
}

function globRegExp(pattern: string): RegExp {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${source}$`, 'i')
}

/**
 * The branches one `branch:` pattern selects, case-insensitively:
 * - a pattern with `*` or `?` is a glob (`feature/*`);
 * - otherwise branches with exactly that name, where `main` also names `origin/main`;
 * - and when there are none, every branch whose name contains the pattern.
 */
export function matchBranches<T extends BranchName>(pattern: string, branches: readonly T[]): T[] {
  const needle = pattern.trim()
  if (!needle) return []
  const candidates = branches.filter((b) => !isRemoteHead(b))
  if (/[*?]/.test(needle)) {
    const glob = globRegExp(needle)
    return candidates.filter((b) => glob.test(b.name) || glob.test(branchLocalName(b)))
  }
  const lower = needle.toLowerCase()
  const exact = candidates.filter(
    (b) => b.name.toLowerCase() === lower || branchLocalName(b).toLowerCase() === lower
  )
  if (exact.length > 0) return exact
  return candidates.filter((b) => b.name.toLowerCase().includes(lower))
}

/** The branches any of the patterns selects, in their original order. */
export function matchBranchPatterns<T extends BranchName>(patterns: readonly string[], branches: readonly T[]): T[] {
  const selected = new Set<T>()
  for (const pattern of patterns) {
    for (const branch of matchBranches(pattern, branches)) selected.add(branch)
  }
  return branches.filter((b) => selected.has(b))
}
