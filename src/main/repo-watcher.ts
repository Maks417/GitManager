/**
 * Debounced recursive filesystem watch for the active repository.
 * Uses Node `fs.watch({ recursive: true })` — supported on Windows and macOS.
 */
import { watch, type FSWatcher } from 'fs'
import { normalize } from 'path'

export type RepoWatchKind = 'worktree' | 'git-meta'

export interface RepoWatchEvent {
  repoPath: string
  kind: RepoWatchKind
}

type Listener = (event: RepoWatchEvent) => void

const DEBOUNCE_MS = 400

/** Directories that churn heavily and should not trigger status refreshes. */
const IGNORED_DIR_RE =
  /(^|\/)(node_modules|\.pnpm|bower_components|dist|build|out|\.next|\.nuxt|\.turbo|target|vendor|\.venv|venv|__pycache__|\.cache|\.parcel-cache)(\/|$)/i

let watcher: FSWatcher | null = null
let watchedPath: string | null = null
let debounceTimer: ReturnType<typeof setTimeout> | null = null
let pendingKind: RepoWatchKind | null = null
const listeners = new Set<Listener>()

function toPosixRel(filename: string): string {
  return filename.replace(/\\/g, '/')
}

/**
 * Classify a relative path from fs.watch. Returns null when the event should be ignored.
 */
export function classifyWatchPath(filename: string | null | undefined): RepoWatchKind | null {
  if (!filename) return 'worktree'
  const rel = toPosixRel(filename)
  if (!rel || rel === '.') return 'worktree'

  if (rel === '.git' || rel.startsWith('.git/')) {
    // Object DB and reflogs are extremely noisy during pack/fetch/commit.
    if (
      rel.startsWith('.git/objects') ||
      rel.startsWith('.git/logs') ||
      rel.startsWith('.git/lfs') ||
      rel.startsWith('.git/hooks') ||
      rel === '.git/COMMIT_EDITMSG' ||
      rel.startsWith('.git/COMMIT_EDITMSG')
    ) {
      return null
    }
    // index, HEAD, refs, MERGE_HEAD, rebase dirs, etc. → refresh status + tip history
    return 'git-meta'
  }

  if (IGNORED_DIR_RE.test(rel)) return null
  // Editor / OS junk
  if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(rel)) return null
  if (/\.(swp|swo|tmp|temp|bak)$/i.test(rel) || /~$/.test(rel)) return null

  return 'worktree'
}

function emit(event: RepoWatchEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch {
      /* ignore listener errors */
    }
  }
}

function schedule(kind: RepoWatchKind): void {
  if (pendingKind === 'git-meta' || kind === 'git-meta') pendingKind = 'git-meta'
  else pendingKind = 'worktree'

  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    debounceTimer = null
    const k = pendingKind
    pendingKind = null
    if (!watchedPath || !k) return
    emit({ repoPath: watchedPath, kind: k })
  }, DEBOUNCE_MS)
}

export function subscribeRepoWatch(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWatchedRepoPath(): string | null {
  return watchedPath
}

export function stopRepoWatch(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  pendingKind = null
  if (watcher) {
    try {
      watcher.close()
    } catch {
      /* ignore */
    }
    watcher = null
  }
  watchedPath = null
}

/**
 * Start watching `repoPath` (replaces any previous watch).
 * No-op when path is unchanged.
 */
export function startRepoWatch(repoPath: string): void {
  const normalized = normalize(repoPath)
  if (watchedPath && normalize(watchedPath) === normalized && watcher) return

  stopRepoWatch()
  watchedPath = normalized

  try {
    watcher = watch(normalized, { recursive: true }, (_eventType, filename) => {
      const name =
        typeof filename === 'string' ? filename : filename != null ? String(filename) : null
      const kind = classifyWatchPath(name)
      if (!kind) return
      schedule(kind)
    })
    watcher.on('error', () => {
      // Watcher can fail if the folder is deleted; clear so a later start can retry.
      stopRepoWatch()
    })
  } catch {
    watchedPath = null
    watcher = null
  }
}
