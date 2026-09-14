import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Commit,
  CommitDetail,
  DiffResult,
  FileChange,
  GraphNode,
  HistoryPage,
  HistoryQuery,
  RemoteBranchInfo,
  Repository
} from '@shared/ipc'
import { HISTORY_PAGE_SIZE } from '@shared/layout-defaults'
import { decorateCommitsWithColors, layoutCommitGraph } from '@history-core/layout'
import { mergeTipPage } from '@history-core/tip-merge'
import { toErrorMessage } from '../lib/errors'
import { sameRepoPath } from '../lib/paths'
import { runWithBusy } from '../lib/useAsyncAction'
import type { Selection, ViewMode } from './selection'

/** Build a history IPC payload; branch filter expression is centralized here. */
export function buildHistoryQuery(opts: {
  repoPath: string
  search?: string
  currentBranch?: string | null
  historyFilter?: 'all' | 'current'
  /** Commits already shown; the next page starts after them. */
  skip?: number
  /** Load from the top down to this commit, and a page past it. */
  revealSha?: string
}): HistoryQuery {
  const branchFilter =
    opts.historyFilter === 'current' ? opts.currentBranch || undefined : undefined
  return {
    repoPath: opts.repoPath,
    search: opts.search || undefined,
    limit: HISTORY_PAGE_SIZE,
    branch: branchFilter,
    skip: opts.skip || undefined,
    revealSha: opts.revealSha
  }
}

export interface LoadHistoryOptions {
  /** Load down to this commit. When it is not found, the list stays as it was. */
  revealSha?: string
}

type UseHistoryArgs = {
  activeRepo: Repository | null
  search: string
  historyFilter: 'all' | 'current' | undefined
  busy: boolean
  setBusy: (busy: boolean) => void
  setError: (msg: string | null) => void
  setSelection: React.Dispatch<React.SetStateAction<Selection | null>>
  setViewMode: React.Dispatch<React.SetStateAction<ViewMode>>
  setDetail: React.Dispatch<React.SetStateAction<CommitDetail | null>>
  setSelectedFile: React.Dispatch<React.SetStateAction<FileChange | null>>
  setDiff: React.Dispatch<React.SetStateAction<DiffResult | null>>
  setRemoteBranches: React.Dispatch<React.SetStateAction<RemoteBranchInfo[]>>
  refreshRepoMeta: (repo: Repository) => Promise<Repository>
}

export function useHistory({
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
}: UseHistoryArgs): {
  commits: Commit[]
  graph: GraphNode[]
  graphBySha: Map<string, GraphNode>
  headSha: string | null
  nextCursor: string | null
  historyLoadingMore: boolean
  /** Branches the applied `branch:` search selected; null without one. */
  branchFilter: string[] | null
  /** Why the list is empty or narrower than asked, when that needs saying. */
  notice: string | null
  setNotice: React.Dispatch<React.SetStateAction<string | null>>
  /** Whether the list shown for the active repository contains this commit. */
  hasCommit: (sha: string) => boolean
  loadHistory: (
    repo: Repository,
    searchText?: string,
    options?: LoadHistoryOptions
  ) => Promise<HistoryPage | undefined>
  loadMoreHistory: () => Promise<void>
  refreshHistoryTip: (repo: Repository) => Promise<void>
} {
  const [commits, setCommits] = useState<Commit[]>([])
  const [graph, setGraph] = useState<GraphNode[]>([])
  const [headSha, setHeadSha] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)
  const [branchFilter, setBranchFilter] = useState<string[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Path that currently owns `commits` / selection history state. */
  const commitsRepoPathRef = useRef<string | null>(null)
  /** Latest active repo path — used to drop stale async history responses. */
  const activePathRef = useRef<string | null>(null)
  activePathRef.current = activeRepo?.path ?? null
  const commitsRef = useRef<Commit[]>(commits)
  commitsRef.current = commits
  /** Search that produced the visible list. Paging and refreshes reuse it, not unsubmitted text. */
  const appliedSearchRef = useRef(search)
  /** Repository whose branches/status were last requested by the load effect. */
  const metaPathRef = useRef<string | null>(null)

  const isCurrentRepo = useCallback((repoPath: string): boolean => {
    return sameRepoPath(activePathRef.current, repoPath)
  }, [])

  const hasCommit = useCallback(
    (sha: string): boolean =>
      sameRepoPath(commitsRepoPathRef.current, activePathRef.current) &&
      commitsRef.current.some((c) => c.sha === sha),
    []
  )

  const loadHistory = useCallback(
    async (
      repo: Repository,
      searchText: string = appliedSearchRef.current,
      options: LoadHistoryOptions = {}
    ): Promise<HistoryPage | undefined> => {
      const repoPath = repo.path
      return runWithBusy(
        async () => {
          const page = await window.gitManager.history.load(
            buildHistoryQuery({
              repoPath,
              search: searchText,
              currentBranch: repo.currentBranch,
              historyFilter,
              revealSha: options.revealSha
            })
          )
          if (!isCurrentRepo(repoPath)) return undefined
          // A jump that did not find its commit changes nothing; the caller decides what to show.
          if (options.revealSha && !page.revealed) return page
          appliedSearchRef.current = searchText
          commitsRepoPathRef.current = repoPath
          commitsRef.current = page.commits
          setCommits(page.commits)
          setGraph(page.graph)
          setHeadSha(page.headSha)
          setNextCursor(page.nextCursor)
          setBranchFilter(page.branches ?? null)
          setNotice(page.notice ?? null)
          setSelection((prev) => {
            if (prev?.kind === 'working-copy') return prev
            const keep =
              prev?.kind === 'commit' ? page.commits.find((c) => c.sha === prev.sha)?.sha : null
            const nextSha = keep || page.commits[0]?.sha || null
            if (nextSha) return { kind: 'commit', sha: nextSha }
            return { kind: 'working-copy' }
          })
          if (!page.headSha && page.commits.length === 0) setViewMode('changes')
          setError(null)
          return page
        },
        { setBusy, setError }
      )
    },
    [historyFilter, setBusy, setError, setSelection, setViewMode, isCurrentRepo]
  )

  const loadMoreHistory = useCallback(async (): Promise<void> => {
    if (!activeRepo || !nextCursor || historyLoadingMore || busy) return
    const repoPath = activeRepo.path
    await runWithBusy(
      async () => {
        const loaded = commitsRef.current
        const page = await window.gitManager.history.load(
          buildHistoryQuery({
            repoPath,
            search: appliedSearchRef.current,
            currentBranch: activeRepo.currentBranch,
            historyFilter,
            skip: loaded.length
          })
        )
        // A refresh replaced the list meanwhile: this page's offset no longer applies.
        if (!isCurrentRepo(repoPath) || commitsRef.current !== loaded) return
        const seen = new Set(loaded.map((c) => c.sha))
        const merged = decorateCommitsWithColors([
          ...loaded,
          ...page.commits.filter((c) => !seen.has(c.sha))
        ])
        commitsRef.current = merged
        setCommits(merged)
        setGraph(layoutCommitGraph(merged))
        setHeadSha(page.headSha)
        setNextCursor(page.nextCursor)
      },
      { setBusy: setHistoryLoadingMore, setError }
    )
  }, [activeRepo, nextCursor, historyLoadingMore, busy, historyFilter, setError, isCurrentRepo])

  const refreshHistoryTip = useCallback(
    async (repo: Repository): Promise<void> => {
      const repoPath = repo.path
      try {
        const page = await window.gitManager.history.load(
          buildHistoryQuery({
            repoPath,
            search: appliedSearchRef.current,
            currentBranch: repo.currentBranch,
            historyFilter
          })
        )
        if (!isCurrentRepo(repoPath)) return

        // Never merge tips from another repository into the visible history.
        const loaded = sameRepoPath(commitsRepoPathRef.current, repoPath) ? commitsRef.current : []
        // null when history was rewritten (amend, rebase, reset, pruned branches): replace, don't splice.
        const spliced = mergeTipPage(loaded, page.commits, page.nextCursor !== null)
        const next = decorateCommitsWithColors(spliced ?? page.commits)
        commitsRepoPathRef.current = repoPath
        commitsRef.current = next
        setCommits(next)
        setGraph(layoutCommitGraph(next))
        setSelection((sel) => {
          if (sel?.kind === 'working-copy') return sel
          if (sel?.kind === 'commit' && next.some((c) => c.sha === sel.sha)) return sel
          const nextSha = page.commits[0]?.sha || null
          if (nextSha) return { kind: 'commit', sha: nextSha }
          return { kind: 'working-copy' }
        })
        setHeadSha(page.headSha)
        setBranchFilter(page.branches ?? null)
        setNotice(page.notice ?? null)
        // Splicing keeps the loaded depth; a replaced list pages on from the fresh first page.
        setNextCursor((prev) => {
          if (page.nextCursor === null) return null
          return spliced && loaded.length > 0 ? prev : page.nextCursor
        })
      } catch (err) {
        if (!isCurrentRepo(repoPath)) return
        setError(toErrorMessage(err))
      }
    },
    [historyFilter, setError, setSelection, isCurrentRepo]
  )

  // With the "Current branch" filter, switching branches (here or outside the app) reloads the list.
  const branchKey = historyFilter === 'current' ? (activeRepo?.currentBranch ?? null) : null

  useEffect(() => {
    if (!activeRepo) {
      commitsRepoPathRef.current = null
      metaPathRef.current = null
      return
    }
    // Drop prior-repo selection/history immediately so commit-detail cannot race
    // against a SHA that does not exist in the newly selected repository.
    commitsRepoPathRef.current = null
    commitsRef.current = []
    setCommits([])
    setGraph([])
    setHeadSha(null)
    setNextCursor(null)
    setBranchFilter(null)
    setNotice(null)
    setSelection(null)
    setDetail(null)
    setSelectedFile(null)
    setDiff(null)
    void loadHistory(activeRepo, search)
    if (metaPathRef.current !== activeRepo.path) {
      metaPathRef.current = activeRepo.path
      setRemoteBranches([])
      void refreshRepoMeta(activeRepo)
    }
    // Reload on repository, filter or (filtered) branch changes only — not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [activeRepo?.path, historyFilter, branchKey])

  const graphBySha = useMemo(() => {
    const map = new Map<string, GraphNode>()
    for (const g of graph) map.set(g.sha, g)
    return map
  }, [graph])

  return {
    commits,
    graph,
    graphBySha,
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
  }
}
