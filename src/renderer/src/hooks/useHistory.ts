import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
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
import {
  appendLayoutCommitGraph,
  decorateCommitsWithColors,
  layoutCommitGraphWithCheckpoint,
  type LayoutCheckpoint
} from '@history-core/layout'
import { mergeTipPage, reuseLoadedCommits, sameCommitList } from '@history-core/tip-merge'
import { searchSkipsCommits } from '@shared/history-query'
import { toErrorMessage } from '../lib/errors'
import { sameRepoPath } from '../lib/paths'
import { runWithBusy } from '../lib/useAsyncAction'
import { selectionForNewRepository } from '../logic/new-repo-selection'
import type { Selection, ViewMode } from './selection'
import { useLatestRef } from './useLatestRef'

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

/**
 * The list a repository shows: all branches, or with the "Current branch" filter the branch checked out.
 * History loaded under another key is never shown, so switching repository or branch needs no reset.
 */
export function historyListKey(
  repo: Pick<Repository, 'path' | 'currentBranch'> | null,
  historyFilter: 'all' | 'current' | undefined
): string | null {
  if (!repo) return null
  const path = repo.path.replace(/\\/g, '/').toLowerCase()
  return historyFilter === 'current' ? `${path}\0branch\0${repo.currentBranch ?? ''}` : `${path}\0all`
}

export interface LoadHistoryOptions {
  /** Load down to this commit. When it is not found, the list stays as it was. */
  revealSha?: string
}

interface HistoryList {
  key: string
  commits: Commit[]
  graph: GraphNode[]
  /** Lane wait map after `graph`, so load-more can append without a full relayout. */
  layoutCheckpoint: LayoutCheckpoint
  maxLane: number
  /** A search that skips commits: drawn as one column of dots (see `LayoutOptions.unlinked`). */
  unlinked: boolean
  headSha: string | null
  nextCursor: string | null
  branchFilter: string[] | null
  notice: string | null
}

const NO_COMMITS: Commit[] = []
const NO_GRAPH: GraphNode[] = []

type UseHistoryArgs = {
  activeRepo: Repository | null
  search: string
  historyFilter: 'all' | 'current' | undefined
  busy: boolean
  /** The view shown; a new repository keeps the working copy selected in Changes. */
  viewMode: ViewMode
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
  viewMode,
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
  maxLane: number
  headSha: string | null
  nextCursor: string | null
  historyLoadingMore: boolean
  /** Branches the applied `branch:` search selected; null without one. */
  branchFilter: string[] | null
  /** Why the list is empty or narrower than asked, when that needs saying. */
  notice: string | null
  setNotice: (notice: string | null) => void
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
  const [list, setList] = useState<HistoryList | null>(null)
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false)

  const listKey = historyListKey(activeRepo, historyFilter)
  const shown = list && list.key === listKey ? list : null

  /** The list as last written, for callbacks that page or splice into it after an await. */
  const listRef = useRef<HistoryList | null>(null)
  const listKeyRef = useLatestRef(listKey)
  /** Latest active repo path — used to drop responses for a repository that is no longer open. */
  const activePathRef = useLatestRef(activeRepo?.path ?? null)
  /** Search that produced the visible list. Paging and refreshes reuse it, not unsubmitted text. */
  const appliedSearchRef = useRef(search)
  /** Grows with every load that replaces the list: an older load, or a tip refresh started before it, must not apply. */
  const loadSeqRef = useRef(0)
  /** Lists with a load running, so a key change does not start a second, identical load. */
  const loadingKeysRef = useRef(new Map<string, number>())
  /** Repository whose branches the key-change effect last requested. */
  const metaPathRef = useRef<string | null>(null)

  const writeList = useCallback((next: HistoryList): void => {
    listRef.current = next
    setList(next)
  }, [])

  const isCurrentRepo = useCallback(
    (repoPath: string): boolean => sameRepoPath(activePathRef.current, repoPath),
    [activePathRef]
  )

  const hasCommit = useCallback(
    (sha: string): boolean => {
      const current = listRef.current
      return Boolean(current && current.key === listKeyRef.current && current.commits.some((c) => c.sha === sha))
    },
    [listKeyRef]
  )

  const setNotice = useCallback(
    (notice: string | null): void => {
      const current = listRef.current
      if (current) writeList({ ...current, notice })
    },
    [writeList]
  )

  const loadHistory = useCallback(
    async (
      repo: Repository,
      searchText: string = appliedSearchRef.current,
      options: LoadHistoryOptions = {}
    ): Promise<HistoryPage | undefined> => {
      const key = historyListKey(repo, historyFilter)
      if (!key) return undefined
      const reveal = Boolean(options.revealSha)
      // A jump may find nothing and change nothing, so only its success replaces other loads.
      const seq = reveal ? loadSeqRef.current : ++loadSeqRef.current
      const loading = loadingKeysRef.current
      loading.set(key, (loading.get(key) ?? 0) + 1)
      try {
        return await runWithBusy(
          async () => {
            const page = await window.gitManager.history.load(
              buildHistoryQuery({
                repoPath: repo.path,
                search: searchText,
                currentBranch: repo.currentBranch,
                historyFilter,
                revealSha: options.revealSha
              })
            )
            if (!isCurrentRepo(repo.path)) return undefined
            // A jump that did not find its commit changes nothing; the caller decides what to show.
            if (reveal && !page.revealed) return page
            // A newer search or reload started meanwhile; its result replaces this one.
            if (seq !== loadSeqRef.current) return undefined
            if (reveal) loadSeqRef.current++
            appliedSearchRef.current = searchText
            const unlinked = searchSkipsCommits(searchText)
            const laidOut = layoutCommitGraphWithCheckpoint(page.commits, { unlinked })
            writeList({
              key,
              commits: page.commits,
              graph: laidOut.nodes,
              layoutCheckpoint: laidOut.checkpoint,
              maxLane: laidOut.maxLane,
              unlinked,
              headSha: page.headSha,
              nextCursor: page.nextCursor,
              branchFilter: page.branches ?? null,
              notice: page.notice ?? null
            })
            setSelection((prev) => {
              if (prev?.kind === 'working-copy') return prev
              if (prev?.kind === 'commit' && page.commits.some((c) => c.sha === prev.sha)) return prev
              const first = page.commits[0]?.sha
              return first ? { kind: 'commit', sha: first } : { kind: 'working-copy' }
            })
            if (!page.headSha && page.commits.length === 0) setViewMode('changes')
            setError(null)
            return page
          },
          { setBusy, setError }
        )
      } finally {
        const left = (loading.get(key) ?? 1) - 1
        if (left > 0) loading.set(key, left)
        else loading.delete(key)
      }
    },
    [historyFilter, isCurrentRepo, setBusy, setError, setSelection, setViewMode, writeList]
  )

  const loadMoreHistory = useCallback(async (): Promise<void> => {
    const loaded = listRef.current
    if (!activeRepo || !loaded || loaded.key !== listKey || !loaded.nextCursor || historyLoadingMore || busy) {
      return
    }
    const repoPath = activeRepo.path
    await runWithBusy(
      async () => {
        const page = await window.gitManager.history.load(
          buildHistoryQuery({
            repoPath,
            search: appliedSearchRef.current,
            currentBranch: activeRepo.currentBranch,
            historyFilter,
            skip: loaded.commits.length
          })
        )
        // A refresh replaced the list meanwhile: this page's offset no longer applies.
        if (!isCurrentRepo(repoPath) || listRef.current !== loaded) return
        const seen = new Set(loaded.commits.map((c) => c.sha))
        const appended = decorateCommitsWithColors(
          page.commits.filter((c) => !seen.has(c.sha)),
          loaded.commits
        )
        const laidOut = appendLayoutCommitGraph(loaded.layoutCheckpoint, appended, { unlinked: loaded.unlinked })
        writeList({
          ...loaded,
          commits: [...loaded.commits, ...appended],
          graph: [...loaded.graph, ...laidOut.nodes],
          layoutCheckpoint: laidOut.checkpoint,
          maxLane: Math.max(loaded.maxLane, laidOut.maxLane),
          headSha: page.headSha,
          nextCursor: page.nextCursor
        })
      },
      { setBusy: setHistoryLoadingMore, setError }
    )
  }, [activeRepo, listKey, historyLoadingMore, busy, historyFilter, isCurrentRepo, setError, writeList])

  const refreshHistoryTip = useCallback(
    async (repo: Repository): Promise<void> => {
      const key = historyListKey(repo, historyFilter)
      // Another branch or repository is being shown (a checkout with "Current branch", say): the full
      // load of its list replaces this one, so there is nothing to splice into.
      if (!key || listRef.current?.key !== key) return
      const seq = loadSeqRef.current
      try {
        const page = await window.gitManager.history.load(
          buildHistoryQuery({
            repoPath: repo.path,
            search: appliedSearchRef.current,
            currentBranch: repo.currentBranch,
            historyFilter
          })
        )
        // A load that started meanwhile replaces the list with fresher results.
        if (!isCurrentRepo(repo.path) || seq !== loadSeqRef.current) return

        // Never splice another repository's or branch's tips into the visible history.
        const current = listRef.current
        const loaded = current?.key === key ? current.commits : []
        // null when history was rewritten (amend, rebase, reset, pruned branches): replace, don't splice.
        const spliced = mergeTipPage(loaded, page.commits, page.nextCursor !== null)
        // Unchanged commits keep their objects, so their rows do not render again.
        const commits = reuseLoadedCommits(spliced ?? page.commits, loaded)
        // Splicing keeps the loaded depth; a replaced list pages on from the fresh first page.
        const nextCursor =
          page.nextCursor === null
            ? null
            : spliced && loaded.length > 0
              ? (current?.nextCursor ?? null)
              : page.nextCursor
        const unchanged =
          current !== null &&
          sameCommitList(commits, loaded) &&
          current.headSha === page.headSha &&
          current.nextCursor === nextCursor &&
          current.notice === (page.notice ?? null) &&
          (current.branchFilter ?? []).join('\n') === (page.branches ?? []).join('\n')
        if (!unchanged) {
          const unlinked = current?.unlinked ?? searchSkipsCommits(appliedSearchRef.current)
          // Tip splice/rewrite can change the prefix topology, so relayout from scratch.
          const laidOut = layoutCommitGraphWithCheckpoint(commits, { unlinked })
          writeList({
            key,
            commits,
            graph: laidOut.nodes,
            layoutCheckpoint: laidOut.checkpoint,
            maxLane: laidOut.maxLane,
            unlinked,
            headSha: page.headSha,
            branchFilter: page.branches ?? null,
            notice: page.notice ?? null,
            nextCursor
          })
        }
        setSelection((sel) => {
          if (sel?.kind === 'working-copy') return sel
          if (sel?.kind === 'commit' && commits.some((c) => c.sha === sel.sha)) return sel
          const first = page.commits[0]?.sha
          return first ? { kind: 'commit', sha: first } : { kind: 'working-copy' }
        })
      } catch (err) {
        if (!isCurrentRepo(repo.path)) return
        setError(toErrorMessage(err))
      }
    },
    [historyFilter, isCurrentRepo, setError, setSelection, writeList]
  )

  // Loads the list of a new key: another repository, another filter, or (filtered) another branch.
  const onListKeyChange = useEffectEvent((key: string | null): void => {
    if (!activeRepo || !key) {
      metaPathRef.current = null
      return
    }
    if (!sameRepoPath(metaPathRef.current, activeRepo.path)) {
      // Nothing selected in the previous repository exists in this one.
      metaPathRef.current = activeRepo.path
      setSelection(selectionForNewRepository(viewMode))
      setDetail(null)
      setSelectedFile(null)
      setDiff(null)
      setRemoteBranches([])
      void refreshRepoMeta(activeRepo)
    }
    // The Git action that changed the branch may be loading this list already.
    if (!loadingKeysRef.current.has(key)) void loadHistory(activeRepo, search)
  })

  useEffect(() => {
    onListKeyChange(listKey)
  }, [listKey])

  const graph = shown?.graph ?? NO_GRAPH
  const graphBySha = useMemo(() => {
    const map = new Map<string, GraphNode>()
    for (const g of graph) map.set(g.sha, g)
    return map
  }, [graph])

  return {
    commits: shown?.commits ?? NO_COMMITS,
    graph,
    graphBySha,
    maxLane: shown?.maxLane ?? 0,
    headSha: shown?.headSha ?? null,
    nextCursor: shown?.nextCursor ?? null,
    historyLoadingMore,
    branchFilter: shown?.branchFilter ?? null,
    notice: shown?.notice ?? null,
    setNotice,
    hasCommit,
    loadHistory,
    loadMoreHistory,
    refreshHistoryTip
  }
}
