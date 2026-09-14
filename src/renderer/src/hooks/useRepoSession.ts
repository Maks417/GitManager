import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AppPreferences,
  BranchInfo,
  GitIdentity,
  ProviderAccount,
  RemoteBranchInfo,
  Repository,
  RepoWatchEvent,
  StatusEntry,
  UpdateStatus
} from '@shared/ipc'
import { toErrorMessage } from '../lib/errors'
import { sameRepoPath } from '../lib/paths'
import { runWithBusy } from '../lib/useAsyncAction'
import type { HistoryRefreshMode, Selection, ViewMode } from './selection'

export type HistoryFns = {
  loadHistory: (repo: Repository, searchText?: string) => Promise<void>
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
  branches: BranchInfo[]
  remoteBranches: RemoteBranchInfo[]
  setRemoteBranches: React.Dispatch<React.SetStateAction<RemoteBranchInfo[]>>
  status: StatusEntry[]
  identity: GitIdentity | null
  setIdentity: React.Dispatch<React.SetStateAction<GitIdentity | null>>
  rebaseInProgress: boolean
  mergeInProgress: boolean
  gitMissing: boolean
  currentBranch: BranchInfo | null
  localBranchNames: Set<string>
  repoPendingRemove: Repository | null
  setRepoPendingRemove: React.Dispatch<React.SetStateAction<Repository | null>>
  repoRemoveBusy: boolean
  repoRemoveError: string | null
  setRepoRemoveError: React.Dispatch<React.SetStateAction<string | null>>
  refreshRepos: (opts?: { activateFirst?: boolean }) => Promise<void>
  refreshRepoMeta: (repo: Repository) => Promise<Repository>
  afterGitMutation: (opts?: { history?: HistoryRefreshMode }) => Promise<void>
  removeRepoFromList: (repo: Repository, deleteFiles?: boolean) => Promise<void>
} {
  const [repos, setRepos] = useState<Repository[]>([])
  const [activeRepo, setActiveRepo] = useState<Repository | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [remoteBranches, setRemoteBranches] = useState<RemoteBranchInfo[]>([])
  const [status, setStatus] = useState<StatusEntry[]>([])
  const [identity, setIdentity] = useState<GitIdentity | null>(null)
  const [rebaseInProgress, setRebaseInProgress] = useState(false)
  const [mergeInProgress, setMergeInProgress] = useState(false)
  const [gitMissing, setGitMissing] = useState(false)
  const [repoPendingRemove, setRepoPendingRemove] = useState<Repository | null>(null)
  const [repoRemoveBusy, setRepoRemoveBusy] = useState(false)
  const [repoRemoveError, setRepoRemoveError] = useState<string | null>(null)
  const activeRepoRef = useRef<Repository | null>(null)
  activeRepoRef.current = activeRepo
  const onConflictsDetectedRef = useRef(onConflictsDetected)
  onConflictsDetectedRef.current = onConflictsDetected
  const conflictStateRef = useRef<{ path: string; conflicted: boolean } | null>(null)

  const currentBranch = useMemo(() => branches.find((b) => b.current) ?? null, [branches])
  const localBranchNames = useMemo(() => new Set(branches.map((b) => b.name)), [branches])

  const refreshRepos = useCallback(async (opts?: { activateFirst?: boolean }) => {
    const list = await window.gitManager.repo.list()
    setRepos(list)
    const activateFirst = opts?.activateFirst !== false
    // Use ref so this callback stays stable — depending on `activeRepo` recreated the
    // boot effect and re-listed repos forever (inspect → watch → setActiveRepo → …).
    if (activateFirst && !activeRepoRef.current && list[0]) setActiveRepo(list[0])
  }, [])

  // Open the merge editor when the repository enters a conflicted state, not on every refresh,
  // so it can stay closed while conflicts are resolved elsewhere.
  const noteConflicts = useCallback((repoPath: string, entries: StatusEntry[]): void => {
    const conflicted = entries.some((e) => e.conflicted)
    const previous = conflictStateRef.current
    const wasConflicted = Boolean(previous?.conflicted && sameRepoPath(previous.path, repoPath))
    conflictStateRef.current = { path: repoPath, conflicted }
    if (conflicted && !wasConflicted) onConflictsDetectedRef.current()
  }, [])

  /** Work-tree edits only change status; branches, identity and history stay as they are. */
  const refreshStatus = useCallback(
    async (repo: Repository): Promise<void> => {
      const entries = await window.gitManager.repo.status(repo.path)
      if (!sameRepoPath(activeRepoRef.current?.path, repo.path)) return
      setStatus(entries)
      noteConflicts(repo.path, entries)
    },
    [noteConflicts]
  )

  const refreshRepoMeta = useCallback(async (repo: Repository): Promise<Repository> => {
    const [b, remoteB, s, fresh, id, rebasing, merging] = await Promise.all([
      window.gitManager.repo.branches(repo.path),
      window.gitManager.repo.remoteBranches(repo.path),
      window.gitManager.repo.status(repo.path),
      window.gitManager.repo.get(repo.id),
      window.gitManager.git.getIdentity(repo.path),
      window.gitManager.git.rebaseInProgress(repo.path),
      window.gitManager.git.mergeInProgress(repo.path)
    ])
    // The user may have switched repositories while these requests ran. Never apply another
    // repository's branches or status, and never switch the app back to it.
    if (!sameRepoPath(activeRepoRef.current?.path, repo.path)) return fresh ?? repo
    setBranches(b)
    setRemoteBranches(remoteB)
    setStatus(s)
    setIdentity(id)
    setRebaseInProgress(rebasing)
    setMergeInProgress(merging)
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
    noteConflicts(repo.path, s)
    return fresh ?? repo
  }, [noteConflicts])

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
    [refreshRepoMeta, historyFnsRef]
  )

  const removeRepoFromList = useCallback(
    async (repo: Repository, deleteFiles = false): Promise<void> => {
      await runWithBusy(
        async () => {
          const removingActive = activeRepoRef.current?.id === repo.id
          await window.gitManager.repo.remove(repo.id, { deleteFiles: Boolean(deleteFiles) })
          // Update local list without re-inspecting every repo (avoids fs.watch storms).
          setRepos((prev) => {
            const next = prev.filter((r) => r.id !== repo.id)
            if (removingActive) setActiveRepo(next[0] ?? null)
            return next
          })
          setRepoPendingRemove(null)
          setRepoRemoveError(null)
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
    [setError, setSelection, setViewMode]
  )

  useEffect(() => {
    if (!window.gitManager) {
      setError('App bridge failed to load. Restart the app after a clean npm install.')
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const [p, a, u, probe] = await Promise.all([
          window.gitManager.prefs.get(),
          window.gitManager.providers.listAccounts(),
          window.gitManager.updater.status(),
          window.gitManager.git.probe()
        ])
        if (cancelled) return
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
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err))
      }
    })()
    const off = window.gitManager.updater.onStatus(setUpdateStatus)
    return () => {
      cancelled = true
      off()
    }
    // Boot once on mount. refreshRepos is stable (empty deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot boot
  }, [])

  useEffect(() => {
    if (!window.gitManager?.repo?.watch) return
    const repoPath = activeRepo?.path
    if (!repoPath || liveStatusWatch === false) {
      void window.gitManager.repo.unwatch()
      return
    }

    void window.gitManager.repo.watch(repoPath)
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
  }, [activeRepo?.path, liveStatusWatch, refreshRepoMeta, refreshStatus, historyFnsRef])

  return {
    repos,
    activeRepo,
    setActiveRepo,
    branches,
    remoteBranches,
    setRemoteBranches,
    status,
    identity,
    setIdentity,
    rebaseInProgress,
    mergeInProgress,
    gitMissing,
    currentBranch,
    localBranchNames,
    repoPendingRemove,
    setRepoPendingRemove,
    repoRemoveBusy,
    repoRemoveError,
    setRepoRemoveError,
    refreshRepos,
    refreshRepoMeta,
    afterGitMutation,
    removeRepoFromList
  }
}
