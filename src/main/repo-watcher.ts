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

/** Resolves to the subset of repo-relative paths that Git ignores. */
export type IgnoreFilter = (repoPath: string, paths: string[]) => Promise<string[]>

export interface WatchBatch {
  kind: RepoWatchKind
  /** Work-tree paths changed in this window; empty when `force` is set. */
  paths: string[]
  /** Refresh regardless of ignore rules: Git metadata changed, or the paths are unknown / too many. */
  force: boolean
}

const DEBOUNCE_MS = 400

/** More changed paths than this in one window skips the ignore check and simply refreshes. */
const MAX_FILTERED_PATHS = 200

/**
 * Dependency and cache folders that are effectively never tracked and churn heavily. Build output
 * folders (`dist`, `build`, `out`, `vendor`, …) are often tracked, so Git's ignore rules decide those.
 */
const IGNORED_DIR_RE =
  /(^|\/)(node_modules|\.pnpm-store|bower_components|\.next|\.nuxt|\.turbo|__pycache__|\.venv|venv|\.cache|\.parcel-cache)(\/|$)/i

let watcher: FSWatcher | null = null
let watchedPath: string | null = null
let batcher: ChangeBatcher | null = null
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
    // Lock files are transient; the real change follows when they are renamed into place.
    if (rel.endsWith('.lock')) return null
    // Object DB and reflogs are extremely noisy during pack/fetch/commit.
    if (
      rel.startsWith('.git/objects') ||
      rel.startsWith('.git/logs') ||
      rel.startsWith('.git/lfs') ||
      rel.startsWith('.git/hooks') ||
      rel.startsWith('.git/COMMIT_EDITMSG')
    ) {
      return null
    }
    // Staging changes status but never history.
    if (rel === '.git/index') return 'worktree'
    // HEAD, refs, MERGE_HEAD, rebase dirs, etc. → refresh status + tip history
    return 'git-meta'
  }

  if (IGNORED_DIR_RE.test(rel)) return null
  // Editor / OS junk
  if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(rel)) return null
  if (/\.(swp|swo|tmp|temp|bak)$/i.test(rel) || /~$/.test(rel)) return null

  return 'worktree'
}

export interface ChangeBatcher {
  add(filename: string | null | undefined): void
  cancel(): void
}

/** Collects fs.watch events for `debounceMs` and flushes them as one batch. */
export function createChangeBatcher(onFlush: (batch: WatchBatch) => void, debounceMs = DEBOUNCE_MS): ChangeBatcher {
  let timer: ReturnType<typeof setTimeout> | null = null
  let kind: RepoWatchKind | null = null
  let force = false
  const paths = new Set<string>()

  const reset = (): void => {
    kind = null
    force = false
    paths.clear()
  }

  return {
    add(filename) {
      const next = classifyWatchPath(filename)
      if (!next) return
      kind = kind === 'git-meta' || next === 'git-meta' ? 'git-meta' : 'worktree'
      const rel = filename ? toPosixRel(filename) : ''
      if (!rel || rel === '.' || rel === '.git' || rel.startsWith('.git/') || paths.size >= MAX_FILTERED_PATHS) {
        force = true
      } else {
        paths.add(rel)
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const batch: WatchBatch = { kind: kind ?? 'worktree', paths: force ? [] : [...paths], force }
        reset()
        onFlush(batch)
      }, debounceMs)
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      reset()
    }
  }
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

export function subscribeRepoWatch(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getWatchedRepoPath(): string | null {
  return watchedPath
}

export function stopRepoWatch(): void {
  batcher?.cancel()
  batcher = null
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
 * Start watching `repoPath` (replaces any previous watch). No-op when the path is unchanged.
 * With `ignoreFilter`, a batch of work-tree changes that Git entirely ignores emits nothing.
 */
export function startRepoWatch(repoPath: string, ignoreFilter?: IgnoreFilter): void {
  const normalized = normalize(repoPath)
  if (watchedPath && normalize(watchedPath) === normalized && watcher) return

  stopRepoWatch()
  watchedPath = normalized

  batcher = createChangeBatcher((batch) => {
    if (watchedPath !== normalized) return
    const notify = (): void => {
      if (watchedPath === normalized) emit({ repoPath: normalized, kind: batch.kind })
    }
    if (batch.force || !ignoreFilter) {
      notify()
      return
    }
    void ignoreFilter(normalized, batch.paths).then(
      (ignored) => {
        if (ignored.length < batch.paths.length) notify()
      },
      notify
    )
  })

  try {
    watcher = watch(normalized, { recursive: true }, (_eventType, filename) => {
      batcher?.add(typeof filename === 'string' ? filename : filename != null ? String(filename) : null)
    })
    watcher.on('error', () => {
      // Watcher can fail if the folder is deleted; clear so a later start can retry.
      stopRepoWatch()
    })
  } catch {
    stopRepoWatch()
  }
}
