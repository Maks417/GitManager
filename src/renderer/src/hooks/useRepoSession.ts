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
  gitMissing: boolean
  currentBranch: BranchInfo | null
  localBranchNames: Set<string>
  repoPendingRemove: Repository | null
  setRepoPendingRemove: React.Dispatch<React.SetStateAction<Repository | null>>
  repoRemoveBusy: boolean
  repoRemoveError: string | null
  setRepoRemoveError: React.Dispatch<React.SetStateAction<string | null>>
  refreshRepos: (opts?: { activateFirst?: boolean }) => Promise<void>
  refreshRepoMeta: (repo: Repository) => Promise<void>
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
  const [gitMissing, setGitMissing] = useState(false)
  const [repoPendingRemove, setRepoPendingRemove] = useState<Repository | null>(null)
  const [repoRemoveBusy, setRepoRemoveBusy] = useState(false)
  const [repoRemoveError, setRepoRemoveError] = useState<string | null>(null)
  const activeRepoRef = useRef<Repository | null>(null)
  activeRepoRef.current = activeRepo
  const onConflictsDetectedRef = useRef(onConflictsDetected)
  onConflictsDetectedRef.current = onConflictsDetected

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

  const refreshRepoMeta = useCallback(async (repo: Repository) => {
    const [b, remoteB, s, fresh, id, rebasing] = await Promise.all([
      window.gitManager.repo.branches(repo.path),
      window.gitManager.repo.remoteBranches(repo.path),
      window.gitManager.repo.status(repo.path),
      window.gitManager.repo.get(repo.id),
      window.gitManager.git.getIdentity(repo.path),
      window.gitManager.git.rebaseInProgress(repo.path)
    ])
    setBranches(b)
    setRemoteBranches(remoteB)
    setStatus(s)
    setIdentity(id)
    setRebaseInProgress(rebasing)
    if (fresh) {
      setActiveRepo((prev) => {
        if (
          prev &&
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
    if (s.some((e) => e.conflicted)) onConflictsDetectedRef.current()
  }, [])

  const afterGitMutation = useCallback(
    async (opts?: { history?: HistoryRefreshMode }): Promise<void> => {
      const repo = activeRepoRef.current
      if (!repo) return
      await refreshRepoMeta(repo)
      const mode = opts?.history ?? 'tip'
      const fns = historyFnsRef.current
      if (!fns) return
      if (mode === 'full') await fns.loadHistory(repo)
      else if (mode === 'tip') await fns.refreshHistoryTip(repo)
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
        await refreshRepoMeta(repo)
        if (event.kind === 'git-meta') {
          await historyFnsRef.current?.refreshHistoryTip(repo)
        }
      })()
    })

    return () => {
      off()
      void window.gitManager.repo.unwatch()
    }
  }, [activeRepo?.path, liveStatusWatch, refreshRepoMeta, historyFnsRef])

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
