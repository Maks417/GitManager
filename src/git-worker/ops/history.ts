import type {
  Commit,
  CommitDetail,
  CommitRef,
  DiffResult,
  FileChange,
  HistoryPage,
  HistoryQuery
} from '@shared/ipc'
import { decorateCommitsWithColors, layoutCommitGraph } from '@history-core/layout'
import { matchBranchPatterns, splitBranchTokens, type BranchName } from '@shared/branch-search'
import { HISTORY_PAGE_SIZE } from '@shared/layout-defaults'
import { parseHistorySearch, type HistorySearch } from '../history-query'
import { gitOk, readGitShowCapped, runGit, runGitDelimited } from '../git-runner'
import { assertRevision, assertSha, readRepoFile, resolveRepoPath } from './guards'
import { resolveHeadSha, SHA_RE } from './shared'

/** List payload omits body (`%b`) — load body only in commit detail. */
const LIST_LOG_FORMAT = ['%H', '%h', '%P', '%s', '%an', '%ae', '%aI', '%D'].join('%x1f') + '%x1e'

const DETAIL_LOG_FORMAT = [
  '%H',
  '%h',
  '%P',
  '%s',
  '%b',
  '%an',
  '%ae',
  '%aI',
  '%D'
].join('%x1f') + '%x1e'

/** A jump to a commit reads at most this many commits looking for it. */
const REVEAL_MAX_COMMITS = 10_000

function shortRefName(ref: string): string {
  return ref.replace(/^refs\/(heads|remotes|tags)\//, '')
}

/** Parse `%D` from `--decorate=full`: full ref names tell local branches, remotes and tags apart. */
function parseRefs(decorate: string): CommitRef[] {
  if (!decorate.trim()) return []
  return decorate
    .split(', ')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((name): CommitRef => {
      if (name === 'HEAD') return { name, type: 'head' }
      if (name.startsWith('HEAD -> ')) return { name: `HEAD → ${shortRefName(name.slice(8))}`, type: 'head' }
      if (name.startsWith('tag: ')) return { name: shortRefName(name.slice(5)), type: 'tag' }
      if (name.startsWith('refs/remotes/')) return { name: shortRefName(name), type: 'remote' }
      if (name.startsWith('refs/tags/')) return { name: shortRefName(name), type: 'tag' }
      return { name: shortRefName(name), type: 'local' }
    })
}

function parseListCommitRecord(record: string): Commit | null {
  const parts = record.split('\x1f')
  const sha = parts[0]
  if (!sha) return null
  const [shortSha, parents, subject, authorName, authorEmail, authoredAt, decorate] = parts.slice(1)
  return {
    sha,
    shortSha: shortSha || sha.slice(0, 7),
    subject: subject || '(no subject)',
    body: '',
    authorName: authorName || '',
    authorEmail: authorEmail || '',
    authoredAt: authoredAt || '',
    parents: parents ? parents.split(' ').filter(Boolean) : [],
    refs: parseRefs(decorate || '')
  }
}

/** The commit id a list record starts with. */
function recordSha(record: string): string {
  return record.trimStart().split('\x1f', 1)[0]
}

function appendSearchArgs(args: string[], search: HistorySearch | null, author: string | undefined): void {
  const authorText = author?.trim() || (search?.kind === 'author' ? search.text : '')
  // A commit id that did not resolve (or later pages) is still looked for in messages.
  const messageText = search && search.kind !== 'author' ? search.text : ''
  if (!authorText && !messageText) return
  // Literal, case-insensitive matching: `(`, `|`, `{` and friends are never regex operators.
  args.push('--fixed-strings', '--regexp-ignore-case')
  if (authorText) args.push(`--author=${authorText}`)
  if (messageText) args.push(`--grep=${messageText}`)
}

interface BranchRef extends BranchName {
  /** Full ref name, e.g. `refs/remotes/origin/main`. */
  refName: string
}

/** Local and remote-tracking branches. Full ref names keep a local branch called `origin/x` apart from the remote one. */
async function listBranchRefs(repoPath: string): Promise<BranchRef[]> {
  const out = await gitOk(repoPath, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
  const refs: BranchRef[] = []
  for (const line of out.split('\n')) {
    const refName = line.trim()
    if (refName.startsWith('refs/heads/')) {
      refs.push({ refName, name: refName.slice('refs/heads/'.length), remote: null })
    } else if (refName.startsWith('refs/remotes/')) {
      const name = refName.slice('refs/remotes/'.length)
      const slash = name.indexOf('/')
      if (slash > 0) refs.push({ refName, name, remote: name.slice(0, slash) })
    }
  }
  return refs
}

function noBranchMatches(patterns: string[]): string {
  return `No branch matches ${patterns.map((p) => `"${p}"`).join(' or ')}.`
}

export async function loadHistory(query: HistoryQuery): Promise<HistoryPage> {
  const headSha = await resolveHeadSha(query.repoPath)
  const limit = query.limit ?? HISTORY_PAGE_SIZE
  const reveal = query.revealSha?.toLowerCase()
  // A jump reads from the top down to its commit.
  const skip = reveal ? 0 : (query.skip ?? 0)
  const { branchPatterns, rest } = splitBranchTokens(query.search)

  // Unborn branch / empty repo: no commits yet
  if (!headSha && !query.branch && branchPatterns.length === 0) {
    return { commits: [], graph: [], nextCursor: null, headSha: null }
  }

  if (query.branch) assertRevision(query.branch, 'branch')
  const search = parseHistorySearch(rest)

  // A commit id jumps straight to that commit (first page only).
  if (search?.kind === 'sha' && skip === 0 && !reveal) {
    const resolved = await runGit({
      cwd: query.repoPath,
      args: ['rev-parse', '--verify', '--quiet', `${search.sha}^{commit}`]
    })
    if (resolved.code === 0) {
      const fullSha = resolved.stdout.trim()
      if (SHA_RE.test(fullSha)) {
        const one = await runGitDelimited({
          cwd: query.repoPath,
          args: ['log', '--decorate=full', `--format=${LIST_LOG_FORMAT}`, '-n', '1', fullSha],
          delimiter: '\x1e',
          maxRecords: 2
        })
        if (one.code === 0) {
          const commits: Commit[] = []
          for (const record of one.records) {
            const trimmed = record.trim()
            if (!trimmed) continue
            const commit = parseListCommitRecord(trimmed)
            if (commit) commits.push(commit)
          }
          const decorated = decorateCommitsWithColors(commits)
          return {
            commits: decorated,
            graph: layoutCommitGraph(decorated),
            nextCursor: null,
            headSha
          }
        }
      }
    }
  }

  // `branch:` patterns take the place of the current-branch filter and of the all-branches walk.
  let branchRefs: BranchRef[] | null = null
  if (branchPatterns.length > 0) {
    branchRefs = matchBranchPatterns(branchPatterns, await listBranchRefs(query.repoPath))
    if (branchRefs.length === 0) {
      return {
        commits: [],
        graph: [],
        nextCursor: null,
        headSha,
        branches: [],
        notice: noBranchMatches(branchPatterns)
      }
    }
  }
  const branches = branchRefs?.map((b) => b.name)

  // --date-order keeps children before parents, which the lane layout relies on. Pages are offsets
  // into that single walk, so commits reachable only from other branches are never skipped.
  const maxCount = reveal ? REVEAL_MAX_COMMITS + limit : limit
  const args = ['log', '--date-order', '--decorate=full', `--format=${LIST_LOG_FORMAT}`, `--max-count=${maxCount}`]
  if (skip > 0) args.push(`--skip=${skip}`)
  if (query.mergesOnly) args.push('--merges')
  appendSearchArgs(args, search, query.author)

  let input: string | undefined
  if (branchRefs) {
    // On stdin: `branch:*` in a large repository can match more refs than a command line holds.
    args.push('--stdin')
    input = `${branchRefs.map((b) => b.refName).join('\n')}\n`
  } else if (query.branch) {
    if (query.branch === 'HEAD' && !headSha) {
      return { commits: [], graph: [], nextCursor: null, headSha: null }
    }
    args.push(query.branch)
  } else {
    // Stash entries are refs too, but they are not history.
    args.push('--exclude=refs/stash', '--all')
  }
  if (query.path) args.push('--', query.path)

  // A jump stops one page past its commit, or gives up after REVEAL_MAX_COMMITS.
  let revealIndex = -1
  const logResult = await runGitDelimited({
    cwd: query.repoPath,
    args,
    input,
    delimiter: '\x1e',
    maxRecords: reveal ? undefined : limit + 2,
    stopWhen: reveal
      ? (records) => {
          if (revealIndex < 0 && recordSha(records[records.length - 1]) === reveal) {
            revealIndex = records.length - 1
          }
          return revealIndex >= 0 ? records.length > revealIndex + limit : records.length >= REVEAL_MAX_COMMITS
        }
      : undefined
  })
  if (logResult.code !== 0) {
    if (/does not have any commits yet|bad revision|unknown revision|ambiguous argument/i.test(logResult.stderr)) {
      return { commits: [], graph: [], nextCursor: null, headSha, branches }
    }
    throw new Error(logResult.stderr || 'git log failed')
  }

  let commits: Commit[] = []
  for (const record of logResult.records) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const commit = parseListCommitRecord(trimmed)
    if (commit) commits.push(commit)
  }

  let pageSize = limit
  let revealed: boolean | undefined
  if (reveal) {
    const index = commits.findIndex((c) => c.sha === reveal)
    revealed = index >= 0
    // Found: every commit down to it and one page more. Not found: an ordinary first page.
    if (revealed) pageSize = index + 1 + limit
    commits = commits.slice(0, pageSize)
  }

  const decorated = decorateCommitsWithColors(commits)
  const graph = layoutCommitGraph(decorated)
  const nextCursor = decorated.length >= pageSize ? decorated[decorated.length - 1]?.sha ?? null : null

  return {
    commits: decorated,
    graph,
    nextCursor,
    headSha,
    branches,
    revealed
  }
}

export async function getCommitDetail(repoPath: string, sha: string): Promise<CommitDetail> {
  if (!sha || sha === 'HEAD') {
    const head = await resolveHeadSha(repoPath)
    if (!head) {
      throw new Error('This repository has no commits yet. Commit your working copy first.')
    }
    sha = head
  }
  if (!SHA_RE.test(sha)) {
    throw new Error(`Invalid commit reference: ${sha}`)
  }

  const exists = await runGit({ cwd: repoPath, args: ['cat-file', '-e', `${sha}^{commit}`] })
  if (exists.code !== 0) {
    throw new Error(`Commit not found in this repository: ${sha.slice(0, 12)}`)
  }

  const showOut = await gitOk(repoPath, [
    'show',
    '--no-patch',
    '--decorate=full',
    '--format=' + DETAIL_LOG_FORMAT,
    sha
  ])
  const [header] = showOut.split('\x1e')
  const parts = (header || showOut).split('\x1f')
  const commit: Commit = {
    sha: parts[0] || sha,
    shortSha: parts[1] || sha.slice(0, 7),
    parents: parts[2] ? parts[2].split(' ').filter(Boolean) : [],
    subject: parts[3] || '',
    body: parts[4] || '',
    authorName: parts[5] || '',
    authorEmail: parts[6] || '',
    authoredAt: parts[7] || '',
    refs: parseRefs(parts[8] || '')
  }

  // -z: raw (unquoted) paths; --root: list the initial commit's files; -M: detect renames.
  const nameStatus = await gitOk(repoPath, [
    'diff-tree',
    '-z',
    '--no-commit-id',
    '--name-status',
    '-r',
    '-M',
    '--root',
    '-m',
    '--first-parent',
    sha
  ])

  return { commit: decorateCommitsWithColors([commit])[0], files: parseNameStatusZ(nameStatus) }
}

function mapNameStatus(s: string): FileChange['status'] {
  if (s.startsWith('A')) return 'added'
  if (s.startsWith('D')) return 'deleted'
  if (s.startsWith('R')) return 'renamed'
  if (s.startsWith('C')) return 'copied'
  if (s.startsWith('U')) return 'unmerged'
  if (s.startsWith('T')) return 'typechange'
  return 'modified'
}

/** Parse `--name-status -z` output: `S\0path\0`, or `R100\0old\0new\0` for renames/copies. */
export function parseNameStatusZ(out: string): FileChange[] {
  const tokens = out.split('\0')
  const files: FileChange[] = []
  let i = 0
  while (i < tokens.length) {
    const status = tokens[i++]
    if (!status) continue
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = tokens[i++]
      const path = tokens[i++]
      if (path) files.push({ path, oldPath, status: mapNameStatus(status) })
    } else {
      const path = tokens[i++]
      if (path) files.push({ path, status: mapNameStatus(status) })
    }
  }
  return files
}

/** Keep Monaco responsive; full package-lock-sized buffers stall the DiffEditor. */
const MAX_DIFF_CHARS = 180_000
/** Byte budget roughly matching MAX_DIFF_CHARS for UTF-8 text. */
const MAX_DIFF_BYTES = MAX_DIFF_CHARS * 4

function capDiffText(text: string): string {
  if (text.length <= MAX_DIFF_CHARS) return text
  return `${text.slice(0, MAX_DIFF_CHARS)}\n\n… [truncated for display — file is larger]\n`
}

async function gitBlobSize(repoPath: string, spec: string): Promise<number | null> {
  const result = await runGit({ cwd: repoPath, args: ['cat-file', '-s', spec] })
  if (result.code !== 0) return null
  const n = Number(result.stdout.trim())
  return Number.isFinite(n) ? n : null
}

/**
 * Read a git blob as text without buffering multi‑MB files first.
 * Probes size with `cat-file -s`, then streams a capped `git show`.
 */
async function readGitBlobText(repoPath: string, spec: string): Promise<{ text: string; binary: boolean }> {
  const size = await gitBlobSize(repoPath, spec)
  if (size === null) return { text: '', binary: false }
  if (size === 0) return { text: '', binary: false }

  const shown = await readGitShowCapped(repoPath, spec, MAX_DIFF_BYTES)
  if (!shown.ok && shown.buffer.length === 0) return { text: '', binary: false }
  if (shown.binary) return { text: '', binary: true }
  return { text: capDiffText(shown.buffer.toString('utf8')), binary: false }
}

async function readWorktreeFileCapped(
  repoPath: string,
  path: string
): Promise<{ text: string; binary: boolean }> {
  const file = await readRepoFile(repoPath, path, MAX_DIFF_BYTES)
  if (!file.exists || file.buffer.length === 0) return { text: '', binary: false }
  if (file.buffer.includes(0)) return { text: '', binary: true }
  return { text: capDiffText(file.buffer.toString('utf8')), binary: false }
}

export async function getFileDiff(
  repoPath: string,
  sha: string,
  path: string,
  parentIndex = 0,
  oldPath?: string
): Promise<DiffResult> {
  assertSha(sha)
  resolveRepoPath(repoPath, path)
  if (oldPath) resolveRepoPath(repoPath, oldPath)
  const parentsOut = await gitOk(repoPath, ['rev-list', '--parents', '-n', '1', sha])
  const tokens = parentsOut.trim().split(/\s+/)
  const parents = tokens.slice(1)
  const parent = parents[parentIndex]

  if (!parent) {
    const neu = await readGitBlobText(repoPath, `${sha}:${path}`)
    return {
      path,
      oldText: '',
      newText: neu.binary ? '' : neu.text,
      binary: neu.binary
    }
  }

  const [oldSide, newSide] = await Promise.all([
    readGitBlobText(repoPath, `${parent}:${oldPath || path}`),
    readGitBlobText(repoPath, `${sha}:${path}`)
  ])
  const binary = oldSide.binary || newSide.binary
  return {
    path,
    oldText: binary ? '' : oldSide.text,
    newText: binary ? '' : newSide.text,
    binary
  }
}

async function blobAtHead(repoPath: string, path: string): Promise<{ text: string; binary: boolean }> {
  return readGitBlobText(repoPath, `HEAD:${path}`)
}

async function blobInIndex(repoPath: string, path: string): Promise<{ text: string; binary: boolean }> {
  return readGitBlobText(repoPath, `:${path}`)
}

export async function getWorkingTreeDiff(
  repoPath: string,
  path: string,
  side: 'staged' | 'unstaged'
): Promise<DiffResult> {
  resolveRepoPath(repoPath, path)
  let oldSide = { text: '', binary: false }
  let newSide = { text: '', binary: false }

  if (side === 'staged') {
    ;[oldSide, newSide] = await Promise.all([blobAtHead(repoPath, path), blobInIndex(repoPath, path)])
  } else {
    const indexBlob = await blobInIndex(repoPath, path)
    oldSide = indexBlob.text || indexBlob.binary ? indexBlob : await blobAtHead(repoPath, path)
    newSide = await readWorktreeFileCapped(repoPath, path)
  }

  const binary = oldSide.binary || newSide.binary
  return {
    path,
    oldText: binary ? '' : oldSide.text,
    newText: binary ? '' : newSide.text,
    binary
  }
}
