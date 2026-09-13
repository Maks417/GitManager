import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FileDiff,
  FolderPlus,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  History,
  Link,
  Monitor,
  Moon,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Plus,
  RefreshCw,
  Search,
  Sun,
  Trash2
} from 'lucide-react'
import type {
  AppPreferences,
  BranchInfo,
  Commit,
  CommitDetail,
  DiffResult,
  FileChange,
  GitIdentity,
  GraphNode,
  ProviderAccount,
  RemoteBranchInfo,
  RemoteRepo,
  Repository,
  RepoWatchEvent,
  StatusEntry,
  UpdateStatus
} from '@shared/ipc'
import { decorateCommitsWithColors, layoutCommitGraph } from '@history-core/layout'
import type { ThemePreference } from '@shared/theme'
import { GIT_DOWNLOAD_URL } from './lib/git-install'
import { HistoryGraph } from './features/history-graph/HistoryGraph'
import { CommitDetailPane } from './features/commit-detail/CommitDetailPane'
import {
  defaultSideFor,
  type DiffSide,
  WorkingTreeDetailPane
} from './features/changes/WorkingTreeDetailPane'
import { MergeEditorModal } from './features/merge-editor/MergeEditorModal'
import { AccountsModal } from './features/accounts/AccountsModal'
import { CloneModal } from './features/clone/CloneModal'
import { AboutModal } from './features/about/AboutModal'
import { UpdatesModal } from './features/updates/UpdatesModal'
import { IdentityModal } from './features/identity/IdentityModal'
import { CreateBranchModal } from './features/branches/CreateBranchModal'
import { BranchPickModal } from './features/branches/BranchPickModal'
import { Splitter } from './components/Splitter'
import { Banner, Button, ConfirmDialog, IconButton, SegmentedControl } from './components/ui'
import { resolveAndApplyTheme } from './lib/theme'

type Selection = { kind: 'commit'; sha: string } | { kind: 'working-copy' }
type ViewMode = 'history' | 'changes'
type HistoryRefreshMode = 'full' | 'tip' | 'none'

const HISTORY_PAGE_SIZE = 200

export function App(): React.JSX.Element {
  const [repos, setRepos] = useState<Repository[]>([])
  const [activeRepo, setActiveRepo] = useState<Repository | null>(null)
  const [branches, setBranches] = useState<BranchInfo[]>([])
  const [remoteBranches, setRemoteBranches] = useState<RemoteBranchInfo[]>([])
  const [commits, setCommits] = useState<Commit[]>([])
  const [graph, setGraph] = useState<GraphNode[]>([])
  const [headSha, setHeadSha] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>('history')
  const [detail, setDetail] = useState<CommitDetail | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileChange | null>(null)
  const [focusedStatusPath, setFocusedStatusPath] = useState<string | null>(null)
  const [diffSide, setDiffSide] = useState<DiffSide>('unstaged')
  const [diff, setDiff] = useState<DiffResult | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [status, setStatus] = useState<StatusEntry[]>([])
  const [search, setSearch] = useState('')
  const [prefs, setPrefs] = useState<AppPreferences | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [gitMissing, setGitMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [accountsOpen, setAccountsOpen] = useState(false)
  const [cloneOpen, setCloneOpen] = useState(false)
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [identityOpen, setIdentityOpen] = useState(false)
  const [identity, setIdentity] = useState<GitIdentity | null>(null)
  const [createBranchOpen, setCreateBranchOpen] = useState(false)
  const [mergePickOpen, setMergePickOpen] = useState(false)
  const [rebasePickOpen, setRebasePickOpen] = useState(false)
  const [rebaseInProgress, setRebaseInProgress] = useState(false)
  const [syncMenuOpen, setSyncMenuOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(200)
  const [inspectorHeight, setInspectorHeight] = useState(320)
  const [detailWidth, setDetailWidth] = useState(480)
  const [inspectorFilesWidth, setInspectorFilesWidth] = useState(200)
  const [changesFilesWidth, setChangesFilesWidth] = useState(300)
  const [historyGraphColWidth, setHistoryGraphColWidth] = useState(140)
  const [historyDateColWidth, setHistoryDateColWidth] = useState(110)
  const [historyAuthorColWidth, setHistoryAuthorColWidth] = useState(180)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const [accounts, setAccounts] = useState<ProviderAccount[]>([])
  const [repoPendingRemove, setRepoPendingRemove] = useState<Repository | null>(null)
  const [repoRemoveBusy, setRepoRemoveBusy] = useState(false)
  const [repoRemoveError, setRepoRemoveError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const syncRef = useRef<HTMLDivElement>(null)
  const activeRepoRef = useRef<Repository | null>(null)
  activeRepoRef.current = activeRepo

  const selectedSha = selection?.kind === 'commit' ? selection.sha : null
  const workingCopySelected = selection?.kind === 'working-copy'
  const sidebarCollapsed = Boolean(prefs?.sidebarCollapsed)
  const branchesExpanded = Boolean(prefs?.branchesExpanded)
  const remoteBranchesExpanded = Boolean(prefs?.remoteBranchesExpanded)
  const detailDock = prefs?.detailDock === 'right' ? 'right' : 'bottom'
  const currentBranch = useMemo(() => branches.find((b) => b.current) ?? null, [branches])
  const localBranchNames = useMemo(() => new Set(branches.map((b) => b.name)), [branches])

  const refreshRepos = useCallback(
    async (opts?: { activateFirst?: boolean }) => {
      const list = await window.gitManager.repo.list()
      setRepos(list)
      const activateFirst = opts?.activateFirst !== false
      if (activateFirst && !activeRepo && list[0]) setActiveRepo(list[0])
    },
    [activeRepo]
  )

  const loadHistory = useCallback(
    async (repo: Repository, searchText = search) => {
      setBusy(true)
      setError(null)
      try {
        const page = await window.gitManager.history.load({
          repoPath: repo.path,
          search: searchText || undefined,
          limit: HISTORY_PAGE_SIZE,
          branch: prefs?.historyFilter === 'current' ? repo.currentBranch || undefined : undefined
        })
        setCommits(page.commits)
        setGraph(page.graph)
        setHeadSha(page.headSha)
        setNextCursor(page.nextCursor)
        setSelection((prev) => {
          if (prev?.kind === 'working-copy') return prev
          const keep = prev?.kind === 'commit' ? page.commits.find((c) => c.sha === prev.sha)?.sha : null
          const nextSha = keep || page.commits[0]?.sha || null
          if (nextSha) return { kind: 'commit', sha: nextSha }
          return { kind: 'working-copy' }
        })
        if (!page.headSha && page.commits.length === 0) setViewMode('changes')
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [prefs?.historyFilter, search]
  )

  const loadMoreHistory = useCallback(async (): Promise<void> => {
    if (!activeRepo || !nextCursor || historyLoadingMore || busy) return
    setHistoryLoadingMore(true)
    setError(null)
    try {
      const branchFilter =
        prefs?.historyFilter === 'current' ? activeRepo.currentBranch || undefined : undefined
      const page = await window.gitManager.history.load({
        repoPath: activeRepo.path,
        search: search || undefined,
        limit: HISTORY_PAGE_SIZE,
        branch: branchFilter,
        // Branch mode uses --skip; --all mode uses cursor^@
        cursor: branchFilter ? undefined : nextCursor,
        skip: branchFilter ? commits.length : undefined
      })
      setCommits((prev) => {
        const seen = new Set(prev.map((c) => c.sha))
        const appended = page.commits.filter((c) => !seen.has(c.sha))
        const merged = decorateCommitsWithColors([...prev, ...appended])
        setGraph(layoutCommitGraph(merged))
        return merged
      })
      setHeadSha(page.headSha)
      setNextCursor(page.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setHistoryLoadingMore(false)
    }
  }, [
    activeRepo,
    nextCursor,
    historyLoadingMore,
    busy,
    prefs?.historyFilter,
    search,
    commits.length
  ])

  const refreshHistoryTip = useCallback(
    async (repo: Repository): Promise<void> => {
      try {
        const page = await window.gitManager.history.load({
          repoPath: repo.path,
          search: search || undefined,
          limit: HISTORY_PAGE_SIZE,
          branch: prefs?.historyFilter === 'current' ? repo.currentBranch || undefined : undefined
        })
        setCommits((prev) => {
          const tipShas = new Set(page.commits.map((c) => c.sha))
          // Tip refresh must not keep commits from a previous repository —
          // activeRepo switches clear commits first; here we only merge same-repo pages.
          const older = prev.filter((c) => !tipShas.has(c.sha))
          const merged = decorateCommitsWithColors([...page.commits, ...older])
          setGraph(layoutCommitGraph(merged))
          return merged
        })
        setHeadSha(page.headSha)
        // Keep existing nextCursor / loaded depth; tip refresh only updates the newest window.
        if (!nextCursor) setNextCursor(page.nextCursor)
        setSelection((prev) => {
          if (prev?.kind === 'working-copy') return prev
          if (prev?.kind === 'commit') return prev
          const nextSha = page.commits[0]?.sha || null
          if (nextSha) return { kind: 'commit', sha: nextSha }
          return { kind: 'working-copy' }
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [prefs?.historyFilter, search, nextCursor]
  )

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
      setActiveRepo(fresh)
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
    if (s.some((e) => e.conflicted)) setMergeOpen(true)
  }, [])

  const afterGitMutation = useCallback(
    async (opts?: { history?: HistoryRefreshMode }): Promise<void> => {
      if (!activeRepo) return
      await refreshRepoMeta(activeRepo)
      const mode = opts?.history ?? 'tip'
      if (mode === 'full') await loadHistory(activeRepo)
      else if (mode === 'tip') await refreshHistoryTip(activeRepo)
    },
    [activeRepo, refreshRepoMeta, loadHistory, refreshHistoryTip]
  )

  const runMergeOrRebase = useCallback(
    async (op: 'merge' | 'rebase', ref: string): Promise<void> => {
      if (!activeRepo) return
      setBusy(true)
      setError(null)
      try {
        const result =
          op === 'merge'
            ? await window.gitManager.git.merge(activeRepo.path, ref)
            : await window.gitManager.git.rebase(activeRepo.path, ref)
        await afterGitMutation({ history: 'full' })
        if (result.conflicts.length > 0) setMergeOpen(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        await afterGitMutation({ history: 'full' }).catch(() => undefined)
      } finally {
        setBusy(false)
      }
    },
    [activeRepo, afterGitMutation]
  )

  const deleteBranch = useCallback(
    async (name: string): Promise<void> => {
      if (!activeRepo) return
      setBusy(true)
      setError(null)
      try {
        try {
          await window.gitManager.git.deleteBranch(activeRepo.path, name, false)
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!confirm(`${msg}\n\nForce delete branch "${name}"?`)) throw err
          await window.gitManager.git.deleteBranch(activeRepo.path, name, true)
        }
        await afterGitMutation({ history: 'full' })
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [activeRepo, afterGitMutation]
  )

  const removeRepoFromList = useCallback(
    async (repo: Repository, deleteFiles = false): Promise<void> => {
      setRepoRemoveBusy(true)
      setRepoRemoveError(null)
      setError(null)
      try {
        await window.gitManager.repo.remove(repo.id, { deleteFiles: Boolean(deleteFiles) })
        const list = await window.gitManager.repo.list()
        setRepos(list)
        setRepoPendingRemove(null)
        setRepoRemoveError(null)
        if (activeRepo?.id === repo.id) {
          setActiveRepo(list[0] ?? null)
          setSelection(null)
          setViewMode('history')
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setRepoRemoveError(message)
        setError(message)
      } finally {
        setRepoRemoveBusy(false)
      }
    },
    [activeRepo?.id]
  )

  useEffect(() => {
    if (!window.gitManager) {
      setError('App bridge failed to load. Restart the app after a clean npm install.')
      return
    }
    void (async () => {
      try {
        const [p, a, u, probe] = await Promise.all([
          window.gitManager.prefs.get(),
          window.gitManager.providers.listAccounts(),
          window.gitManager.updater.status(),
          window.gitManager.git.probe()
        ])
        setPrefs(p)
        setAccounts(a)
        setUpdateStatus(u)
        setSidebarWidth(p.sidebarWidth)
        setInspectorHeight(p.inspectorHeight)
        setDetailWidth(p.detailWidth)
        setInspectorFilesWidth(p.inspectorFilesWidth)
        setChangesFilesWidth(p.changesFilesWidth)
        setHistoryGraphColWidth(p.historyGraphColWidth)
        setHistoryDateColWidth(p.historyDateColWidth)
        setHistoryAuthorColWidth(p.historyAuthorColWidth)
        resolveAndApplyTheme(p.theme)
        if (!probe.available) {
          setGitMissing(true)
          setError(probe.message)
          setActiveRepo(null)
          await refreshRepos({ activateFirst: false })
          return
        }
        setGitMissing(false)
        await refreshRepos()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
    const off = window.gitManager.updater.onStatus(setUpdateStatus)
    return off
  }, [refreshRepos])

  useEffect(() => {
    if (!prefs) return
    resolveAndApplyTheme(prefs.theme)
    if (prefs.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      resolveAndApplyTheme('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [prefs?.theme])

  useEffect(() => {
    if (!activeRepo) return
    // Drop prior-repo selection/history immediately so commit-detail cannot race
    // against a SHA that does not exist in the newly selected repository.
    setCommits([])
    setGraph([])
    setHeadSha(null)
    setNextCursor(null)
    setSelection(null)
    setDetail(null)
    setSelectedFile(null)
    setDiff(null)
    setRemoteBranches([])
    void loadHistory(activeRepo)
    void refreshRepoMeta(activeRepo)
  }, [activeRepo?.path, prefs?.historyFilter])

  useEffect(() => {
    if (!window.gitManager?.repo?.watch) return
    const repoPath = activeRepo?.path
    if (!repoPath || prefs?.liveStatusWatch === false) {
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
        if (event.kind === 'git-meta') await refreshHistoryTip(repo)
      })()
    })

    return () => {
      off()
      void window.gitManager.repo.unwatch()
    }
  }, [activeRepo?.path, prefs?.liveStatusWatch, refreshRepoMeta, refreshHistoryTip])

  useEffect(() => {
    if (!workingCopySelected) return
    if (focusedStatusPath && status.some((s) => s.path === focusedStatusPath)) return
    const first = status[0]
    setFocusedStatusPath(first?.path ?? null)
    if (first) setDiffSide(defaultSideFor(first))
  }, [status, workingCopySelected, focusedStatusPath])

  useEffect(() => {
    if (!activeRepo || selection?.kind !== 'commit' || !selectedSha || !/^[0-9a-f]{7,40}$/i.test(selectedSha)) {
      if (selection?.kind !== 'commit') {
        setDetail(null)
        setSelectedFile(null)
      }
      return
    }
    // Skip until history for this repo includes the SHA (avoids cross-repo races).
    if (!commits.some((c) => c.sha === selectedSha)) {
      setDetail(null)
      setSelectedFile(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const d = await window.gitManager.history.commitDetail(activeRepo.path, selectedSha)
        if (cancelled) return
        setDetail(d)
        setSelectedFile(d.files[0] || null)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setDetail(null)
        setSelectedFile(null)
        if (/bad object|invalid commit|unknown revision|commit not found/i.test(message)) {
          setSelection((prev) => (prev?.kind === 'commit' && prev.sha === selectedSha ? null : prev))
          return
        }
        setError(message)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeRepo?.path, selection?.kind, selectedSha, commits])

  useEffect(() => {
    if (!activeRepo || selection?.kind !== 'commit' || !selectedSha || !selectedFile) {
      if (selection?.kind === 'commit') {
        setDiff(null)
        setDiffLoading(false)
      }
      return
    }
    let cancelled = false
    setDiffLoading(true)
    setDiff(null)
    void (async () => {
      try {
        const d = await window.gitManager.history.fileDiff({
          repoPath: activeRepo.path,
          sha: selectedSha,
          path: selectedFile.path,
          parentIndex: 0
        })
        if (!cancelled) setDiff(d)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setDiffLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeRepo?.path, selection?.kind, selectedSha, selectedFile?.path])

  useEffect(() => {
    if (!activeRepo || selection?.kind !== 'working-copy' || !focusedStatusPath) {
      if (selection?.kind === 'working-copy') {
        setDiff(null)
        setDiffLoading(false)
      }
      return
    }
    let cancelled = false
    setDiffLoading(true)
    setDiff(null)
    void (async () => {
      try {
        const d = await window.gitManager.history.workingTreeDiff({
          repoPath: activeRepo.path,
          path: focusedStatusPath,
          side: diffSide
        })
        if (!cancelled) setDiff(d)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setDiffLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [activeRepo?.path, selection?.kind, focusedStatusPath, diffSide])

  useEffect(() => {
    if (!syncMenuOpen) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (syncRef.current && !syncRef.current.contains(t)) setSyncMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [syncMenuOpen])

  const selectWorkingCopy = useCallback((): void => {
    setViewMode('changes')
    setSelection({ kind: 'working-copy' })
    setDetail(null)
    setSelectedFile(null)
    setDiff(null)
    const first = status[0]
    setFocusedStatusPath(first?.path ?? null)
    if (first) setDiffSide(defaultSideFor(first))
  }, [status])

  const selectCommit = useCallback((sha: string): void => {
    setViewMode('history')
    setSelection({ kind: 'commit', sha })
    setFocusedStatusPath(null)
    setDiff(null)
  }, [])

  const goHistory = useCallback((): void => {
    setViewMode('history')
    if (commits[0]) selectCommit(commits[0].sha)
    else if (headSha && /^[0-9a-f]{7,40}$/i.test(headSha)) selectCommit(headSha)
    else {
      setSelection(null)
      setDetail(null)
      setSelectedFile(null)
      setDiff(null)
    }
  }, [commits, headSha, selectCommit])

  const openGitDownload = (): void => {
    void window.gitManager.shell.openExternal(GIT_DOWNLOAD_URL)
  }

  const requireGit = (): boolean => {
    if (!gitMissing) return true
    setError(
      (prev) =>
        prev ||
        'Git was not found on this computer. Install Git from https://git-scm.com/downloads, then restart Git Manager.'
    )
    return false
  }

  const openClone = (): void => {
    if (!requireGit()) return
    setCloneOpen(true)
  }

  const addRepo = async (): Promise<void> => {
    if (!requireGit()) return
    setError(null)
    try {
      const repo = await window.gitManager.repo.openDialog()
      if (!repo) return
      await refreshRepos()
      setActiveRepo(repo)
      setSelection(null)
      setViewMode('history')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const runGit = async (op: 'fetch' | 'pull' | 'push'): Promise<void> => {
    if (!activeRepo) return
    setBusy(true)
    setError(null)
    setSyncMenuOpen(false)
    try {
      await window.gitManager.git[op](activeRepo.path)
      await refreshRepoMeta(activeRepo)
      await refreshHistoryTip(activeRepo)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const toggleDock = (): void => {
    void window.gitManager.prefs
      .set({ detailDock: detailDock === 'right' ? 'bottom' : 'right' })
      .then(setPrefs)
  }

  const toggleSidebar = (): void => {
    void window.gitManager.prefs.set({ sidebarCollapsed: !sidebarCollapsed }).then(setPrefs)
  }

  const toggleBranches = (): void => {
    void window.gitManager.prefs.set({ branchesExpanded: !branchesExpanded }).then(setPrefs)
  }

  const toggleRemoteBranches = (): void => {
    void window.gitManager.prefs
      .set({ remoteBranchesExpanded: !remoteBranchesExpanded })
      .then(setPrefs)
  }

  const checkoutRemote = async (remoteRef: string): Promise<void> => {
    if (!activeRepo || busy) return
    setBusy(true)
    setError(null)
    try {
      await window.gitManager.git.checkoutRemoteBranch(activeRepo.path, remoteRef)
      await afterGitMutation({ history: 'full' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!window.gitManagerMenu) return
    const offs = [
      window.gitManagerMenu.on('menu:add-repo', () => void addRepo()),
      window.gitManagerMenu.on('menu:clone-repo', () => openClone()),
      window.gitManagerMenu.on('menu:accounts', () => setAccountsOpen(true)),
      window.gitManagerMenu.on('menu:identity', () => setIdentityOpen(true)),
      window.gitManagerMenu.on('menu:create-branch', () => setCreateBranchOpen(true)),
      window.gitManagerMenu.on('menu:merge', () => setMergePickOpen(true)),
      window.gitManagerMenu.on('menu:rebase', () => setRebasePickOpen(true)),
      window.gitManagerMenu.on('menu:focus-search', () => searchRef.current?.focus()),
      window.gitManagerMenu.on('menu:fetch', () => void runGit('fetch')),
      window.gitManagerMenu.on('menu:pull', () => void runGit('pull')),
      window.gitManagerMenu.on('menu:push', () => void runGit('push')),
      window.gitManagerMenu.on('menu:updates', () => setUpdatesOpen(true)),
      window.gitManagerMenu.on('menu:about', () => setAboutOpen(true)),
      window.gitManagerMenu.on('menu:view-history', () => goHistory()),
      window.gitManagerMenu.on('menu:view-changes', () => selectWorkingCopy()),
      window.gitManagerMenu.on('menu:toggle-dock', () => toggleDock()),
      window.gitManagerMenu.on('menu:toggle-sidebar', () => toggleSidebar())
    ]
    return () => offs.forEach((off) => off())
  })

  const persistLayout = useCallback((partial: Partial<AppPreferences>): void => {
    void window.gitManager.prefs.set(partial).then(setPrefs)
  }, [])

  const onSearchSubmit = (e: React.FormEvent): void => {
    e.preventDefault()
    if (activeRepo) void loadHistory(activeRepo, search)
  }

  const graphBySha = useMemo(() => {
    const map = new Map<string, GraphNode>()
    for (const g of graph) map.set(g.sha, g)
    return map
  }, [graph])

  const setThemePref = (theme: ThemePreference): void => {
    void window.gitManager.prefs.set({ theme }).then((p) => {
      setPrefs(p)
      resolveAndApplyTheme(p.theme)
    })
  }

  const conflictCount = status.filter((s) => s.conflicted).length
  const syncBadge =
    currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0) ? (
      <span className="ahead-behind">
        <ArrowUp size={12} strokeWidth={2} />
        {currentBranch.ahead}
        <ArrowDown size={12} strokeWidth={2} />
        {currentBranch.behind}
      </span>
    ) : null
  const showInspector = viewMode === 'history' && selection?.kind === 'commit'
  const sideBySideDiff = detailDock === 'right'

  const workspaceClass = [
    'workspace',
    viewMode === 'history' ? 'mode-history' : 'mode-changes',
    viewMode === 'history' && detailDock === 'bottom' ? 'dock-bottom' : '',
    viewMode === 'history' && detailDock === 'right' ? 'dock-right' : '',
    !showInspector && viewMode === 'history' ? 'no-inspector' : '',
    sidebarCollapsed ? 'nav-collapsed' : ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="mode-switch" role="tablist" aria-label="View mode">
          <button
            type="button"
            role="tab"
            disabled={!activeRepo}
            className={['btn-icon', 'has-hint', 'has-hint-above', viewMode === 'history' ? 'primary' : '']
              .filter(Boolean)
              .join(' ')}
            aria-selected={viewMode === 'history'}
            title="History view"
            data-hint="History view"
            onClick={goHistory}
          >
            <History size={16} strokeWidth={1.75} />
            History
          </button>
          <button
            type="button"
            role="tab"
            disabled={!activeRepo}
            className={['btn-icon', 'has-hint', 'has-hint-above', viewMode === 'changes' ? 'primary' : '']
              .filter(Boolean)
              .join(' ')}
            aria-selected={viewMode === 'changes'}
            title="Working tree changes"
            data-hint="Working tree changes"
            onClick={selectWorkingCopy}
          >
            <FileDiff size={16} strokeWidth={1.75} />
            Changes{status.length ? ` (${status.length})` : ''}
          </button>
        </div>

        {conflictCount > 0 && (
          <Button
            variant="primary"
            icon={<GitMerge size={16} strokeWidth={1.75} />}
            hint="Resolve merge conflicts"
            title="Resolve merge conflicts"
            className="has-hint-above"
            onClick={() => setMergeOpen(true)}
          >
            Resolve conflicts ({conflictCount})
          </Button>
        )}

        {viewMode === 'history' && (
          <form className="spacer search-form" onSubmit={onSearchSubmit}>
            <div className="search-field">
              <Search className="search-field-icon" size={16} strokeWidth={1.75} aria-hidden />
              <input
                ref={searchRef}
                className="search"
                placeholder="Find commit by message, author, SHA, branch…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                disabled={!activeRepo}
                title="Search commits"
              />
            </div>
          </form>
        )}
        {viewMode !== 'history' && <div className="spacer" />}

        <div className="toolbar-menu" ref={syncRef}>
          <button
            type="button"
            disabled={!activeRepo || busy}
            className={['btn-icon', 'has-hint', 'has-hint-above', syncMenuOpen ? 'primary' : '']
              .filter(Boolean)
              .join(' ')}
            onClick={() => setSyncMenuOpen((o) => !o)}
            title="Fetch, pull, or push"
            data-hint="Fetch, pull, or push"
          >
            <RefreshCw size={16} strokeWidth={1.75} />
            Sync{syncBadge ? <> {syncBadge}</> : null}
          </button>
          {syncMenuOpen && (
            <div className="dropdown-menu dropdown-menu-end" role="menu">
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                className="btn-icon has-hint has-hint-above"
                title="Fetch remotes"
                data-hint="Fetch remotes"
                onClick={() => void runGit('fetch')}
              >
                <Download size={16} strokeWidth={1.75} />
                Fetch
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                className="btn-icon has-hint has-hint-above"
                title="Pull from upstream"
                data-hint="Pull from upstream"
                onClick={() => void runGit('pull')}
              >
                <ArrowDownToLine size={16} strokeWidth={1.75} />
                Pull
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                className="btn-icon has-hint has-hint-above"
                title="Push to upstream"
                data-hint="Push to upstream"
                onClick={() => void runGit('push')}
              >
                <ArrowUpFromLine size={16} strokeWidth={1.75} />
                Push
              </button>
            </div>
          )}
        </div>

        <SegmentedControl
          ariaLabel="Theme"
          value={prefs?.theme ?? 'system'}
          onChange={setThemePref}
          options={[
            {
              value: 'system',
              label: 'System',
              hint: 'Match system theme',
              icon: <Monitor size={14} strokeWidth={1.75} />
            },
            {
              value: 'light',
              label: 'Light',
              hint: 'Light theme',
              icon: <Sun size={14} strokeWidth={1.75} />
            },
            {
              value: 'dark',
              label: 'Dark',
              hint: 'Dark theme',
              icon: <Moon size={14} strokeWidth={1.75} />
            }
          ]}
        />
      </header>

      {!activeRepo ? (
        <div className="welcome">
          {error && <Banner>{error}</Banner>}
          <div className="welcome-card">
            <h1 className="welcome-brand">Git Manager</h1>
            <p className="welcome-kicker">History-first Git for the desktop</p>
            {gitMissing ? (
              <p className="muted welcome-hint">
                Git Manager needs the Git command-line tools on this computer. Install Git, restart the app, then add
                or clone a repository.
              </p>
            ) : (
              <p className="muted welcome-hint">
                Use <strong>File → Add Local Repository</strong> or <strong>Clone Repository</strong>, or the buttons
                below. History graph is the main view once a repo is open.
              </p>
            )}
            <div className="welcome-actions">
              {gitMissing ? (
                <Button
                  variant="primary"
                  icon={<ExternalLink size={16} strokeWidth={1.75} />}
                  hint="Open the official Git download page"
                  title="Open the official Git download page"
                  onClick={openGitDownload}
                >
                  Install Git
                </Button>
              ) : null}
              <Button
                variant={gitMissing ? 'default' : 'primary'}
                icon={<FolderPlus size={16} strokeWidth={1.75} />}
                hint={gitMissing ? 'Install Git first' : 'Add a local Git repository'}
                title={gitMissing ? 'Install Git first' : 'Add a local Git repository'}
                disabled={gitMissing}
                onClick={() => void addRepo()}
              >
                Add local repository
              </Button>
              <Button
                icon={<Download size={16} strokeWidth={1.75} />}
                hint={gitMissing ? 'Install Git first' : 'Clone a repository from a URL'}
                title={gitMissing ? 'Install Git first' : 'Clone a repository from a URL'}
                disabled={gitMissing}
                onClick={openClone}
              >
                Clone repository
              </Button>
              <Button
                icon={<Link size={16} strokeWidth={1.75} />}
                hint="Connect GitHub, GitLab, or Bitbucket"
                title="Connect GitHub, GitLab, or Bitbucket"
                onClick={() => setAccountsOpen(true)}
              >
                Connect GitHub / GitLab / Bitbucket
              </Button>
            </div>
            <ul className="welcome-steps muted">
              <li>Add or clone a Git repo from disk or a remote host</li>
              <li>Browse the commit graph, search history, inspect diffs</li>
              <li>Stage, commit, fetch, pull, push, and resolve merges</li>
            </ul>
          </div>
        </div>
      ) : (
        <div
          className={workspaceClass}
          style={
            {
              '--sidebar-width': `${sidebarCollapsed ? 52 : sidebarWidth}px`,
              '--inspector-height': `${inspectorHeight}px`,
              '--detail-width': `${detailWidth}px`
            } as React.CSSProperties
          }
        >
          <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
            <div className="sidebar-top">
              <IconButton
                label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                className="sidebar-toggle"
                onClick={toggleSidebar}
              >
                {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
              </IconButton>
              {!sidebarCollapsed && <div className="panel-title sidebar-heading">Repositories</div>}
            </div>
            <ul className="repo-list">
              {repos.map((r) => (
                <li
                  key={r.id}
                  className={r.id === activeRepo.id ? 'active' : ''}
                  onClick={() => {
                    setActiveRepo(r)
                    setSelection(null)
                    setViewMode('history')
                  }}
                  title={sidebarCollapsed ? `${r.name}${r.currentBranch ? ` (${r.currentBranch})` : ''}` : r.path}
                >
                  <div className="repo-row-main">
                    <div className="cell-ellipsis repo-name">
                      {sidebarCollapsed ? r.name.slice(0, 1).toUpperCase() : r.name}
                    </div>
                    {!sidebarCollapsed && r.id !== activeRepo.id && (
                      <div className="muted cell-ellipsis repo-branch-sub">{r.currentBranch || 'detached'}</div>
                    )}
                  </div>
                  {!sidebarCollapsed && (
                    <div className="repo-row-actions" onClick={(e) => e.stopPropagation()}>
                      <IconButton
                        label={`Remove ${r.name} from list`}
                        hint="Remove from list"
                        className="has-hint-end"
                        disabled={busy}
                        onClick={() => {
                          setRepoRemoveError(null)
                          setRepoPendingRemove(r)
                        }}
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </IconButton>
                    </div>
                  )}
                </li>
              ))}
            </ul>

            {!sidebarCollapsed && (
              <div className="branch-summary">
                <div className="branch-summary-label muted">Current branch</div>
                <div className="cell-ellipsis branch-summary-name" title={currentBranch?.name || activeRepo.currentBranch || 'detached'}>
                  {currentBranch?.name || activeRepo.currentBranch || 'detached'}
                </div>
                {currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0) && (
                  <div className="muted ahead-behind text-xs">
                    <ArrowUp size={12} strokeWidth={2} />
                    {currentBranch.ahead}
                    <ArrowDown size={12} strokeWidth={2} />
                    {currentBranch.behind}
                    {currentBranch.upstream ? ` · ${currentBranch.upstream}` : ''}
                  </div>
                )}
              </div>
            )}

            {!sidebarCollapsed && (
              <>
                <div className="panel-disclosure-row">
                  <button type="button" className="panel-title panel-disclosure" onClick={toggleBranches}>
                    <span>Branches</span>
                    <span className="muted">
                      {branchesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                  </button>
                  <IconButton label="New branch" onClick={() => setCreateBranchOpen(true)}>
                    <Plus size={16} />
                  </IconButton>
                </div>
                {branchesExpanded && (
                  <ul className="branch-list">
                    {branches.map((b) => (
                      <li
                        key={b.name}
                        className={b.current ? 'active' : ''}
                        onDoubleClick={() =>
                          void window.gitManager.git.checkout(activeRepo.path, b.name).then(async () => {
                            await afterGitMutation({ history: 'full' })
                          })
                        }
                        title="Double-click to checkout"
                      >
                        <div className="branch-row-main">
                          <div className="cell-ellipsis">{b.name}</div>
                          {(b.ahead > 0 || b.behind > 0) && (
                            <div className="muted ahead-behind text-xs">
                              <ArrowUp size={12} strokeWidth={2} />
                              {b.ahead}
                              <ArrowDown size={12} strokeWidth={2} />
                              {b.behind}
                            </div>
                          )}
                        </div>
                        {!b.current && (
                          <div className="branch-row-actions" onClick={(e) => e.stopPropagation()}>
                            <IconButton
                              label={`Merge ${b.name} into current`}
                              disabled={busy}
                              onClick={() => {
                                if (!confirm(`Merge "${b.name}" into current branch?`)) return
                                void runMergeOrRebase('merge', b.name)
                              }}
                            >
                              <GitMerge size={14} strokeWidth={1.75} />
                            </IconButton>
                            <IconButton
                              label={`Rebase current onto ${b.name}`}
                              disabled={busy}
                              onClick={() => {
                                const cur = currentBranch?.name || activeRepo.currentBranch || 'HEAD'
                                if (!confirm(`Rebase "${cur}" onto "${b.name}"?`)) return
                                void runMergeOrRebase('rebase', b.name)
                              }}
                            >
                              <GitBranchPlus size={14} strokeWidth={1.75} />
                            </IconButton>
                            <IconButton
                              label={`Delete branch ${b.name}`}
                              hint={`Delete ${b.name}`}
                              disabled={busy}
                              onClick={() => {
                                if (!confirm(`Delete branch "${b.name}"?`)) return
                                void deleteBranch(b.name)
                              }}
                            >
                              <Trash2 size={14} strokeWidth={1.75} />
                            </IconButton>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {activeRepo.remotes.length > 0 && (
                  <>
                    <div className="panel-disclosure-row">
                      <button
                        type="button"
                        className="panel-title panel-disclosure"
                        onClick={toggleRemoteBranches}
                      >
                        <span>Remote branches</span>
                        <span className="muted">
                          {remoteBranchesExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </span>
                      </button>
                    </div>
                    {remoteBranchesExpanded && (
                      <ul className="branch-list">
                        {remoteBranches.map((b) => {
                          const hasLocal = localBranchNames.has(b.shortName)
                          return (
                            <li
                              key={b.name}
                              onDoubleClick={() => void checkoutRemote(b.name)}
                              title={
                                hasLocal
                                  ? `Double-click to checkout local "${b.shortName}"`
                                  : 'Double-click to create local tracking branch and checkout'
                              }
                            >
                              <div className="branch-row-main">
                                <div className="cell-ellipsis">{b.name}</div>
                                {hasLocal && <div className="muted text-xs">local</div>}
                              </div>
                              <div className="branch-row-actions" onClick={(e) => e.stopPropagation()}>
                                <IconButton
                                  label={
                                    hasLocal
                                      ? `Checkout local ${b.shortName}`
                                      : `Checkout and track ${b.name}`
                                  }
                                  disabled={busy}
                                  onClick={() => void checkoutRemote(b.name)}
                                >
                                  <GitBranch size={14} strokeWidth={1.75} />
                                </IconButton>
                              </div>
                            </li>
                          )
                        })}
                        {remoteBranches.length === 0 && (
                          <li className="muted text-xs" style={{ pointerEvents: 'none' }}>
                            No remote branches — fetch to refresh
                          </li>
                        )}
                      </ul>
                    )}
                  </>
                )}
              </>
            )}
          </aside>

          <Splitter
            axis="x"
            className="splitter-sidebar"
            value={sidebarWidth}
            min={140}
            max={480}
            disabled={sidebarCollapsed}
            onChange={setSidebarWidth}
            onChangeEnd={(w) => persistLayout({ sidebarWidth: w })}
            title="Resize sidebar"
          />

          {viewMode === 'history' ? (
            <>
              <section className="history-pane">
                {error && <Banner>{error}</Banner>}
                <HistoryGraph
                  commits={commits}
                  graphBySha={graphBySha}
                  headSha={headSha}
                  selectedSha={selectedSha}
                  busy={busy}
                  loadingMore={historyLoadingMore}
                  hasMore={Boolean(nextCursor)}
                  onLoadMore={() => void loadMoreHistory()}
                  onSelect={selectCommit}
                  filter={prefs?.historyFilter || 'all'}
                  onFilterChange={(historyFilter) =>
                    void window.gitManager.prefs.set({ historyFilter }).then(setPrefs)
                  }
                  graphColWidth={historyGraphColWidth}
                  dateColWidth={historyDateColWidth}
                  authorColWidth={historyAuthorColWidth}
                  onGraphColWidthChange={setHistoryGraphColWidth}
                  onDateColWidthChange={setHistoryDateColWidth}
                  onAuthorColWidthChange={setHistoryAuthorColWidth}
                  onColumnWidthsCommit={(next) => persistLayout(next)}
                />
              </section>
              {showInspector && (
                <section className="detail-pane">
                  <div className="inspector-chrome">
                    <span className="muted">Inspector</span>
                    <IconButton
                      label={detailDock === 'right' ? 'Dock inspector bottom' : 'Dock inspector right'}
                      onClick={toggleDock}
                    >
                      {detailDock === 'right' ? (
                        <PanelBottom size={16} strokeWidth={1.75} />
                      ) : (
                        <PanelRight size={16} strokeWidth={1.75} />
                      )}
                    </IconButton>
                  </div>
                  <CommitDetailPane
                    detail={detail}
                    selectedFile={selectedFile}
                    diff={diff}
                    diffLoading={diffLoading}
                    onSelectFile={setSelectedFile}
                    sideBySide={sideBySideDiff}
                    busy={busy}
                    filesWidth={inspectorFilesWidth}
                    onFilesWidthChange={setInspectorFilesWidth}
                    onFilesWidthCommit={(w) => persistLayout({ inspectorFilesWidth: w })}
                    onMergeIntoCurrent={async (sha) => {
                      if (!confirm(`Merge commit ${sha.slice(0, 7)} into the current branch?`)) return
                      await runMergeOrRebase('merge', sha)
                    }}
                    onRebaseOnto={async (sha) => {
                      const cur = currentBranch?.name || activeRepo.currentBranch || 'HEAD'
                      if (!confirm(`Rebase "${cur}" onto ${sha.slice(0, 7)}?`)) return
                      await runMergeOrRebase('rebase', sha)
                    }}
                  />
                </section>
              )}
              {showInspector && detailDock === 'bottom' && (
                <Splitter
                  axis="y"
                  className="splitter-inspector-y"
                  value={inspectorHeight}
                  min={180}
                  max={Math.max(220, Math.floor(window.innerHeight * 0.7))}
                  reverse
                  onChange={setInspectorHeight}
                  onChangeEnd={(h) => persistLayout({ inspectorHeight: h })}
                  title="Resize inspector"
                />
              )}
              {showInspector && detailDock === 'right' && (
                <Splitter
                  axis="x"
                  className="splitter-detail-x"
                  value={detailWidth}
                  min={280}
                  max={Math.max(360, Math.floor(window.innerWidth * 0.6))}
                  reverse
                  onChange={setDetailWidth}
                  onChangeEnd={(w) => persistLayout({ detailWidth: w })}
                  title="Resize inspector"
                />
              )}
            </>
          ) : (
            <section className="changes-pane">
              {error && <Banner>{error}</Banner>}
              <WorkingTreeDetailPane
                repoPath={activeRepo.path}
                status={status}
                focusedPath={focusedStatusPath}
                diffSide={diffSide}
                diff={diff}
                diffLoading={diffLoading}
                identity={identity}
                canAmend={Boolean(headSha)}
                rebaseInProgress={rebaseInProgress}
                filesWidth={changesFilesWidth}
                onFilesWidthChange={setChangesFilesWidth}
                onFilesWidthCommit={(w) => persistLayout({ changesFilesWidth: w })}
                onFocusFile={setFocusedStatusPath}
                onDiffSideChange={setDiffSide}
                onRefresh={() => afterGitMutation({ history: 'tip' })}
                onError={setError}
                onBrowseHistory={goHistory}
                onEditIdentity={() => setIdentityOpen(true)}
                onRebaseContinue={async () => {
                  const result = await window.gitManager.git.rebaseContinue(activeRepo.path)
                  await afterGitMutation({ history: 'full' })
                  if (result.conflicts.length > 0) setMergeOpen(true)
                }}
                onRebaseAbort={async () => {
                  await window.gitManager.git.rebaseAbort(activeRepo.path)
                  await afterGitMutation({ history: 'full' })
                }}
              />
            </section>
          )}
        </div>
      )}

      {repoPendingRemove && (
        <ConfirmDialog
          title="Remove repository"
          message={`Remove “${repoPendingRemove.name}” from the list?`}
          checkboxLabel="Also delete files from disk"
          confirmLabel="Remove"
          confirmLabelChecked="Delete from disk"
          danger
          busy={repoRemoveBusy}
          error={repoRemoveError}
          onCancel={() => {
            if (repoRemoveBusy) return
            setRepoPendingRemove(null)
            setRepoRemoveError(null)
          }}
          onConfirm={({ checked }) => void removeRepoFromList(repoPendingRemove, checked)}
        />
      )}
      {accountsOpen && (
        <AccountsModal
          accounts={accounts}
          onClose={() => setAccountsOpen(false)}
          onChanged={async () => setAccounts(await window.gitManager.providers.listAccounts())}
          onCloneRemote={(repo: RemoteRepo) => {
            if (!requireGit()) return
            setAccountsOpen(false)
            setCloneOpen(true)
            sessionStorage.setItem('gm.cloneUrl', repo.cloneUrlHttps)
          }}
        />
      )}
      {cloneOpen && (
        <CloneModal
          onClose={() => setCloneOpen(false)}
          onCloned={async (repo) => {
            await refreshRepos()
            setActiveRepo(repo)
            setCloneOpen(false)
            setSelection(null)
            setViewMode('history')
          }}
        />
      )}
      {updatesOpen && (
        <UpdatesModal status={updateStatus} onClose={() => setUpdatesOpen(false)} onStatus={setUpdateStatus} />
      )}
      {aboutOpen && (
        <AboutModal status={updateStatus} onClose={() => setAboutOpen(false)} onStatus={setUpdateStatus} />
      )}
      {identityOpen && activeRepo && (
        <IdentityModal
          repoPath={activeRepo.path}
          onClose={() => setIdentityOpen(false)}
          onSaved={setIdentity}
        />
      )}
      {createBranchOpen && activeRepo && (
        <CreateBranchModal
          onClose={() => setCreateBranchOpen(false)}
          onCreate={async (name, checkout) => {
            await window.gitManager.git.createBranch(activeRepo.path, name, checkout)
            await afterGitMutation({ history: 'full' })
          }}
        />
      )}
      {mergePickOpen && activeRepo && (
        <BranchPickModal
          title="Merge branch"
          confirmVerb="Merge"
          description={`Merge the selected branch into ${currentBranch?.name || activeRepo.currentBranch || 'HEAD'}.`}
          branches={branches}
          onClose={() => setMergePickOpen(false)}
          onPick={async (name) => {
            await runMergeOrRebase('merge', name)
          }}
        />
      )}
      {rebasePickOpen && activeRepo && (
        <BranchPickModal
          title="Rebase onto"
          confirmVerb="Rebase"
          description={`Rebase ${currentBranch?.name || activeRepo.currentBranch || 'HEAD'} onto the selected branch.`}
          branches={branches}
          onClose={() => setRebasePickOpen(false)}
          onPick={async (name) => {
            await runMergeOrRebase('rebase', name)
          }}
        />
      )}
      {mergeOpen && activeRepo && (
        <MergeEditorModal
          repoPath={activeRepo.path}
          rebaseInProgress={rebaseInProgress}
          onClose={() => setMergeOpen(false)}
          onResolved={() => afterGitMutation({ history: 'full' })}
          onRebaseContinue={async () => {
            const result = await window.gitManager.git.rebaseContinue(activeRepo.path)
            await afterGitMutation({ history: 'full' })
            if (result.conflicts.length === 0) setMergeOpen(false)
          }}
          onRebaseAbort={async () => {
            await window.gitManager.git.rebaseAbort(activeRepo.path)
            await afterGitMutation({ history: 'full' })
          }}
        />
      )}
    </div>
  )
}
