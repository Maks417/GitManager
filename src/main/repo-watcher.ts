/**
 * Debounced recursive filesystem watch for the active repository.
 * Uses Node `fs.watch({ recursive: true })` — supported on Windows, macOS and Linux. When the operating
 * system refuses more watches (Linux's inotify limit), it polls a fingerprint of the repository instead.
 */
import { watch, type FSWatcher } from 'fs'
import { join, normalize } from 'path'
import { isPathInside } from '../git-worker/path-utils'

export type RepoWatchKind = 'worktree' | 'git-meta'

export interface RepoWatchEvent {
  repoPath: string
  kind: RepoWatchKind
  /** The work-tree files that changed, when known; absent when anything may have (Git metadata, too many). */
  paths?: string[]
}

/** How the watched repository is kept up to date. */
export interface RepoWatchState {
  repoPath: string
  mode: 'live' | 'polling'
  /** Why changes are polled instead of watched; null while live. */
  reason: string | null
}

type Listener = (event: RepoWatchEvent) => void
type StateListener = (state: RepoWatchState | null) => void

/** Resolves to the subset of repo-relative paths that Git ignores. */
export type IgnoreFilter = (repoPath: string, paths: string[]) => Promise<string[]>

/** Resolves to the folders, of those given, that Git ignores whole and that hold no tracked file. */
export type IgnoredFolderFilter = (repoPath: string, folders: string[]) => Promise<string[]>

/** Where Git keeps a work tree's metadata (`git rev-parse --git-dir --git-common-dir`). */
export interface GitDirs {
  /** HEAD, the index and in-progress merge/rebase state. */
  gitDir: string
  /** Refs; differs from `gitDir` only for linked worktrees. */
  commonDir: string
}

/** `fs.watch`, or a stand-in in tests. */
export type WatchFunction = (
  path: string,
  options: { recursive: boolean },
  listener: (eventType: string, filename: string | Buffer | null) => void
) => FSWatcher

export interface RepoWatchOptions {
  ignoreFilter?: IgnoreFilter
  /** With it, folders found ignored are remembered and their changes dropped as they arrive. */
  ignoredFolderFilter?: IgnoredFolderFilter
  /** Linked worktrees and submodules keep their git directory outside the work tree. */
  gitDirs?: GitDirs
  /**
   * Fingerprint of the repository's status and refs. When the system refuses more watches, it is compared
   * every `pollIntervalMs` instead and a change is reported as `git-meta`. Without it the watch just stops.
   */
  pollFingerprint?: (repoPath: string) => Promise<string>
  /** Polling skips its turn while this returns false (no app window is focused, say). */
  shouldPoll?: () => boolean
  pollIntervalMs?: number
  watchFn?: WatchFunction
}

export interface WatchBatch {
  kind: RepoWatchKind
  /** Work-tree paths changed in this window; empty when `force` is set. */
  paths: string[]
  /** Refresh regardless of ignore rules: Git metadata changed, or the paths are unknown / too many. */
  force: boolean
  /** `performance.now()` of the batch's last change; a refresh started after it already saw all of them. */
  changedAt: number
  /** A `.gitignore` or `.git/info/exclude` changed: folders known to be ignored may no longer be. */
  rulesChanged: boolean
}

/** Where a watch event comes from. Git directory events are mapped onto a normal `.git/` layout. */
export type WatchSource = 'worktree' | 'gitDir' | 'commonRefs' | 'commonDir'

export interface WatchTarget {
  path: string
  recursive: boolean
  source: WatchSource
}

const DEBOUNCE_MS = 400

/** A batch flushes at the latest this long after its first change, even while changes keep coming. */
const MAX_WAIT_MS = 2000

/** How often a repository is checked for changes while the system refuses to watch it. */
export const POLL_INTERVAL_MS = 5000

/** More changed paths than this in one window skips the ignore check and simply refreshes. */
const MAX_FILTERED_PATHS = 200

/**
 * Dependency and cache folders that are effectively never tracked and churn heavily. Build output
 * folders (`dist`, `build`, `out`, `vendor`, …) are often tracked, so Git's ignore rules decide those.
 */
const IGNORED_DIR_RE =
  /(^|\/)(node_modules|\.pnpm-store|bower_components|\.next|\.nuxt|\.turbo|__pycache__|\.venv|venv|\.cache|\.parcel-cache|\.vs|\.gradle)(\/|$)/i

/**
 * Entries of a `.git/` folder that churn during pack/fetch/commit and never affect status or history. The
 * fsmonitor daemon writes cookie files there on every `git status`, the app's own included.
 */
const NOISY_GIT_ENTRY_RE = /^(objects|logs|lfs|hooks|fsmonitor--daemon)(\/|$)|^(COMMIT_EDITMSG|gc\.log|gc\.pid)$/

/** Files whose change can turn ignored folders into watched ones. */
const IGNORE_RULES_RE = /(^|\/)\.gitignore$|^\.git\/info\/exclude$/

/** The same noise inside a submodule's repository (`modules/<name>/…`, where names may contain `/`). */
const NOISY_MODULE_ENTRY_RE = /\/(objects|logs|lfs|hooks)(\/|$)|\/COMMIT_EDITMSG$/

let watchers: FSWatcher[] = []
let watchedPath: string | null = null
let batcher: ChangeBatcher | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let watchState: RepoWatchState | null = null
const listeners = new Set<Listener>()
const stateListeners = new Set<StateListener>()

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
    const inner = rel.slice('.git/'.length)
    if (NOISY_GIT_ENTRY_RE.test(inner)) return null
    // Linked worktrees keep their own HEAD and index here: not this work tree's state.
    if (inner.startsWith('worktrees/')) return null
    // A submodule's repository: its commits and staging change this repository's status, not its history.
    if (inner.startsWith('modules/')) return NOISY_MODULE_ENTRY_RE.test(inner) ? null : 'worktree'
    // Staging changes status but never history.
    if (inner === 'index') return 'worktree'
    // HEAD, refs, MERGE_HEAD, rebase dirs, etc. → refresh status + tip history
    return 'git-meta'
  }

  if (IGNORED_DIR_RE.test(rel)) return null
  // Editor / OS junk
  if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(rel)) return null
  if (/\.(swp|swo|tmp|temp|bak)$/i.test(rel) || /~$/.test(rel)) return null

  return 'worktree'
}

/**
 * Map an event from a git directory outside the work tree onto its path in a normal `.git/` folder,
 * so `classifyWatchPath` serves every repository layout. Null when the event is irrelevant.
 */
export function toVirtualGitPath(
  source: Exclude<WatchSource, 'worktree'>,
  filename: string | null | undefined
): string | null {
  const rel = filename ? toPosixRel(filename) : ''
  if (source === 'gitDir') return rel ? `.git/${rel}` : '.git'
  if (source === 'commonRefs') return rel ? `.git/refs/${rel}` : '.git/refs'
  // The shared directory is watched only for packed refs; its own HEAD belongs to the main worktree.
  return rel === 'packed-refs' ? '.git/packed-refs' : null
}

/** Folders to watch: the work tree, plus its git directories when they live outside it. */
export function planWatchTargets(repoPath: string, gitDirs?: GitDirs): WatchTarget[] {
  const targets: WatchTarget[] = [{ path: repoPath, recursive: true, source: 'worktree' }]
  if (!gitDirs || isPathInside(repoPath, gitDirs.gitDir)) return targets
  // A submodule's whole repository, or a linked worktree's HEAD, index and merge/rebase state.
  targets.push({ path: gitDirs.gitDir, recursive: true, source: 'gitDir' })
  if (!isPathInside(gitDirs.gitDir, gitDirs.commonDir)) {
    // A linked worktree shares refs with its main repository; watch those, not the object store.
    targets.push({ path: join(gitDirs.commonDir, 'refs'), recursive: true, source: 'commonRefs' })
    targets.push({ path: gitDirs.commonDir, recursive: false, source: 'commonDir' })
  }
  return targets
}

/** ENOSPC is Linux's inotify watch limit; EMFILE, too many open files. Either way more watches fail too. */
export function isWatchLimitError(err: unknown): boolean {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : ''
  if (code === 'ENOSPC' || code === 'EMFILE') return true
  const message = err instanceof Error ? err.message : String(err ?? '')
  return /\b(ENOSPC|EMFILE)\b|limit for number of file watchers|too many open files/i.test(message)
}

/** What to tell the user when watching fell back to polling, including how to lift the limit on Linux. */
export function watchLimitReason(err: unknown, platform: NodeJS.Platform = process.platform): string {
  const seconds = Math.round(POLL_INTERVAL_MS / 1000)
  const detail = `${err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : ''} ${
    err instanceof Error ? err.message : String(err ?? '')
  }`
  if (platform === 'linux' && /ENOSPC|file watchers/i.test(detail)) {
    return (
      `This computer's limit on watched folders (fs.inotify.max_user_watches) is used up, so changes are ` +
      `checked every ${seconds} seconds instead of right away. To get instant updates back, raise the limit: ` +
      `echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/60-git-manager.conf && sudo sysctl --system`
    )
  }
  return (
    `The system would not watch more files, so changes are checked every ${seconds} seconds instead of right ` +
    `away. Closing other programs that watch many files may bring instant updates back.`
  )
}

export interface ChangeBatcher {
  add(filename: string | null | undefined): void
  cancel(): void
}

export interface ChangeBatcherOptions {
  debounceMs?: number
  maxWaitMs?: number
  /**
   * Work-tree paths to drop as they arrive (inside folders known to be ignored), so a folder a build or an IDE
   * keeps writing to neither refreshes nor keeps pushing the batch back.
   */
  skip?: (rel: string) => boolean
}

/**
 * Collects fs.watch events until `debounceMs` pass without one, or `maxWaitMs` after the first, and flushes
 * them as one batch.
 */
export function createChangeBatcher(
  onFlush: (batch: WatchBatch) => void,
  options: ChangeBatcherOptions | number = {}
): ChangeBatcher {
  const { debounceMs = DEBOUNCE_MS, maxWaitMs = MAX_WAIT_MS, skip } =
    typeof options === 'number' ? { debounceMs: options } : options
  let timer: ReturnType<typeof setTimeout> | null = null
  let firstAt = 0
  let changedAt = 0
  let kind: RepoWatchKind | null = null
  let force = false
  let rulesChanged = false
  const paths = new Set<string>()

  const reset = (): void => {
    kind = null
    force = false
    rulesChanged = false
    paths.clear()
  }

  const flush = (): void => {
    timer = null
    const batch: WatchBatch = { kind: kind ?? 'worktree', paths: force ? [] : [...paths], force, changedAt, rulesChanged }
    reset()
    onFlush(batch)
  }

  return {
    add(filename) {
      const next = classifyWatchPath(filename)
      if (!next) return
      const rel = filename ? toPosixRel(filename) : ''
      const inWorkTree = Boolean(rel) && rel !== '.' && rel !== '.git' && !rel.startsWith('.git/')
      if (inWorkTree && skip?.(rel)) return
      kind = kind === 'git-meta' || next === 'git-meta' ? 'git-meta' : 'worktree'
      if (IGNORE_RULES_RE.test(rel)) rulesChanged = true
      if (!inWorkTree || paths.size >= MAX_FILTERED_PATHS) {
        force = true
      } else {
        paths.add(rel)
      }
      const now = performance.now()
      if (!timer) firstAt = now
      changedAt = now
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, Math.max(0, Math.min(debounceMs, firstAt + maxWaitMs - now)))
    },
    cancel() {
      if (timer) clearTimeout(timer)
      timer = null
      reset()
    }
  }
}

/** Folders Git ignores that hold no tracked file, learnt from earlier batches: nothing inside them matters. */
export interface IgnoredFolderCache {
  covers(rel: string): boolean
  add(folders: string[]): void
  clear(): void
  /** Folders of these ignored paths worth asking about, up to three levels deep and not known yet. */
  candidates(ignoredPaths: string[]): string[]
}

export function createIgnoredFolderCache(): IgnoredFolderCache {
  const folders = new Set<string>()
  const ancestors = (rel: string, depth = 3): string[] => {
    const parts = rel.split('/').slice(0, -1)
    const out: string[] = []
    for (let i = 1; i <= Math.min(depth, parts.length); i++) out.push(parts.slice(0, i).join('/'))
    return out
  }
  const lower = (rel: string): string => rel.toLowerCase()
  return {
    covers: (rel) => ancestors(lower(rel), Number.MAX_SAFE_INTEGER).some((folder) => folders.has(folder)),
    add(found) {
      for (const folder of found) folders.add(lower(folder))
    },
    clear: () => folders.clear(),
    candidates(ignoredPaths) {
      const out = new Set<string>()
      for (const rel of ignoredPaths) {
        if (ancestors(lower(rel), Number.MAX_SAFE_INTEGER).some((folder) => folders.has(folder))) continue
        for (const folder of ancestors(rel)) out.add(folder)
      }
      return [...out]
    }
  }
}

/** `performance.now()` when the newest refresh of each scope started that has finished, for the watched repo. */
let coveredAt = { meta: -Infinity, status: -Infinity }

/**
 * A refresh of the watched repository finished; it read Git's state after `startedAt`. A batch whose changes
 * all came before that start (the files an app action of its own wrote, say) needs no refresh of its own.
 */
export function noteRepoRefreshed(repoPath: string, scope: 'meta' | 'status', startedAt: number): void {
  if (!watchedPath || normalize(repoPath).toLowerCase() !== watchedPath.toLowerCase()) return
  if (scope === 'meta') coveredAt = { meta: Math.max(coveredAt.meta, startedAt), status: Math.max(coveredAt.status, startedAt) }
  else coveredAt = { ...coveredAt, status: Math.max(coveredAt.status, startedAt) }
}

/** Whether a refresh that already finished saw every change in this batch. */
export function batchCovered(batch: Pick<WatchBatch, 'kind' | 'changedAt'>, covered = coveredAt): boolean {
  return batch.changedAt < (batch.kind === 'git-meta' ? covered.meta : covered.status)
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

function setWatchState(next: RepoWatchState | null): void {
  if (
    watchState?.repoPath === next?.repoPath &&
    watchState?.mode === next?.mode &&
    watchState?.reason === next?.reason
  ) {
    return
  }
  watchState = next
  for (const listener of stateListeners) {
    try {
      listener(next)
    } catch {
      /* ignore listener errors */
    }
  }
}

export function subscribeRepoWatch(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function subscribeRepoWatchState(listener: StateListener): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

export function getRepoWatchState(): RepoWatchState | null {
  return watchState
}

export function getWatchedRepoPath(): string | null {
  return watchedPath
}

function closeWatcher(fsWatcher: FSWatcher): void {
  try {
    fsWatcher.close()
  } catch {
    /* ignore */
  }
}

export function stopRepoWatch(): void {
  batcher?.cancel()
  batcher = null
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
  for (const fsWatcher of watchers) closeWatcher(fsWatcher)
  watchers = []
  watchedPath = null
  setWatchState(null)
}

/** Compares the repository's fingerprint on a timer and reports each change as `git-meta`. */
function startPolling(repoPath: string, options: RepoWatchOptions, reason: string): void {
  const fingerprint = options.pollFingerprint
  if (!fingerprint) return
  let last: string | null = null
  let checking = false
  const check = async (): Promise<void> => {
    if (checking || watchedPath !== repoPath || options.shouldPoll?.() === false) return
    checking = true
    try {
      const next = await fingerprint(repoPath)
      if (watchedPath !== repoPath) return
      if (last !== null && next !== last) emit({ repoPath, kind: 'git-meta' })
      last = next
    } catch {
      // Tried again next time: the folder may be mid-change, or Git busy.
    } finally {
      checking = false
    }
  }
  pollTimer = setInterval(() => void check(), options.pollIntervalMs ?? POLL_INTERVAL_MS)
  void check()
  setWatchState({ repoPath, mode: 'polling', reason })
}

/**
 * Start watching `repoPath` (replaces any previous watch). No-op when the path is unchanged.
 * With `ignoreFilter`, a batch of work-tree changes that Git entirely ignores emits nothing.
 */
export function startRepoWatch(repoPath: string, options: RepoWatchOptions = {}): void {
  const normalized = normalize(repoPath)
  if (watchedPath === normalized && (watchers.length > 0 || pollTimer)) return

  stopRepoWatch()
  watchedPath = normalized
  coveredAt = { meta: -Infinity, status: -Infinity }
  const { ignoreFilter, ignoredFolderFilter } = options
  const watchFn: WatchFunction = options.watchFn ?? ((path, watchOptions, listener) => watch(path, watchOptions, listener))
  const ignoredFolders = createIgnoredFolderCache()

  /** Remembers the folders of these ignored paths that are ignored whole, off the refresh path. */
  const learnFolders = (ignored: string[]): void => {
    const candidates = ignoredFolderFilter ? ignoredFolders.candidates(ignored) : []
    if (!ignoredFolderFilter || candidates.length === 0) return
    void ignoredFolderFilter(normalized, candidates).then(
      (found) => {
        if (watchedPath === normalized) ignoredFolders.add(found)
      },
      () => undefined
    )
  }

  batcher = createChangeBatcher(
    (batch) => {
      if (watchedPath !== normalized) return
      if (batch.rulesChanged) ignoredFolders.clear()
      // A refresh that started after these changes (after an app action, say) already shows them.
      if (batchCovered(batch)) return
      const notify = (): void => {
        if (watchedPath !== normalized) return
        emit({ repoPath: normalized, kind: batch.kind, ...(batch.force ? {} : { paths: batch.paths }) })
      }
      if (batch.force || !ignoreFilter) {
        notify()
        return
      }
      void ignoreFilter(normalized, batch.paths).then(
        (ignored) => {
          if (ignored.length < batch.paths.length) notify()
          learnFolders(ignored)
        },
        notify
      )
    },
    { skip: (rel) => ignoredFolders.covers(rel) }
  )

  /** On a watch limit, drops every watch of this repository for polling; false for other failures. */
  const pollInstead = (err: unknown): boolean => {
    if (!isWatchLimitError(err) || !options.pollFingerprint) return false
    for (const fsWatcher of watchers) closeWatcher(fsWatcher)
    watchers = []
    batcher?.cancel()
    if (watchedPath === normalized && !pollTimer) startPolling(normalized, options, watchLimitReason(err))
    return true
  }

  for (const target of planWatchTargets(normalized, options.gitDirs)) {
    let fsWatcher: FSWatcher
    try {
      fsWatcher = watchFn(target.path, { recursive: target.recursive }, (_eventType, filename) => {
        const name = typeof filename === 'string' ? filename : filename != null ? String(filename) : null
        if (target.source === 'worktree') {
          // The `.git` folder itself "changed" whenever an entry in it did (Windows), also a lock file of
          // another tool's `git status`; real changes arrive under their own names.
          if (name === '.git') return
          batcher?.add(name)
          return
        }
        const virtual = toVirtualGitPath(target.source, name)
        if (virtual) batcher?.add(virtual)
      })
    } catch (err) {
      if (pollInstead(err)) return
      // Without the work tree there is nothing to watch; a missing git directory only means fewer events.
      if (target.source === 'worktree') {
        stopRepoWatch()
        return
      }
      continue
    }
    fsWatcher.on('error', (err) => {
      if (!watchers.includes(fsWatcher)) return
      if (pollInstead(err)) return
      if (target.source === 'worktree') {
        // Watcher can fail if the folder is deleted; clear so a later start can retry.
        stopRepoWatch()
        return
      }
      closeWatcher(fsWatcher)
      watchers = watchers.filter((w) => w !== fsWatcher)
    })
    watchers.push(fsWatcher)
  }
  setWatchState({ repoPath: normalized, mode: 'live', reason: null })
}
