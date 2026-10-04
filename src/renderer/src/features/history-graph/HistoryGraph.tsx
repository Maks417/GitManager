import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Locate } from 'lucide-react'
import type { Commit } from '@shared/ipc'
import { ColumnResizeHandle } from '../../components/ColumnResizeHandle'
import { Button, isMenuKey, menuPointFor } from '../../components/ui'
import { describeBranches } from '../../logic/branch-suggest'
import { nextListIndex } from '../../logic/list-nav'
import { virtualWindow } from '../../logic/virtual-window'
import { useAppStatus } from '../../state/AppStatusProvider'
import { useCommitMenu } from '../../state/CommitMenuProvider'
import { useDialogActions } from '../../state/DialogsProvider'
import { useHistoryActions, useHistoryState } from '../../state/HistoryProvider'
import { useLayoutActions, useLayoutHistoryColumns, useLayoutPrefsState } from '../../state/LayoutProvider'
import { useSession } from '../../state/RepoSessionProvider'
import { useSelectionCore } from '../../state/SelectionProvider'
import { useWorkingTreeActions } from '../../state/WorkingTreeProvider'
import { commitRowId, HistoryRow } from './HistoryRow'

const ROW_HEIGHT = 34
const OVERSCAN = 12
/** Moving the selection this close to the end of the loaded commits loads the next page. */
const LOAD_MORE_WITHIN = 20

export function HistoryGraph(): React.JSX.Element {
  const { busy } = useAppStatus()
  const {
    commits,
    graphBySha,
    maxLane,
    headSha,
    nextCursor,
    historyLoadingMore: loadingMore,
    branchFilter,
    notice,
    revealRequest
  } = useHistoryState()
  const { loadMoreHistory, revealCommit, finishReveal } = useHistoryActions()
  const { currentBranch } = useSession()
  const { selectedSha } = useSelectionCore()
  const { selectCommit } = useWorkingTreeActions()
  const { openCommitMenu } = useCommitMenu()
  const { openDialog } = useDialogActions()
  // Column widths live in the layout state, which a drag updates live and saves when it ends.
  const { prefs, setHistoryFilter } = useLayoutPrefsState()
  const { persistLayout } = useLayoutActions()
  const {
    historyGraphColWidth: graphW,
    historyDateColWidth: dateW,
    historyAuthorColWidth: authorW,
    setHistoryGraphColWidth,
    setHistoryDateColWidth,
    setHistoryAuthorColWidth
  } = useLayoutHistoryColumns()
  const filter = prefs?.historyFilter || 'all'
  const hasMore = Boolean(nextCursor)

  const listRef = useRef<HTMLDivElement>(null)
  const scrollTopRef = useRef(0)
  const scrollRafRef = useRef(0)
  const [viewportH, setViewportH] = useState(400)
  const [windowRange, setWindowRange] = useState(() => virtualWindow(0, 400, 0, ROW_HEIGHT, OVERSCAN))

  const syncWindow = useCallback((scrollTop: number, height: number, totalRows: number): void => {
    const next = virtualWindow(scrollTop, height, totalRows, ROW_HEIGHT, OVERSCAN)
    setWindowRange((prev) =>
      prev.startIndex === next.startIndex && prev.endIndex === next.endIndex ? prev : next
    )
  }, [])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = (): void => {
      const height = el.clientHeight
      setViewportH(height)
      syncWindow(scrollTopRef.current, height, commits.length)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [commits.length, syncWindow])

  useEffect(() => {
    syncWindow(scrollTopRef.current, viewportH, commits.length)
  }, [commits.length, viewportH, syncWindow])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  const selectedIndex = useMemo(
    () => (selectedSha ? commits.findIndex((c) => c.sha === selectedSha) : -1),
    [commits, selectedSha]
  )

  /** Scroll row `index` into view: to the middle for a jump, just inside the edge for a step. */
  const scrollRowIntoView = useCallback((index: number, align: 'center' | 'nearest'): void => {
    const el = listRef.current
    if (!el) return
    // Rows start below the sticky column header, which also covers the top of the scrolled view.
    const headerHeight = el.querySelector<HTMLElement>('.history-virtual-body')?.offsetTop ?? 0
    const rowTop = headerHeight + index * ROW_HEIGHT
    if (align === 'center') {
      el.scrollTop = Math.max(0, rowTop + ROW_HEIGHT / 2 - (headerHeight + el.clientHeight) / 2)
    } else if (rowTop < el.scrollTop + headerHeight) {
      el.scrollTop = rowTop - headerHeight
    } else if (rowTop + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = rowTop + ROW_HEIGHT - el.clientHeight
    }
  }, [])

  // Scroll a jumped-to commit to the middle of the list once it is loaded.
  useEffect(() => {
    if (!revealRequest) return
    const index = commits.findIndex((c) => c.sha === revealRequest.sha)
    if (index < 0) return
    scrollRowIntoView(index, 'center')
    finishReveal(revealRequest.seq)
  }, [revealRequest, commits, finishReveal, scrollRowIntoView])

  const autoGraphMin = Math.max(80, (maxLane + 2) * 14)
  const graphWidth = Math.max(graphW, autoGraphMin)
  const cols = `${graphWidth}px minmax(120px, 1fr) ${dateW}px ${authorW}px`

  const commitWidths = (partial: {
    historyGraphColWidth?: number
    historyDateColWidth?: number
    historyAuthorColWidth?: number
  }): void => {
    persistLayout({
      historyGraphColWidth: partial.historyGraphColWidth ?? graphW,
      historyDateColWidth: partial.historyDateColWidth ?? dateW,
      historyAuthorColWidth: partial.historyAuthorColWidth ?? authorW
    })
  }

  const totalRows = commits.length
  const { startIndex, endIndex, offsetY } = windowRange
  // Only a rendered row can be the active descendant.
  const activeRowId =
    selectedIndex >= startIndex && selectedIndex < endIndex ? commitRowId(commits[selectedIndex].sha) : undefined

  const maybeLoadMore = useCallback(
    (target: HTMLDivElement): void => {
      if (!hasMore || loadingMore || busy) return
      const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
      if (remaining < ROW_HEIGHT * 8) void loadMoreHistory()
    },
    [hasMore, loadMoreHistory, loadingMore, busy]
  )

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget
      scrollTopRef.current = target.scrollTop
      maybeLoadMore(target)
      if (scrollRafRef.current) return
      scrollRafRef.current = requestAnimationFrame(() => {
        scrollRafRef.current = 0
        syncWindow(scrollTopRef.current, target.clientHeight, commits.length)
      })
    },
    [commits.length, maybeLoadMore, syncWindow]
  )

  const onOpenMenu = useCallback(
    (commit: Commit, point: { x: number; y: number }): void => {
      openCommitMenu(commit, point)
    },
    [openCommitMenu]
  )

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Keys pressed on a column resize handle are the handle's.
    if (e.target !== e.currentTarget) return
    if (isMenuKey(e)) {
      const commit = commits[selectedIndex]
      const row = commit && document.getElementById(commitRowId(commit.sha))
      if (!commit || !row) return
      e.preventDefault()
      openCommitMenu(commit, menuPointFor(row))
      return
    }
    if (e.key === 'Enter') {
      const files = document.querySelector<HTMLElement>('.inspector-files')
      if (selectedIndex < 0 || !files) return
      e.preventDefault()
      files.focus()
      return
    }
    const pageSize = Math.max(1, Math.floor(viewportH / ROW_HEIGHT) - 1)
    const next = nextListIndex(e.key, selectedIndex, commits.length, { pageSize })
    if (next === null) return
    e.preventDefault()
    selectCommit(commits[next].sha)
    scrollRowIntoView(next, 'nearest')
    if (hasMore && !loadingMore && !busy && commits.length - next <= LOAD_MORE_WITHIN) void loadMoreHistory()
  }

  return (
    <div className="history-graph-root">
      <div className="history-filters">
        <strong>History</strong>
        <span className="muted">
          {busy && !loadingMore
            ? 'Loading…'
            : `${commits.length} commit${commits.length === 1 ? '' : 's'}${hasMore ? '+' : ''}`}
        </span>
        {branchFilter && branchFilter.length > 0 && (
          <span className="muted cell-ellipsis history-branch-filter" title={branchFilter.join('\n')}>
            on {describeBranches(branchFilter)}
          </span>
        )}
        {notice && commits.length > 0 && (
          <span className="cell-ellipsis history-notice" role="status" title={notice}>
            {notice}
          </span>
        )}
        <div className="spacer" />
        <Button disabled={busy || !headSha} onClick={() => openDialog('compare')}>Compare…</Button>
        <Button disabled={busy} onClick={() => openDialog('recovery')}>Recovery…</Button>
        <select
          value={filter}
          onChange={(e) => setHistoryFilter(e.target.value as 'all' | 'current')}
          title={branchFilter ? 'Not applied while the search names branches' : undefined}
        >
          <option value="all">All branches</option>
          <option value="current">Current branch</option>
        </select>
        <Button
          icon={<Locate size={16} strokeWidth={1.75} />}
          hint="Jump to HEAD commit"
          title="Jump to HEAD commit"
          disabled={!headSha}
          onClick={() => {
            if (headSha) void revealCommit(headSha, currentBranch?.name)
          }}
        >
          Jump to HEAD
        </Button>
      </div>
      <div
        className="history-table"
        ref={listRef}
        onScroll={onScroll}
        role="listbox"
        aria-label="Commits"
        tabIndex={0}
        aria-activedescendant={activeRowId}
        onKeyDown={onListKeyDown}
        data-pane-focus
      >
        <div className="history-header" role="presentation" style={{ gridTemplateColumns: cols }}>
          <div className="history-col">
            Graph
            <ColumnResizeHandle
              value={graphWidth}
              min={autoGraphMin}
              max={560}
              onChange={setHistoryGraphColWidth}
              onChangeEnd={(w) => commitWidths({ historyGraphColWidth: w })}
              title="Resize graph column"
            />
          </div>
          <div className="history-col">
            Description
            <ColumnResizeHandle
              value={dateW}
              min={72}
              max={220}
              reverse
              onChange={setHistoryDateColWidth}
              onChangeEnd={(w) => commitWidths({ historyDateColWidth: w })}
              title="Resize date column"
            />
          </div>
          <div className="history-col">
            Date
            <ColumnResizeHandle
              value={dateW}
              min={72}
              max={220}
              onChange={setHistoryDateColWidth}
              onChangeEnd={(w) => commitWidths({ historyDateColWidth: w })}
              title="Resize date column"
            />
          </div>
          <div className="history-col">
            Author
            <ColumnResizeHandle
              value={authorW}
              min={100}
              max={360}
              onChange={setHistoryAuthorColWidth}
              onChangeEnd={(w) => commitWidths({ historyAuthorColWidth: w })}
              title="Resize author column"
            />
          </div>
        </div>
        {commits.length === 0 ? (
          <div className="empty-state" role="presentation">
            {busy
              ? 'Loading…'
              : (notice ??
                (headSha
                  ? 'No commits match the search.'
                  : 'No commits yet. Switch to Changes to create the first commit.'))}
          </div>
        ) : (
          <div className="history-virtual-body" role="presentation" style={{ height: totalRows * ROW_HEIGHT }}>
            <div
              className="history-virtual-window"
              role="presentation"
              style={{ transform: `translateY(${offsetY}px)` }}
            >
              {commits.slice(startIndex, endIndex).map((c) => (
                <HistoryRow
                  key={c.sha}
                  commit={c}
                  node={graphBySha.get(c.sha)}
                  maxLane={maxLane}
                  isHead={c.sha === headSha}
                  selected={selectedSha === c.sha}
                  graphWidth={graphWidth}
                  cols={cols}
                  rowHeight={ROW_HEIGHT}
                  onSelect={selectCommit}
                  onOpenMenu={onOpenMenu}
                />
              ))}
            </div>
          </div>
        )}
        {(loadingMore || (hasMore && commits.length > 0)) && (
          <div className="history-load-more muted" role="presentation">
            {loadingMore ? 'Loading older commits…' : hasMore ? 'Scroll for older commits' : null}
          </div>
        )}
      </div>
    </div>
  )
}
