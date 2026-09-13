import { existsSync, openSync, readSync, closeSync, statSync } from 'fs'
import { basename, join } from 'path'
import type {
  BranchInfo,
  Commit,
  CommitDetail,
  CommitRef,
  ConflictFile,
  DiffResult,
  FileChange,
  HistoryPage,
  HistoryQuery,
  MergeSides,
  Repository,
  StatusEntry
} from '@shared/ipc'
import { decorateCommitsWithColors, layoutCommitGraph } from '@history-core/layout'
import { escapeBasicRegexp, isShaLike, looksLikeAuthorQuery } from './history-query'
import { gitOk, isGitRepo, readGitShowCapped, runGit, runGitDelimited } from './git-runner'

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

const SHA_RE = /^[0-9a-f]{7,40}$/i

/** Resolves HEAD only when it points at a real commit (fails on unborn branches). */
async function resolveHeadSha(repoPath: string): Promise<string | null> {
  const result = await runGit({ cwd: repoPath, args: ['rev-parse', '--verify', 'HEAD'] })
  if (result.code !== 0) return null
  const sha = result.stdout.trim()
  return SHA_RE.test(sha) ? sha : null
}

async function currentBranchName(repoPath: string): Promise<string | null> {
  const sym = await runGit({ cwd: repoPath, args: ['symbolic-ref', '--short', 'HEAD'] })
  if (sym.code === 0 && sym.stdout.trim()) return sym.stdout.trim()
  const abbrev = await runGit({ cwd: repoPath, args: ['rev-parse', '--abbrev-ref', 'HEAD'] })
  const name = abbrev.stdout.trim()
  if (!name || name === 'HEAD') return null
  return name
}

export async function inspectRepository(path: string): Promise<Repository> {
  if (!isGitRepo(path)) {
    throw new Error(`Not a git repository: ${path}`)
  }
  const branch = await currentBranchName(path)
  const remotesOut = await runGit({ cwd: path, args: ['remote', '-v'] })
  const remotes = new Map<string, string>()
  for (const line of remotesOut.stdout.split('\n')) {
    const m = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)/)
    if (m) remotes.set(m[1], m[2])
  }
  return {
    id: path,
    name: basename(path),
    path,
    currentBranch: branch,
    remotes: [...remotes.entries()].map(([name, url]) => ({ name, url }))
  }
}

export async function initRepository(path: string): Promise<Repository> {
  await gitOk(path, ['init'])
  return inspectRepository(path)
}

export async function cloneRepository(url: string, targetDir: string): Promise<Repository> {
  const result = await runGit({
    cwd: process.cwd(),
    args: ['clone', '--', url, targetDir],
    timeoutMs: 10 * 60 * 1000
  })
  if (result.code !== 0) {
    throw new Error(result.stderr || 'Clone failed')
  }
  return inspectRepository(targetDir)
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

export async function getStatus(
  repoPath: string,
  untracked: 'normal' | 'all' = 'normal'
): Promise<StatusEntry[]> {
  const out = await gitOk(repoPath, [
    'status',
    '--porcelain=v2',
    '-z',
    `--untracked-files=${untracked}`
  ])
  // porcelain v2 with -z uses NUL separators; without reliable NUL over string, also support newline fallback
  const chunks = out.includes('\0') ? out.split('\0') : out.split('\n')
  const entries: StatusEntry[] = []

  for (const chunk of chunks) {
    const line = chunk.trim()
    if (!line) continue
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      const parts = line.split(' ')
      const xy = parts[1]
      const path = line.startsWith('2 ')
        ? parts.slice(9).join(' ').split('\t').pop() || ''
        : parts.slice(8).join(' ')
      const indexStatus = xy[0]
      const workTreeStatus = xy[1]
      entries.push({
        path,
        indexStatus,
        workTreeStatus,
        staged: indexStatus !== '.',
        unstaged: workTreeStatus !== '.',
        untracked: false,
        conflicted: false
      })
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ')
      const path = parts.slice(10).join(' ')
      entries.push({
        path,
        indexStatus: 'U',
        workTreeStatus: 'U',
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: true
      })
    } else if (line.startsWith('? ')) {
      entries.push({
        path: line.slice(2),
        indexStatus: '?',
        workTreeStatus: '?',
        staged: false,
        unstaged: true,
        untracked: true,
        conflicted: false
      })
    }
  }
  return entries
}

export async function getBranches(repoPath: string): Promise<BranchInfo[]> {
  const out = await gitOk(repoPath, [
    'for-each-ref',
    '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)',
    'refs/heads'
  ])
  const branches = out
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, head, upstream, track] = line.split('\0')
      let ahead = 0
      let behind = 0
      const aheadMatch = track?.match(/ahead (\d+)/)
      const behindMatch = track?.match(/behind (\d+)/)
      if (aheadMatch) ahead = Number(aheadMatch[1])
      if (behindMatch) behind = Number(behindMatch[1])
      return {
        name,
        current: head === '*',
        upstream: upstream || null,
        ahead,
        behind
      }
    })

  // Unborn branch: no refs/heads yet, but symbolic-ref still names the branch
  if (branches.length === 0) {
    const name = await currentBranchName(repoPath)
    if (name) {
      branches.push({ name, current: true, upstream: null, ahead: 0, behind: 0 })
    }
  }
  return branches
}

export async function stagePaths(repoPath: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await gitOk(repoPath, ['add', '--', ...paths])
}

export async function unstagePaths(repoPath: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  // `git restore --staged` needs a commit; unborn repos (no HEAD) must use rm --cached.
  const head = await resolveHeadSha(repoPath)
  if (head) {
    await gitOk(repoPath, ['restore', '--staged', '--', ...paths])
    return
  }
  await gitOk(repoPath, ['rm', '--cached', '-f', '--', ...paths])
}

export async function discardPaths(repoPath: string, paths: string[]): Promise<void> {
  if (!paths.length) return
  await gitOk(repoPath, ['restore', '--worktree', '--', ...paths])
}

/** Maps raw `git commit` stderr into actionable UI copy. */
export function friendlyCommitError(raw: string, amend = false): string {
  if (/no changes added to commit|nothing added to commit/i.test(raw)) {
    return 'Nothing is staged. Select files under Changes, click Stage or Stage all, then commit.'
  }
  if (/nothing to commit/i.test(raw)) {
    if (amend) return 'Nothing to amend — stage changes or edit the message and try again.'
    return 'Nothing to commit — the working tree is clean.'
  }
  return raw.trim() || 'Commit failed'
}

export async function commit(repoPath: string, message: string, amend = false): Promise<string> {
  const args = ['commit', '-m', message]
  if (amend) args.push('--amend')
  try {
    await gitOk(repoPath, args)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    throw new Error(friendlyCommitError(raw, amend))
  }
  const sha = await resolveHeadSha(repoPath)
  if (!sha) throw new Error('Commit succeeded but HEAD could not be resolved')
  return sha
}

export async function fetchRemote(repoPath: string): Promise<void> {
  await gitOk(repoPath, ['fetch', '--prune', '--all'])
}

export async function pullRemote(repoPath: string): Promise<void> {
  await gitOk(repoPath, ['pull', '--ff-only'])
}

export async function pushRemote(repoPath: string): Promise<void> {
  await gitOk(repoPath, ['push'])
}

export async function checkoutRef(repoPath: string, ref: string): Promise<void> {
  await gitOk(repoPath, ['checkout', ref])
}

export async function createBranch(repoPath: string, name: string, doCheckout = true): Promise<void> {
  if (doCheckout) await gitOk(repoPath, ['checkout', '-b', name])
  else await gitOk(repoPath, ['branch', name])
}

export async function mergeRef(repoPath: string, ref: string): Promise<{ conflicts: string[] }> {
  const result = await runGit({ cwd: repoPath, args: ['merge', '--no-edit', ref] })
  if (result.code === 0) return { conflicts: [] }
  const conflicts = await listConflictFiles(repoPath)
  if (conflicts.length === 0) {
    throw new Error(result.stderr || result.stdout || `git merge failed (${result.code})`)
  }
  return { conflicts: conflicts.map((c) => c.path) }
}

async function rebaseResult(repoPath: string, result: { code: number; stderr: string; stdout: string }): Promise<{ conflicts: string[] }> {
  if (result.code === 0) return { conflicts: [] }
  const conflicts = await listConflictFiles(repoPath)
  if (conflicts.length === 0) {
    throw new Error(result.stderr || result.stdout || `git rebase failed (${result.code})`)
  }
  return { conflicts: conflicts.map((c) => c.path) }
}

export async function rebaseOnto(repoPath: string, upstream: string): Promise<{ conflicts: string[] }> {
  const result = await runGit({ cwd: repoPath, args: ['rebase', upstream] })
  return rebaseResult(repoPath, result)
}

export async function rebaseContinue(repoPath: string): Promise<{ conflicts: string[] }> {
  const result = await runGit({
    cwd: repoPath,
    args: ['-c', 'core.editor=true', 'rebase', '--continue']
  })
  return rebaseResult(repoPath, result)
}

export async function rebaseAbort(repoPath: string): Promise<void> {
  await gitOk(repoPath, ['rebase', '--abort'])
}

export async function isRebaseInProgress(repoPath: string): Promise<boolean> {
  const { existsSync } = await import('fs')
  const mergePath = (await gitOk(repoPath, ['rev-parse', '--git-path', 'rebase-merge'])).trim()
  const applyPath = (await gitOk(repoPath, ['rev-parse', '--git-path', 'rebase-apply'])).trim()
  const { isAbsolute, join } = await import('path')
  const resolve = (p: string): string => (isAbsolute(p) ? p : join(repoPath, p))
  return existsSync(resolve(mergePath)) || existsSync(resolve(applyPath))
}

export async function deleteBranch(repoPath: string, name: string, force = false): Promise<void> {
  const branches = await getBranches(repoPath)
  const current = branches.find((b) => b.current)
  if (current?.name === name) throw new Error('Cannot delete the current branch')
  await gitOk(repoPath, ['branch', force ? '-D' : '-d', name])
}

export async function stashSave(repoPath: string, message?: string): Promise<void> {
  const head = await resolveHeadSha(repoPath)
  if (!head) {
    throw new Error('Cannot stash before the first commit. Commit your files first, then stash.')
  }
  const args = ['stash', 'push', '-u']
  if (message) args.push('-m', message)
  await gitOk(repoPath, args)
}

export async function listStashes(repoPath: string): Promise<
  Array<{ index: number; message: string; reflogSelector: string }>
> {
  const result = await runGit({
    cwd: repoPath,
    args: ['stash', 'list', '--format=%gd%x00%s']
  })
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `git stash list failed (${result.code})`)
  }
  const entries: Array<{ index: number; message: string; reflogSelector: string }> = []
  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue
    const [sel, message = ''] = line.split('\0')
    const m = sel?.match(/stash@\{(\d+)\}/)
    if (!m || !sel) continue
    entries.push({
      index: Number(m[1]),
      message: message.trim() || '(stash)',
      reflogSelector: sel.trim()
    })
  }
  return entries
}

export async function stashApply(repoPath: string, ref = 'stash@{0}'): Promise<void> {
  await gitOk(repoPath, ['stash', 'apply', ref])
}

export async function stashPop(repoPath: string, ref = 'stash@{0}'): Promise<void> {
  await gitOk(repoPath, ['stash', 'pop', ref])
}

export async function stashDrop(repoPath: string, ref = 'stash@{0}'): Promise<void> {
  await gitOk(repoPath, ['stash', 'drop', ref])
}

export async function listConflictFiles(repoPath: string): Promise<ConflictFile[]> {
  const out = await gitOk(repoPath, ['ls-files', '-u'])
  const byPath = new Map<string, ConflictFile>()
  for (const line of out.split('\n')) {
    const m = line.match(/^\S+\s+\S+\s+(\d)\s+(.+)$/)
    if (!m) continue
    const stage = Number(m[1])
    const path = m[2]
    const entry = byPath.get(path) || { path, hasBase: false, hasOurs: false, hasTheirs: false }
    if (stage === 1) entry.hasBase = true
    if (stage === 2) entry.hasOurs = true
    if (stage === 3) entry.hasTheirs = true
    byPath.set(path, entry)
  }
  return [...byPath.values()]
}

export async function getMergeSides(repoPath: string, path: string): Promise<MergeSides> {
  const showStage = async (stage: 1 | 2 | 3): Promise<string> => {
    const r = await runGit({ cwd: repoPath, args: ['show', `:${stage}:${path}`] })
    return r.code === 0 ? r.stdout : ''
  }
  const [base, ours, theirs] = await Promise.all([showStage(1), showStage(2), showStage(3)])
  const working = await runGit({
    cwd: repoPath,
    args: ['show', `:${path}`]
  }).catch(async () => {
    const { readFile } = await import('fs/promises')
    try {
      return { stdout: await readFile(`${repoPath}/${path}`, 'utf8'), stderr: '', code: 0 }
    } catch {
      return { stdout: ours, stderr: '', code: 0 }
    }
  })

  let result = working.stdout
  if (!result) {
    const { mergeSidesToEditable } = await import('@merge-core/conflict')
    result = mergeSidesToEditable(base, ours, theirs).result
  }

  return { path, base, ours, theirs, result }
}

export async function saveMergeResult(repoPath: string, path: string, content: string): Promise<void> {
  const { writeFile, mkdir } = await import('fs/promises')
  const { dirname, join } = await import('path')
  const full = join(repoPath, path)
  await mkdir(dirname(full), { recursive: true })
  await writeFile(full, content, 'utf8')
  await gitOk(repoPath, ['add', '--', path])
}

type IdentitySource = 'local' | 'global' | 'system' | 'unset'

async function readConfigValue(
  repoPath: string,
  key: string,
  scope?: 'local' | 'global' | 'system'
): Promise<string> {
  const args = ['config']
  if (scope) args.push(`--${scope}`)
  args.push('--get', key)
  const result = await runGit({ cwd: repoPath, args })
  if (result.code !== 0) return ''
  return result.stdout.trim()
}

async function resolveIdentitySource(repoPath: string, key: string): Promise<IdentitySource> {
  if (await readConfigValue(repoPath, key, 'local')) return 'local'
  if (await readConfigValue(repoPath, key, 'global')) return 'global'
  if (await readConfigValue(repoPath, key, 'system')) return 'system'
  return 'unset'
}

/** Effective user.name / user.email Git will use for commits in this repo. */
export async function getGitIdentity(repoPath: string): Promise<{
  name: string
  email: string
  nameSource: IdentitySource
  emailSource: IdentitySource
}> {
  const [name, email, nameSource, emailSource] = await Promise.all([
    readConfigValue(repoPath, 'user.name'),
    readConfigValue(repoPath, 'user.email'),
    resolveIdentitySource(repoPath, 'user.name'),
    resolveIdentitySource(repoPath, 'user.email')
  ])
  return { name, email, nameSource, emailSource }
}

export async function setGitIdentity(
  repoPath: string,
  name: string,
  email: string,
  scope: 'local' | 'global' = 'local'
): Promise<{
  name: string
  email: string
  nameSource: IdentitySource
  emailSource: IdentitySource
}> {
  const trimmedName = name.trim()
  const trimmedEmail = email.trim()
  if (!trimmedName) throw new Error('Name is required')
  if (!trimmedEmail) throw new Error('Email is required')
  await gitOk(repoPath, ['config', `--${scope}`, 'user.name', trimmedName])
  await gitOk(repoPath, ['config', `--${scope}`, 'user.email', trimmedEmail])
  return getGitIdentity(repoPath)
}
