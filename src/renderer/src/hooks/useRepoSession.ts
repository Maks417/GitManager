import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type {
  AppPreferences,
  BranchInfo,
  GitIdentity,
  GitProbeResult,
  ProviderAccount,
  RemoteBranchInfo,
  RepoRemoveOptions,
  Repository,
  RepoSessionSnapshot,
  RepoWatchEvent,
  RepoWatchState,
  SequencerOp,
  StatusEntry,
  UpdateStatus
} from '@shared/ipc'
import { toErrorMessage } from '../lib/errors'
import { sameRepoPath } from '../lib/paths'
import { runWithBusy } from '../lib/useAsyncAction'
import { createLatestGate } from '../logic/latest-gate'
import { keepIfSame } from '../logic/same-data'
import type { StartupStatus } from '../logic/startup-view'
import {
  createRepoRefreshScheduler,
  maxScope,
  shouldRefreshHistoryTip,
  type RepoRefreshScope
} from '../logic/repo-refresh-scheduler'
import type { HistoryRefreshMode, Selection, ViewMode } from './selection'
import { useLatestRef } from './useLatestRef'

export type HistoryFns = {
  loadHistory: (repo: Repository, searchText?: string) => Promise<unknown>
  refreshHistoryTip: (repo: Repository) => Promise<void>
}

type UseRepoSessionArgs = {
  setError: (msg: string | null) => void
  hydrateFromPrefs: (p: AppPreferences) => void
  setAccounts: React.Dispatch<React.SetStateAction<ProviderAccount[]>>
  setUpdateStatus: React.Dispatch<React.SetStateAction<UpdateStatus | null>>
  historyFnsRef: React.MutableRefObject<HistoryFns | null>
  setSelection: React.Dispatch<React.SetStateAction<Selection | null>>
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>
  liveStatusWatch: boolean | undefined
  onConflictsDetected: () => void
}

function sameRemotes(a: Repository['remotes'], b: Repository['remotes']): boolean {
  return (
    a.length === b.length &&
    a.every((remote, index) => remote.name === b[index]?.name && remote.url === b[index]?.url)
  )
}

function sameRepository(a: Repository, b: Repository): boolean {
  return (
    a.id === b.id &&
    a.path === b.path &&
    a.currentBranch === b.currentBranch &&
    a.name === b.name &&
    (a.worktreeOf ?? null) === (b.worktreeOf ?? null) &&
    sameRemotes(a.remotes, b.remotes)
  )
}

export function useRepoSession({
  setError,
  hydrateFromPrefs,
  setAccounts,
  setUpdateStatus,
  historyFnsRef,
  setSelection,
  setViewMode,
  liveStatusWatch,
  onConflictsDetected
}: UseRepoSessionArgs): {
  repos: Repository[]
  startupStatus: StartupStatus
  retryStartup: () => void
  activeRepo: Repository | null
  setActiveRepo: React.Dispatch<React.SetStateAction<Repository | null>>
  /** The active repository at call time, for actions that outlive the render they were created in. */
  getActiveRepo: () => Repository | null
  branches: BranchInfo[]
  remoteBranches: RemoteBranchInfo[]
  setRemoteBranches: React.Dispatch<React.SetStateAction<RemoteBranchInfo[]>>
  status: StatusEntry[]
  /** Grows with every status refresh, also one that found the same status (a file edited again). */
  statusRevision: number
  identity: GitIdentity | null
  setIdentity: React.Dispatch<React.SetStateAction<GitIdentity | null>>
  rebaseInProgress: boolean
  /** A cherry-pick or revert that stopped part way. */
  sequencerOp: SequencerOp | null
  mergeInProgress: boolean
  gitMissing: boolean
  currentBranch: BranchInfo | null
  localBranchNames: Set<string>
  /** Why the active repository's changes are polled instead of watched; null while watched live. */
  watchNotice: string | null
  repoPendingRemove: Repository | null
  setRepoPendingRemove: React.Dispatch<React.SetStateAction<Repository | null>>
  repoRemoveBusy: boolean
  repoRemoveError: string | null
  setRepoRemoveError: React.Dispatch<React.SetStateAction<string | null>>
  /** What the removal dialog still has to say once the repository is off the list. */
  repoRemoveWarning: string | null
  setRepoRemoveWarning: React.Dispatch<React.SetStateAction<string | null>>
  refreshRepos: (opts?: { activateFirst?: boolean }) => Promise<void>
  refreshRepoMeta: (repo: Repository) => Promise<Repository>
  afterGitMutation: (opts?: { history?: HistoryRefreshMode }) => Promise<void>
  removeRepoFromList: (repo: Repository, options?: RepoRemoveOptions) => Promise<void>
} {
  const [repos, setRepos] = useState<Repository[]>([])
  const [startupStatus, setStartupStatus] = useState<StartupStatus>('loading')
  const [bootAttempt, setBootAttempt] = useState(0)
  const [activeRepo, setActiveRepo] = useState<Repository | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [remoteBranches, setRemoteBranches] = useState<RemoteBranchInfo[]>([])
  const [status, setStatus] = useState<StatusEntry[]>([])
  const [statusRevision, setStatusRevision] = useState(0)
  const [identity, setIdentity] = useState<GitIdentity | null>(null)
  const [rebaseInProgress, setRebaseInProgress] = useState(false)
  const [sequencerOp, setSequencerOp] = useState<SequencerOp | null>(null)
  const [mergeInProgress, setMergeInProgress] = useState(false)
  const [gitMissing, setGitMissing] = useState(false)
  const [watchState, setWatchState] = useState<RepoWatchState | null>(null)
  const [repoPendingRemove, setRepoPendingRemove] = useState<Repository | null>(null)
  const [repoRemoveBusy, setRepoRemoveBusy] = useState(false)
  const [repoRemoveError, setRepoRemoveError] = useState<string | null>(null)
  const [repoRemoveWarning, setRepoRemoveWarning] = useState<string | null>(null)
  const activeRepoRef = useLatestRef(activeRepo)
  const reposRef = useLatestRef(repos)
  const onConflictsDetectedRef = useLatestRef(onConflictsDetected)
  const conflictStateRef = useRef<{ path: string; conflicted: boolean } | null>(null)
  const historyFingerprintRef = useRef<string | null>(null)
  const [watchScheduler] = useState(createRepoRefreshScheduler)
  // Refreshes overlap (watcher events, Git actions) and finish in any order. Only the newest may apply:
  // an older response would put back branches or status from before the latest change.
  const [metaGate] = useState(createLatestGate)
  const [statusGate] = useState(createLatestGate)

  const currentBranch = useMemo(() => branches.find((b) => b.current) ?? null, [branches])
  const localBranchNames = useMemo(() => new Set(branches.map((b) => b.name)), [branches])
  const watchNotice =
    watchState?.mode === 'polling' && sameRepoPath(watchState.repoPath, activeRepo?.path) ? watchState.reason : null

  const getActiveRepo = useCallback((): Repository | null => activeRepoRef.current, [activeRepoRef])
  const retryStartup = useCallback((): void => {
    setError(null)
    setStartupStatus('loading')
    setBootAttempt((attempt) => attempt + 1)
  }, [setError])

  const refreshRepos = useCallback(
    async (opts?: { activateFirst?: boolean }) => {
      const list = await window.gitManager.repo.list()
      setRepos(list)
      const activateFirst = opts?.activateFirst !== false
      // Use ref so this callback stays stable — depending on `activeRepo` recreated the
      // boot effect and re-listed repos forever (inspect → watch → setActiveRepo → …).
      if (activateFirst && !activeRepoRef.current && list[0]) setActiveRepo(list[0])
    },
    [activeRepoRef]
  )

  // Open the merge editor when the repository enters a conflicted state, not on every refresh,
  // so it can stay closed while conflicts are resolved elsewhere.
  const noteConflicts = useCallback(
    (repoPath: string, entries: StatusEntry[]): void => {
      const conflicted = entries.some((e) => e.conflicted)
      const previous = conflictStateRef.current
      const wasConflicted = Boolean(previous?.conflicted && sameRepoPath(previous.path, repoPath))
      conflictStateRef.current = { path: repoPath, conflicted }
      if (conflicted && !wasConflicted) onConflictsDetectedRef.current()
    },
    [onConflictsDetectedRef]
  )

  const applyRepository = useCallback((repo: Repository, fresh: Repository): void => {
    setActiveRepo((prev) => {
      if (!prev || !sameRepoPath(prev.path, repo.path)) return prev
      return sameRepository(prev, fresh) ? prev : fresh
    })
    setRepos((prev) => {
      // A refresh that changed nothing keeps the list, so the sidebar does not render again.
      if (prev.some((r) => r.id === fresh.id && sameRepository(r, fresh))) return prev
      let replaced = false
      const next = prev.map((r) => {
        if (r.id === fresh.id || r.id === repo.id || r.path.toLowerCase() === fresh.path.toLowerCase()) {
          replaced = true
          return fresh
        }
        return r
      })
      const seen = new Set<string>()
      const deduped = next.filter((r) => {
        const key = r.path.toLowerCase()
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      return replaced ? deduped : [fresh, ...deduped]
    })
  }, [])

  const applySnapshot = useCallback(
    (
      repo: Repository,
      snapshot: RepoSessionSnapshot,
      opts: { metaToken?: number; statusToken: number; applyMeta: boolean }
    ): Repository => {
      if (!sameRepoPath(activeRepoRef.current?.path, repo.path)) return repo
      if (statusGate.isLatest(opts.statusToken)) {
        setStatus(keepIfSame(snapshot.status))
        setStatusRevision((n) => n + 1)
        noteConflicts(repo.path, snapshot.status)
      }
      if (!opts.applyMeta) return repo
      if (opts.metaToken !== undefined && !metaGate.isLatest(opts.metaToken)) return repo
      // Refreshes that changed nothing keep the previous values, so nothing that reads them renders again.
      if (snapshot.branches) setBranches(keepIfSame(snapshot.branches))
      if (snapshot.remoteBranches) setRemoteBranches(keepIfSame(snapshot.remoteBranches))
      if (snapshot.identity) setIdentity(keepIfSame<GitIdentity | null>(snapshot.identity))
      if (snapshot.rebaseInProgress !== undefined) setRebaseInProgress(snapshot.rebaseInProgress)
      if (snapshot.mergeInProgress !== undefined) setMergeInProgress(snapshot.mergeInProgress)
      if (snapshot.sequencerOp !== undefined) setSequencerOp(snapshot.sequencerOp)
      if (snapshot.historyFingerprint) historyFingerprintRef.current = snapshot.historyFingerprint
      const fresh = snapshot.repository ?? repo
      if (snapshot.repository) applyRepository(repo, fresh)
      return fresh
    },
    [activeRepoRef, applyRepository, metaGate, noteConflicts, statusGate]
  )

  /** Work-tree edits only change status; branches, identity and history stay as they are. */
  const refreshStatus = useCallback(
    async (repo: Repository): Promise<void> => {
      const token = statusGate.begin()
      const snapshot = await window.gitManager.repo.refresh({
        repoPath: repo.path,
        scope: 'status',
        persistRepository: false,
        baseRepository: repo
      })
      applySnapshot(repo, snapshot, { statusToken: token, applyMeta: false })
    },
    [applySnapshot, statusGate]
  )

  const refreshRepoMeta = useCallback(
    async (repo: Repository, opts?: { persist?: boolean }): Promise<Repository> => {
      const metaToken = metaGate.begin()
      const statusToken = statusGate.begin()
      const snapshot = await window.gitManager.repo.refresh({
        repoPath: repo.path,
        scope: 'meta',
        persistRepository: opts?.persist !== false,
        baseRepository: repo
      })
      // The user may have switched repositories while these requests ran. Never apply another
      // repository's branches or status, and never switch the app back to it.
      if (!sameRepoPath(activeRepoRef.current?.path, repo.path) || !metaGate.isLatest(metaToken)) {
        return snapshot.repository ?? repo
      }
      return applySnapshot(repo, snapshot, { metaToken, statusToken, applyMeta: true })
    },
    [activeRepoRef, applySnapshot, metaGate, statusGate]
  )

  const afterGitMutation = useCallback(
    async (opts?: { history?: HistoryRefreshMode }): Promise<void> => {
      const repo = activeRepoRef.current
      if (!repo) return
      const previousFingerprint = historyFingerprintRef.current
      // History uses the refreshed repository so a "current branch" filter follows a checkout.
      const fresh = await refreshRepoMeta(repo)
      const mode = opts?.history ?? 'tip'
      const fns = historyFnsRef.current
      if (!fns || !sameRepoPath(activeRepoRef.current?.path, repo.path)) return
      if (mode === 'full') await fns.loadHistory(fresh)
      // Staging, discarding or stashing leaves HEAD and refs alone: no history to reload. When a refresh
      // that started meanwhile already saw the change, it reloads the history itself.
      else if (mode === 'tip' && shouldRefreshHistoryTip(previousFingerprint, historyFingerprintRef.current)) {
        await fns.refreshHistoryTip(fresh)
      }
    },
    [activeRepoRef, refreshRepoMeta, historyFnsRef]
  )

  const removeRepoFromList = useCallback(
    async (repo: Repository, options: RepoRemoveOptions = {}): Promise<void> => {
      await runWithBusy(
        async () => {
          const removingActive = activeRepoRef.current?.id === repo.id
          const { warning } = await window.gitManager.repo.remove(repo.id, options)
          // Update local list without re-inspecting every repo (avoids fs.watch storms).
          const remaining = reposRef.current.filter((r) => r.id !== repo.id)
          setRepos(remaining)
          if (removingActive) setActiveRepo(remaining[0] ?? null)
          setRepoRemoveError(null)
          // A note about the worktree record keeps the dialog open to show it; the dialog closes from there.
          if (warning) setRepoRemoveWarning(warning)
          else setRepoPendingRemove(null)
          if (removingActive) {
            setSelection(null)
            setViewMode('history')
          }
        },
        {
          setBusy: setRepoRemoveBusy,
          setError: (msg) => {
            setRepoRemoveError(msg)
            setError(msg)
          }
        }
      )
    },
    [activeRepoRef, reposRef, setError, setSelection, setViewMode]
  )

  // Applies what the app loads once when it starts, then lists the repositories.
  const finishBoot = useEffectEvent(
    async ([p, a, u, probe]: [AppPreferences, ProviderAccount[], UpdateStatus, GitProbeResult]): Promise<void> => {
      hydrateFromPrefs(p)
      setAccounts(a)
      setUpdateStatus(u)
      if (!probe.available) {
        setGitMissing(true)
        setError(probe.message ?? 'Git was not found on this computer.')
        setActiveRepo(null)
        await refreshRepos({ activateFirst: false })
        return
      }
      setGitMissing(false)
      await refreshRepos()
    }
  )

  useEffect(() => {
    let cancelled = false
    const start = async (): Promise<void> => {
      if (!window.gitManager) throw new Error('App bridge failed to load. Restart the app after a clean npm install.')
      const loaded = await Promise.all([
        window.gitManager.prefs.get(),
        window.gitManager.providers.listAccounts(),
        window.gitManager.updater.status(),
        window.gitManager.git.probe()
      ])
      if (cancelled) return
      await finishBoot(loaded)
      if (!cancelled) setStartupStatus('ready')
    }
    void start().catch((err) => {
      if (!cancelled) {
        setError(toErrorMessage(err))
        setStartupStatus('failed')
      }
    })
    const off = window.gitManager?.updater.onStatus(setUpdateStatus)
    return () => {
      cancelled = true
      off?.()
    }
  }, [setError, setUpdateStatus, bootAttempt])

  // The main process says when watching falls back to polling, e.g. at Linux's inotify limit.
  useEffect(() => {
    if (!window.gitManager?.repo?.onWatchState) return
    return window.gitManager.repo.onWatchState(setWatchState)
  }, [])

  useEffect(() => {
    if (!window.gitManager?.repo?.watch) return
    const repoPath = activeRepo?.path
    if (!repoPath || liveStatusWatch === false) {
      void window.gitManager.repo.unwatch()
      return
    }

    historyFingerprintRef.current = null
    watchScheduler.reset()

    const runWatchRefresh = async (scope: RepoRefreshScope, generation: number): Promise<void> => {
      const repo = activeRepoRef.current
      if (!repo || repo.path !== repoPath) {
        watchScheduler.reset()
        return
      }
      try {
        if (scope === 'meta') {
          const previousFingerprint = historyFingerprintRef.current
          const fresh = await refreshRepoMeta(repo, { persist: false })
          if (
            sameRepoPath(activeRepoRef.current?.path, repoPath) &&
            shouldRefreshHistoryTip(previousFingerprint, historyFingerprintRef.current)
          ) {
            await historyFnsRef.current?.refreshHistoryTip(fresh)
          }
        } else {
          await refreshStatus(repo)
        }
      } catch (err) {
        if (sameRepoPath(activeRepoRef.current?.path, repoPath)) setError(toErrorMessage(err))
      } finally {
        const next = watchScheduler.complete(generation)
        if (next.run) void runWatchRefresh(next.scope, next.generation)
      }
    }

    const requestRefresh = (scope: RepoRefreshScope): void => {
      const scheduled = watchScheduler.request(scope)
      if (scheduled.run) void runWatchRefresh(scheduled.scope, scheduled.generation)
    }

    // While the window is minimized or covered, changes are only noted; one refresh catches up when it
    // shows again, instead of Git and React work for every save of a build or an editor.
    let held: RepoRefreshScope | null = null
    const onVisibility = (): void => {
      if (document.hidden || !held) return
      const scope = held
      held = null
      requestRefresh(scope)
    }
    document.addEventListener('visibilitychange', onVisibility)

    // The state also arrives as an event, but a reloaded window whose watch kept running gets none.
    window.gitManager.repo.watch(repoPath).then(setWatchState, () => undefined)
    const off = window.gitManager.repo.onChanged((raw) => {
      const event = raw as RepoWatchEvent
      if (!event?.repoPath) return
      const left = event.repoPath.replace(/\\/g, '/').toLowerCase()
      const right = repoPath.replace(/\\/g, '/').toLowerCase()
      if (left !== right) return
      const repo = activeRepoRef.current
      if (!repo || repo.path !== repoPath) return
      const scope: RepoRefreshScope = event.kind === 'git-meta' ? 'meta' : 'status'
      if (document.hidden) held = held ? maxScope(held, scope) : scope
      else requestRefresh(scope)
    })

    return () => {
      off()
      document.removeEventListener('visibilitychange', onVisibility)
      watchScheduler.reset()
      void window.gitManager.repo.unwatch()
    }
  }, [
    activeRepo?.path,
    activeRepoRef,
    liveStatusWatch,
    refreshRepoMeta,
    refreshStatus,
    historyFnsRef,
    setError,
    watchScheduler
  ])

  return {
    repos,
    startupStatus,
    retryStartup,
    activeRepo,
    setActiveRepo,
    getActiveRepo,
    branches,
    remoteBranches,
    setRemoteBranches,
    status,
    statusRevision,
    identity,
    setIdentity,
    rebaseInProgress,
    mergeInProgress,
    sequencerOp,
    gitMissing,
    currentBranch,
    localBranchNames,
    watchNotice,
    repoPendingRemove,
    setRepoPendingRemove,
    repoRemoveBusy,
    repoRemoveError,
    setRepoRemoveError,
    repoRemoveWarning,
    setRepoRemoveWarning,
    refreshRepos,
    refreshRepoMeta,
    afterGitMutation,
    removeRepoFromList
  }
}
