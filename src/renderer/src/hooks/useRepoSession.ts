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
  activeRepo: Repository | null
  setActiveRepo: React.Dispatch<React.SetStateAction<Repository | null>>
  /** The active repository at call time, for actions that outlive the render they were created in. */
  getActiveRepo: () => Repository | null
  branches: BranchInfo[]
  remoteBranches: RemoteBranchInfo[]
  setRemoteBranches: React.Dispatch<React.SetStateAction<RemoteBranchInfo[]>>
  status: StatusEntry[]
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
  const [activeRepo, setActiveRepo] = useState<Repository | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [remoteBranches, setRemoteBranches] = useState<RemoteBranchInfo[]>([])
  const [status, setStatus] = useState<StatusEntry[]>([])
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
  // Refreshes overlap (watcher events, Git actions) and finish in any order. Only the newest may apply:
  // an older response would put back branches or status from before the latest change.
  const [metaGate] = useState(createLatestGate)
  const [statusGate] = useState(createLatestGate)

  const currentBranch = useMemo(() => branches.find((b) => b.current) ?? null, [branches])
  const localBranchNames = useMemo(() => new Set(branches.map((b) => b.name)), [branches])
  const watchNotice =
    watchState?.mode === 'polling' && sameRepoPath(watchState.repoPath, activeRepo?.path) ? watchState.reason : null

  const getActiveRepo = useCallback((): Repository | null => activeRepoRef.current, [activeRepoRef])

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

  /** Work-tree edits only change status; branches, identity and history stay as they are. */
  const refreshStatus = useCallback(
    async (repo: Repository): Promise<void> => {
      const token = statusGate.begin()
      const entries = await window.gitManager.repo.status(repo.path)
      if (!statusGate.isLatest(token) || !sameRepoPath(activeRepoRef.current?.path, repo.path)) return
      setStatus(entries)
      noteConflicts(repo.path, entries)
    },
    [activeRepoRef, noteConflicts, statusGate]
  )

  const refreshRepoMeta = useCallback(
    async (repo: Repository): Promise<Repository> => {
      const metaToken = metaGate.begin()
      const statusToken = statusGate.begin()
      const [b, remoteB, s, fresh, id, rebasing, merging, sequencer] = await Promise.all([
        window.gitManager.repo.branches(repo.path),
        window.gitManager.repo.remoteBranches(repo.path),
        window.gitManager.repo.status(repo.path),
        window.gitManager.repo.get(repo.id),
        window.gitManager.git.getIdentity(repo.path),
        window.gitManager.git.rebaseInProgress(repo.path),
        window.gitManager.git.mergeInProgress(repo.path),
        window.gitManager.git.sequencerOp(repo.path)
      ])
      // The user may have switched repositories while these requests ran. Never apply another
      // repository's branches or status, and never switch the app back to it. A newer refresh of this
      // repository that started meanwhile applies its own, fresher results instead.
      if (!sameRepoPath(activeRepoRef.current?.path, repo.path) || !metaGate.isLatest(metaToken)) {
        return fresh ?? repo
      }
      setBranches(b)
      setRemoteBranches(remoteB)
      setIdentity(id)
      setRebaseInProgress(rebasing)
      setMergeInProgress(merging)
      setSequencerOp(sequencer)
      if (statusGate.isLatest(statusToken)) {
        setStatus(s)
        noteConflicts(repo.path, s)
      }
      if (fresh) {
        setActiveRepo((prev) => {
          if (!prev || !sameRepoPath(prev.path, repo.path)) return prev
          if (
            prev.id === fresh.id &&
            prev.path === fresh.path &&
            prev.currentBranch === fresh.currentBranch &&
            prev.name === fresh.name
          ) {
            return prev
          }
          return fresh
        })
        setRepos((prev) => {
          let replaced = false
          const next = prev.map((r) => {
            if (
              r.id === fresh.id ||
              r.id === repo.id ||
              r.path.toLowerCase() === fresh.path.toLowerCase()
            ) {
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
      }
      return fresh ?? repo
    },
    [activeRepoRef, noteConflicts, metaGate, statusGate]
  )

  const afterGitMutation = useCallback(
    async (opts?: { history?: HistoryRefreshMode }): Promise<void> => {
      const repo = activeRepoRef.current
      if (!repo) return
      // History uses the refreshed repository so a "current branch" filter follows a checkout.
      const fresh = await refreshRepoMeta(repo)
      const mode = opts?.history ?? 'tip'
      const fns = historyFnsRef.current
      if (!fns || !sameRepoPath(activeRepoRef.current?.path, repo.path)) return
      if (mode === 'full') await fns.loadHistory(fresh)
      else if (mode === 'tip') await fns.refreshHistoryTip(fresh)
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
    if (!window.gitManager) {
      setError('App bridge failed to load. Restart the app after a clean npm install.')
      return
    }
    let cancelled = false
    Promise.all([
      window.gitManager.prefs.get(),
      window.gitManager.providers.listAccounts(),
      window.gitManager.updater.status(),
      window.gitManager.git.probe()
    ])
      .then((loaded) => (cancelled ? undefined : finishBoot(loaded)))
      .catch((err) => {
        if (!cancelled) setError(toErrorMessage(err))
      })
    const off = window.gitManager.updater.onStatus(setUpdateStatus)
    return () => {
      cancelled = true
      off()
    }
  }, [setError, setUpdateStatus])

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
      void (async () => {
        if (event.kind === 'git-meta') {
          const fresh = await refreshRepoMeta(repo)
          await historyFnsRef.current?.refreshHistoryTip(fresh)
        } else {
          await refreshStatus(repo)
        }
      })().catch((err) => {
        if (sameRepoPath(activeRepoRef.current?.path, repoPath)) setError(toErrorMessage(err))
      })
    })

    return () => {
      off()
      void window.gitManager.repo.unwatch()
    }
  }, [activeRepo?.path, activeRepoRef, liveStatusWatch, refreshRepoMeta, refreshStatus, historyFnsRef, setError])

  return {
    repos,
    activeRepo,
    setActiveRepo,
    getActiveRepo,
    branches,
    remoteBranches,
    setRemoteBranches,
    status,
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
