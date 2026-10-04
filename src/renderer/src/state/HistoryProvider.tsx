import { createContext, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import type { Commit, GraphNode, Repository } from '@shared/ipc'
import { useHistory } from '../hooks/useHistory'
import { useLatestRef } from '../hooks/useLatestRef'
import { branchNotOnCurrentBranch, branchTipTooDeep, COMMIT_TOO_DEEP } from '../lib/copy'
import { useAppStatus, useAppStatusActions } from './AppStatusProvider'
import { useRequiredContext } from './context'
import { useLayoutPrefsState } from './LayoutProvider'
import { useSession, useSessionActions } from './RepoSessionProvider'
import { useSelectionActions, useSelectionCore } from './SelectionProvider'

/** A commit for the history list to scroll into view. */
export interface RevealRequest {
  sha: string
  /** Grows with every request, so jumping to the same commit again scrolls again. */
  seq: number
}

export interface HistoryState {
  commits: Commit[]
  graphBySha: Map<string, GraphNode>
  maxLane: number
  headSha: string | null
  nextCursor: string | null
  historyLoadingMore: boolean
  /** Text in the search box; it applies only once submitted. */
  search: string
  /** Branches the applied `branch:` search selected; null without one. */
  branchFilter: string[] | null
  /** Why the list is empty or narrower than asked, when that needs saying. */
  notice: string | null
  /** The commit the list should scroll to next. */
  revealRequest: RevealRequest | null
}

export interface HistoryActions {
  loadHistory: (repo: Repository, searchText?: string) => Promise<unknown>
  loadMoreHistory: () => Promise<void>
  refreshHistoryTip: (repo: Repository) => Promise<void>
  setSearch: (text: string) => void
  /** Search the active repository's history for `text`, by default the text in the search box. */
  submitSearch: (text?: string) => void
  /** Show only the history of one local or remote-tracking branch, with its tip selected. */
  showBranchHistory: (name: string, tipSha?: string | null) => Promise<void>
  /**
   * Select a commit and scroll to it, loading history down to it when it is not loaded. When the list
   * cannot reach it, the history of `branch` is shown instead, if given.
   */
  revealCommit: (sha: string, branch?: string) => Promise<void>
  /** Open an immutable commit even when no branch reaches it, using a SHA search. */
  inspectCommit: (sha: string) => Promise<void>
  /** The list calls this once it has scrolled to a reveal request. */
  finishReveal: (seq: number) => void
  searchInputRef: React.RefObject<HTMLInputElement | null>
}

const HistoryContext = createContext<HistoryState | null>(null)
const HistoryActionsContext = createContext<HistoryActions | null>(null)

export function HistoryProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { busy } = useAppStatus()
  const { setBusy, setError } = useAppStatusActions()
  const { prefs } = useLayoutPrefsState()
  const { activeRepo } = useSession()
  const { selection } = useSelectionCore()
  const { setSelection, setViewMode, setDetail, setSelectedFile, setDiff, setFocusedStatusPath } =
    useSelectionActions()
  const { setRemoteBranches, refreshRepoMeta, historyFnsRef, getActiveRepo } = useSessionActions()
  const [search, setSearch] = useState('')
  const [revealRequest, setRevealRequest] = useState<RevealRequest | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const revealSeqRef = useRef(0)
  // Actions read the selection without being re-created whenever it changes.
  const selectionRef = useLatestRef(selection)
  const historyFilter = prefs?.historyFilter

  const {
    commits,
    graphBySha,
    maxLane,
    headSha,
    nextCursor,
    historyLoadingMore,
    branchFilter,
    notice,
    setNotice,
    hasCommit,
    loadHistory,
    loadMoreHistory,
    refreshHistoryTip
  } = useHistory({
    activeRepo,
    search,
    historyFilter,
    busy,
    setBusy,
    setError,
    setSelection,
    setViewMode,
    setDetail,
    setSelectedFile,
    setDiff,
    setRemoteBranches,
    refreshRepoMeta
  })

  // Session refreshes (after Git actions and watcher events) reload history through this bridge.
  useLayoutEffect(() => {
    historyFnsRef.current = { loadHistory, refreshHistoryTip }
  }, [historyFnsRef, loadHistory, refreshHistoryTip])

  const submitSearch = useCallback(
    (text?: string): void => {
      if (activeRepo) void loadHistory(activeRepo, text ?? search)
    },
    [activeRepo, loadHistory, search]
  )

  /** Select a loaded commit in the history view and ask the list to scroll to it. */
  const showCommit = useCallback(
    (sha: string): void => {
      setViewMode('history')
      const current = selectionRef.current
      // Re-selecting the selected commit must keep its diff: nothing would load it again.
      if (!(current?.kind === 'commit' && current.sha === sha)) {
        setSelection({ kind: 'commit', sha })
        setFocusedStatusPath(null)
        setDiff(null)
      }
      revealSeqRef.current += 1
      setRevealRequest({ sha, seq: revealSeqRef.current })
    },
    [selectionRef, setViewMode, setSelection, setFocusedStatusPath, setDiff]
  )

  const inspectCommit = useCallback(async (sha: string): Promise<void> => {
    const repo = getActiveRepo()
    if (!repo) return
    const page = await loadHistory(repo, sha)
    if (!page?.commits.some((commit) => commit.sha === sha)) return
    setSearch(sha)
    showCommit(sha)
  }, [getActiveRepo, loadHistory, showCommit])

  const revealCommit = useCallback(
    async (sha: string, branch?: string): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      if (hasCommit(sha)) {
        showCommit(sha)
        return
      }
      // Not loaded, or hidden by the search: walk the unsearched list down to it.
      const page = await loadHistory(repo, '', { revealSha: sha })
      if (!page) return
      if (page.revealed) {
        setSearch('')
        showCommit(sha)
        return
      }
      if (!branch) {
        setError(COMMIT_TOO_DEEP)
        return
      }
      const filter = `branch:${branch}`
      const filtered = await loadHistory(repo, filter)
      if (!filtered) return
      setSearch(filter)
      if (filtered.commits.some((c) => c.sha === sha)) showCommit(sha)
      setNotice(historyFilter === 'current' ? branchNotOnCurrentBranch(branch) : branchTipTooDeep(branch))
    },
    [getActiveRepo, hasCommit, showCommit, loadHistory, setError, setNotice, historyFilter]
  )

  const showBranchHistory = useCallback(
    async (name: string, tipSha?: string | null): Promise<void> => {
      const repo = getActiveRepo()
      if (!repo) return
      const filter = `branch:${name}`
      setSearch(filter)
      setViewMode('history')
      const page = await loadHistory(repo, filter)
      if (!page) return
      const tip = tipSha && page.commits.some((c) => c.sha === tipSha) ? tipSha : page.commits[0]?.sha
      if (tip) showCommit(tip)
    },
    [getActiveRepo, loadHistory, showCommit, setViewMode]
  )

  const finishReveal = useCallback((seq: number): void => {
    setRevealRequest((current) => (current?.seq === seq ? null : current))
  }, [])

  const state = useMemo<HistoryState>(
    () => ({
      commits,
      graphBySha,
      maxLane,
      headSha,
      nextCursor,
      historyLoadingMore,
      search,
      branchFilter,
      notice,
      revealRequest
    }),
    [
      commits,
      graphBySha,
      maxLane,
      headSha,
      nextCursor,
      historyLoadingMore,
      search,
      branchFilter,
      notice,
      revealRequest
    ]
  )

  const actions = useMemo<HistoryActions>(
    () => ({
      loadHistory,
      loadMoreHistory,
      refreshHistoryTip,
      setSearch,
      submitSearch,
      showBranchHistory,
      revealCommit,
      inspectCommit,
      finishReveal,
      searchInputRef
    }),
    [loadHistory, loadMoreHistory, refreshHistoryTip, submitSearch, showBranchHistory, revealCommit, inspectCommit, finishReveal]
  )

  return (
    <HistoryActionsContext.Provider value={actions}>
      <HistoryContext.Provider value={state}>{children}</HistoryContext.Provider>
    </HistoryActionsContext.Provider>
  )
}

export const useHistoryState = (): HistoryState => useRequiredContext(HistoryContext, 'useHistoryState')

export const useHistoryActions = (): HistoryActions =>
  useRequiredContext(HistoryActionsContext, 'useHistoryActions')
