/** The history of one file across renames, and blame. */
import type { BlameCommit, BlameResult, FileHistoryEntry, FileHistoryPage } from '@shared/ipc'
import { readGitShowCapped, runGit } from '../git-runner'
import { assertSha, readRepoFile, resolveRepoPath } from './guards'
import { parseNameStatusZ } from './history'

export const FILE_HISTORY_PAGE_SIZE = 100
/** Blame only files the editor can show comfortably (same budget as diffs). */
const MAX_BLAME_CHARS = 180_000
const UNCOMMITTED_SHA = '0'.repeat(40)

const FIELDS = ['%H', '%h', '%P', '%s', '%an', '%ae', '%aI']
const FORMAT = `%x1e${FIELDS.join('%x1f')}`

/**
 * Parse `git log --follow -z --name-status --format=%x1e…`: each record is the header, `\0\n`, then
 * `status\0path\0` (`R100\0old\0new\0` for a rename).
 */
export function parseFileHistory(out: string): FileHistoryEntry[] {
  const entries: FileHistoryEntry[] = []
  for (const record of out.split('\x1e')) {
    if (!record) continue
    const split = record.indexOf('\0')
    const header = split < 0 ? record : record.slice(0, split)
    const [sha, shortSha, parents, subject, authorName, authorEmail, authoredAt] = header.split('\x1f')
    if (!sha) continue
    const change = parseNameStatusZ(split < 0 ? '' : record.slice(split + 1).replace(/^\n/, ''))[0]
    entries.push({
      sha,
      shortSha,
      parents: parents ? parents.split(' ') : [],
      subject: subject ?? '',
      body: '',
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authoredAt: authoredAt ?? '',
      refs: [],
      path: change?.path ?? '',
      status: change?.status ?? 'modified',
      ...(change?.oldPath && { oldPath: change.oldPath })
    })
  }
  return entries
}

/** Commits that changed `path`, newest first, following it back through renames. */
export async function getFileHistory(repoPath: string, path: string, skip = 0): Promise<FileHistoryPage> {
  resolveRepoPath(repoPath, path)
  const result = await runGit({
    cwd: repoPath,
    args: [
      '--literal-pathspecs',
      'log',
      '--follow',
      '-z',
      '--name-status',
      `--format=${FORMAT}`,
      `--skip=${Math.max(0, Math.floor(skip))}`,
      // One more than a page tells whether there is another one.
      `--max-count=${FILE_HISTORY_PAGE_SIZE + 1}`,
      '--',
      path
    ]
  })
  // An unborn branch or a path Git has never seen has no history.
  if (result.code !== 0) return { entries: [], hasMore: false }
  const entries = parseFileHistory(result.stdout)
  return { entries: entries.slice(0, FILE_HISTORY_PAGE_SIZE), hasMore: entries.length > FILE_HISTORY_PAGE_SIZE }
}

/** Parse `git blame --porcelain` into the file text and runs of consecutive lines from the same commit. */
export function parseBlamePorcelain(out: string): Omit<BlameResult, 'path' | 'rev'> {
  const commits: Record<string, BlameCommit> = {}
  const groups: BlameResult['groups'] = []
  const lines: string[] = []
  let current: BlameCommit | null = null
  let finalLine = 0
  const raw = out.split('\n')
  for (const line of raw) {
    if (line.startsWith('\t')) {
      lines.push(line.slice(1))
      if (!current) continue
      const last = groups[groups.length - 1]
      if (last && last.sha === current.sha && last.startLine + last.lineCount === finalLine) last.lineCount++
      else groups.push({ sha: current.sha, startLine: finalLine, lineCount: 1 })
      continue
    }
    const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(line)
    if (head) {
      const sha = head[1]
      finalLine = Number(head[2])
      current = commits[sha] ??= {
        sha,
        shortSha: sha.slice(0, 7),
        author: '',
        authoredAt: '',
        summary: '',
        uncommitted: sha === UNCOMMITTED_SHA
      }
      continue
    }
    if (!current) continue
    const space = line.indexOf(' ')
    const key = space < 0 ? line : line.slice(0, space)
    const value = space < 0 ? '' : line.slice(space + 1)
    if (key === 'author') current.author = value
    else if (key === 'author-time') current.authoredAt = new Date(Number(value) * 1000).toISOString()
    else if (key === 'summary') current.summary = value
    else if (key === 'previous') {
      const at = value.indexOf(' ')
      current.previousSha = value.slice(0, at)
      current.previousPath = value.slice(at + 1)
    }
  }
  return { text: lines.join('\n'), groups, commits }
}

/**
 * Who last changed each line of `path`: as committed in `rev`, or in the work tree (uncommitted lines
 * included) when `rev` is omitted.
 */
export async function getBlame(repoPath: string, path: string, rev?: string): Promise<BlameResult> {
  resolveRepoPath(repoPath, path)
  if (rev) assertSha(rev)
  const content = rev
    ? await readGitShowCapped(repoPath, `${rev}:${path}`, MAX_BLAME_CHARS * 4)
    : await readRepoFile(repoPath, path, MAX_BLAME_CHARS * 4)
  if ('exists' in content && !content.exists) throw new Error(`${path} does not exist in the work tree.`)
  if (content.buffer.includes(0)) throw new Error('Blame is not available for binary files.')
  if (content.truncated || content.buffer.toString('utf8').length > MAX_BLAME_CHARS) {
    throw new Error('This file is too large to blame here.')
  }

  const result = await runGit({
    cwd: repoPath,
    args: ['blame', '--porcelain', ...(rev ? [rev] : []), '--', path]
  })
  if (result.code !== 0) {
    if (/no such path .* in HEAD/i.test(result.stderr)) throw new Error(`${path} is not committed yet.`)
    throw new Error(result.stderr.trim() || `git blame failed (${result.code})`)
  }
  return { path, rev: rev ?? null, ...parseBlamePorcelain(result.stdout) }
}
