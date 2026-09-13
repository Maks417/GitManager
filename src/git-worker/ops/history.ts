import { existsSync, openSync, readSync, closeSync, statSync } from 'fs'
import { join } from 'path'
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
import { escapeBasicRegexp, isShaLike, looksLikeAuthorQuery } from '../history-query'
import { gitOk, readGitShowCapped, runGit, runGitDelimited } from '../git-runner'
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

function parseRefs(decorate: string): CommitRef[] {
  if (!decorate.trim()) return []
  return decorate
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((name) => {
      if (name === 'HEAD' || name.startsWith('HEAD ->')) {
        return { name: name.replace('HEAD -> ', 'HEAD → '), type: 'head' as const }
      }
      if (name.startsWith('tag: ')) {
        return { name: name.slice(5), type: 'tag' as const }
      }
      if (name.includes('/')) {
        return { name, type: 'remote' as const }
      }
      return { name, type: 'local' as const }
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

function appendSearchArgs(args: string[], searchRaw: string | undefined, authorRaw: string | undefined): void {
  if (authorRaw?.trim()) {
    args.push(`--author=${authorRaw.trim()}`)
  }
  const search = searchRaw?.trim()
  if (!search || isShaLike(search)) return

  if (looksLikeAuthorQuery(search) && !authorRaw) {
    args.push(`--author=${search}`)
    return
  }
  args.push(`--grep=${escapeBasicRegexp(search)}`, '--regexp-ignore-case', '--basic-regexp')
}

export async function loadHistory(query: HistoryQuery): Promise<HistoryPage> {
  const headSha = await resolveHeadSha(query.repoPath)
  const limit = query.limit ?? 200

  // Unborn branch / empty repo: no commits yet
  if (!headSha && !query.branch) {
    return { commits: [], graph: [], nextCursor: null, headSha: null }
  }

  const search = query.search?.trim()
  const shaSearch = search && isShaLike(search) ? search : null

  // Exact / prefix SHA lookup via rev-parse (portable); avoids scanning the whole history.
  if (shaSearch && !query.cursor && !query.skip) {
    const resolved = await runGit({
      cwd: query.repoPath,
      args: ['rev-parse', '--verify', `${shaSearch}^{commit}`]
    })
    if (resolved.code === 0) {
      const fullSha = resolved.stdout.trim()
      if (SHA_RE.test(fullSha)) {
        const one = await runGitDelimited({
          cwd: query.repoPath,
          args: ['log', '--decorate=short', `--format=${LIST_LOG_FORMAT}`, '-n', '1', fullSha],
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

  const args = ['log', '--decorate=short', `--format=${LIST_LOG_FORMAT}`, `--max-count=${limit}`]

  if (query.mergesOnly) args.push('--merges')
  appendSearchArgs(args, query.search, query.author)

  if (query.path) {
    if (query.branch) {
      if (!SHA_RE.test(query.branch) && query.branch === 'HEAD' && !headSha) {
        return { commits: [], graph: [], nextCursor: null, headSha: null }
      }
      if (query.skip && query.skip > 0) args.push(`--skip=${query.skip}`)
      args.push(query.branch)
    } else if (query.cursor && SHA_RE.test(query.cursor)) {
      args.push(`${query.cursor}^@`)
    } else {
      args.push('--all')
    }
    args.push('--', query.path)
  } else if (query.branch) {
    if (!SHA_RE.test(query.branch) && query.branch === 'HEAD' && !headSha) {
      return { commits: [], graph: [], nextCursor: null, headSha: null }
    }
    // Branch-filtered paging: portable --skip (works when cursor^@ would not apply).
    if (query.skip && query.skip > 0) args.push(`--skip=${query.skip}`)
    args.push(query.branch)
  } else if (query.cursor && SHA_RE.test(query.cursor)) {
    // --all paging: walk ancestors of the last visible commit (excludes the cursor itself).
    args.push(`${query.cursor}^@`)
  } else {
    args.push('--all')
  }

  const logResult = await runGitDelimited({
    cwd: query.repoPath,
    args,
    delimiter: '\x1e',
    maxRecords: limit + 2
  })
  if (logResult.code !== 0) {
    if (/does not have any commits yet|bad revision|unknown revision|ambiguous argument/i.test(logResult.stderr)) {
      return { commits: [], graph: [], nextCursor: null, headSha }
    }
    throw new Error(logResult.stderr || 'git log failed')
  }

  const commits: Commit[] = []
  for (const record of logResult.records) {
    const trimmed = record.trim()
    if (!trimmed) continue
    const commit = parseListCommitRecord(trimmed)
    if (commit) commits.push(commit)
  }

  const decorated = decorateCommitsWithColors(commits)
  const graph = layoutCommitGraph(decorated)
  const nextCursor = decorated.length >= limit ? decorated[decorated.length - 1]?.sha ?? null : null

  return {
    commits: decorated,
    graph,
    nextCursor,
    headSha
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
    '--format=' + DETAIL_LOG_FORMAT,
    '--name-status',
    '--find-renames',
    '-m',
    '--first-parent',
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

  const nameStatus = await gitOk(repoPath, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-m', '--first-parent', sha])
  const files: FileChange[] = nameStatus
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...paths] = line.split('\t')
      const mapStatus = (s: string): FileChange['status'] => {
        if (s.startsWith('A')) return 'added'
        if (s.startsWith('D')) return 'deleted'
        if (s.startsWith('R')) return 'renamed'
        if (s.startsWith('C')) return 'copied'
        if (s.startsWith('U')) return 'unmerged'
        if (s.startsWith('T')) return 'typechange'
        return 'modified'
      }
      return {
        path: paths[paths.length - 1] || '',
        oldPath: paths.length > 1 ? paths[0] : undefined,
        status: mapStatus(status)
      }
    })

  return { commit: decorateCommitsWithColors([commit])[0], files }
}

function guessLanguage(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    css: 'css',
    html: 'html',
    yml: 'yaml',
    yaml: 'yaml',
    sh: 'shell',
    ps1: 'powershell'
  }
  return ext ? map[ext] : undefined
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

function readWorktreeFileCapped(repoPath: string, path: string): { text: string; binary: boolean } {
  const abs = join(repoPath, path)
  if (!existsSync(abs)) return { text: '', binary: false }
  try {
    const st = statSync(abs)
    if (st.size === 0) return { text: '', binary: false }
    const toRead = Math.min(st.size, MAX_DIFF_BYTES)
    const buf = Buffer.alloc(toRead)
    const fd = openSync(abs, 'r')
    try {
      readSync(fd, buf, 0, toRead, 0)
    } finally {
      closeSync(fd)
    }
    if (buf.includes(0)) return { text: '', binary: true }
    return { text: capDiffText(buf.toString('utf8')), binary: false }
  } catch {
    return { text: '', binary: false }
  }
}

export async function getFileDiff(
  repoPath: string,
  sha: string,
  path: string,
  parentIndex = 0
): Promise<DiffResult> {
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
      binary: neu.binary,
      language: guessLanguage(path)
    }
  }

  const [oldSide, newSide] = await Promise.all([
    readGitBlobText(repoPath, `${parent}:${path}`),
    readGitBlobText(repoPath, `${sha}:${path}`)
  ])
  const binary = oldSide.binary || newSide.binary
  return {
    path,
    oldText: binary ? '' : oldSide.text,
    newText: binary ? '' : newSide.text,
    binary,
    language: guessLanguage(path)
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
  let oldSide = { text: '', binary: false }
  let newSide = { text: '', binary: false }

  if (side === 'staged') {
    ;[oldSide, newSide] = await Promise.all([blobAtHead(repoPath, path), blobInIndex(repoPath, path)])
  } else {
    const indexBlob = await blobInIndex(repoPath, path)
    oldSide = indexBlob.text || indexBlob.binary ? indexBlob : await blobAtHead(repoPath, path)
    newSide = readWorktreeFileCapped(repoPath, path)
  }

  const binary = oldSide.binary || newSide.binary
  return {
    path,
    oldText: binary ? '' : oldSide.text,
    newText: binary ? '' : newSide.text,
    binary,
    language: guessLanguage(path)
  }
}
