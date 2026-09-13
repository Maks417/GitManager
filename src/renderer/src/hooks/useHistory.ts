import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  Commit,
  CommitDetail,
  DiffResult,
  FileChange,
  GraphNode,
  HistoryQuery,
  RemoteBranchInfo,
  Repository
} from '@shared/ipc'
import { HISTORY_PAGE_SIZE } from '@shared/layout-defaults'
import { decorateCommitsWithColors, layoutCommitGraph } from '@history-core/layout'
import { toErrorMessage } from '../lib/errors'
import { runWithBusy } from '../lib/useAsyncAction'
import type { Selection, ViewMode } from './selection'

/** Build a history IPC payload; branch filter expression is centralized here. */
export function buildHistoryQuery(opts: {
  repoPath: string
  search?: string
  currentBranch?: string | null
  historyFilter?: 'all' | 'current'
  /** When paginating: cursor for --all, skip for branch filter. */
  nextCursor?: string | null
  commitsLoaded?: number
  paginate?: boolean
}): HistoryQuery {
  const branchFilter =
    opts.historyFilter === 'current' ? opts.currentBranch || undefined : undefined
  return {
    repoPath: opts.repoPath,
    search: opts.search || undefined,
    limit: HISTORY_PAGE_SIZE,
    branch: branchFilter,
    ...(opts.paginate
      ? {
          cursor: branchFilter ? undefined : opts.nextCursor || undefined,
          skip: branchFilter ? opts.commitsLoaded : undefined
        }
      : {})
  }
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
  refreshRepoMeta: (repo: Repository) => Promise<void>
}

function sameRepoPath(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
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
  loadHistory: (repo: Repository, searchText?: string) => Promise<void>
  loadMoreHistory: () => Promise<void>
  refreshHistoryTip: (repo: Repository) => Promise<void>
} {
  const [commits, setCommits] = useState<Commit[]>([])
  const [graph, setGraph] = useState<GraphNode[]>([])
  const [headSha, setHeadSha] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)

  /** Path that currently owns `commits` / selection history state. */
  const commitsRepoPathRef = useRef<string | null>(null)
  /** Latest active repo path — used to drop stale async history responses. */
  const activePathRef = useRef<string | null>(null)
  activePathRef.current = activeRepo?.path ?? null

  const isCurrentRepo = useCallback((repoPath: string): boolean => {
    return sameRepoPath(activePathRef.current, repoPath)
  }, [])

  const loadHistory = useCallback(
    async (repo: Repository, searchText = search) => {
      const repoPath = repo.path
      await runWithBusy(
        async () => {
          const page = await window.gitManager.history.load(
            buildHistoryQuery({
              repoPath,
              search: searchText,
              currentBranch: repo.currentBranch,
              historyFilter
            })
          )
          if (!isCurrentRepo(repoPath)) return
          commitsRepoPathRef.current = repoPath
          setCommits(page.commits)
          setGraph(page.graph)
          setHeadSha(page.headSha)
          setNextCursor(page.nextCursor)
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
        },
        { setBusy, setError }
      )
    },
    [historyFilter, search, setBusy, setError, setSelection, setViewMode, isCurrentRepo]
  )

  const loadMoreHistory = useCallback(async (): Promise<void> => {
    if (!activeRepo || !nextCursor || historyLoadingMore || busy) return
    const repoPath = activeRepo.path
    await runWithBusy(
      async () => {
        const page = await window.gitManager.history.load(
          buildHistoryQuery({
            repoPath,
            search,
            currentBranch: activeRepo.currentBranch,
            historyFilter,
            nextCursor,
            commitsLoaded: commits.length,
            paginate: true
          })
        )
        if (!isCurrentRepo(repoPath)) return
        setCommits((prev) => {
          const seen = new Set(prev.map((c) => c.sha))
          const appended = page.commits.filter((c) => !seen.has(c.sha))
          const merged = decorateCommitsWithColors([...prev, ...appended])
          setGraph(layoutCommitGraph(merged))
          return merged
        })
        setHeadSha(page.headSha)
        setNextCursor(page.nextCursor)
      },
      { setBusy: setHistoryLoadingMore, setError }
    )
  }, [
    activeRepo,
    nextCursor,
    historyLoadingMore,
    busy,
    historyFilter,
    search,
    commits.length,
    setError,
    isCurrentRepo
  ])

  const refreshHistoryTip = useCallback(
    async (repo: Repository): Promise<void> => {
      const repoPath = repo.path
      try {
        const page = await window.gitManager.history.load(
          buildHistoryQuery({
            repoPath,
            search,
            currentBranch: repo.currentBranch,
            historyFilter
          })
        )
        if (!isCurrentRepo(repoPath)) return

        setCommits((prev) => {
          const sameOwner = sameRepoPath(commitsRepoPathRef.current, repoPath)
          const tipShas = new Set(page.commits.map((c) => c.sha))
          // Never merge tips from another repository into the visible history.
          const older = sameOwner ? prev.filter((c) => !tipShas.has(c.sha)) : []
          const merged = decorateCommitsWithColors([...page.commits, ...older])
          commitsRepoPathRef.current = repoPath
          setGraph(layoutCommitGraph(merged))
          setSelection((sel) => {
            if (sel?.kind === 'working-copy') return sel
            if (sel?.kind === 'commit' && merged.some((c) => c.sha === sel.sha)) return sel
            const nextSha = page.commits[0]?.sha || null
            if (nextSha) return { kind: 'commit', sha: nextSha }
            return { kind: 'working-copy' }
          })
          return merged
        })
        setHeadSha(page.headSha)
        // Keep existing nextCursor / loaded depth; tip refresh only updates the newest window.
        if (!nextCursor) setNextCursor(page.nextCursor)
      } catch (err) {
        if (!isCurrentRepo(repoPath)) return
        setError(toErrorMessage(err))
      }
    },
    [historyFilter, search, nextCursor, setError, setSelection, isCurrentRepo]
  )

  useEffect(() => {
    if (!activeRepo) {
      commitsRepoPathRef.current = null
      return
    }
    // Drop prior-repo selection/history immediately so commit-detail cannot race
    // against a SHA that does not exist in the newly selected repository.
    commitsRepoPathRef.current = null
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
    // Match prior App deps (path + filter only) to avoid extra reloads.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [activeRepo?.path, historyFilter])

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
    loadHistory,
    loadMoreHistory,
    refreshHistoryTip
  }
}
