import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Locate } from 'lucide-react'
import type { Commit } from '@shared/ipc'
import { ColumnResizeHandle } from '../../components/ColumnResizeHandle'
import { Button, RefPill } from '../../components/ui'
import { formatRelativeDate } from '../../lib/format'
import { describeBranches } from '../../logic/branch-suggest'
import { nextListIndex } from '../../logic/list-nav'
import { useAppStatus } from '../../state/AppStatusProvider'
import { useHistoryActions, useHistoryState } from '../../state/HistoryProvider'
import { useLayout } from '../../state/LayoutProvider'
import { useSession } from '../../state/RepoSessionProvider'
import { useSelection } from '../../state/SelectionProvider'
import { useWorkingTreeActions } from '../../state/WorkingTreeProvider'
import { GraphCell } from './GraphCell'

const ROW_HEIGHT = 34
const OVERSCAN = 12
/** Moving the selection this close to the end of the loaded commits loads the next page. */
const LOAD_MORE_WITHIN = 20

const rowId = (sha: string): string => `commit-row-${sha}`

function formatAuthor(c: Commit): string {
  if (c.authorName && c.authorEmail) return `${c.authorName} <${c.authorEmail}>`
  return c.authorName || c.authorEmail || ''
}

export function HistoryGraph(): React.JSX.Element {
  const { busy } = useAppStatus()
  const {
    commits,
    graphBySha,
    headSha,
    nextCursor,
    historyLoadingMore: loadingMore,
    branchFilter,
    notice,
    revealRequest
  } = useHistoryState()
  const { loadMoreHistory, revealCommit, finishReveal } = useHistoryActions()
  const { currentBranch } = useSession()
  const { selectedSha } = useSelection()
  const { selectCommit } = useWorkingTreeActions()
  // Column widths live in the layout state, which a drag updates live and saves when it ends.
  const {
    prefs,
    setHistoryFilter,
    historyGraphColWidth: graphW,
    historyDateColWidth: dateW,
    historyAuthorColWidth: authorW,
    setHistoryGraphColWidth,
    setHistoryDateColWidth,
    setHistoryAuthorColWidth,
    persistLayout
  } = useLayout()
  const filter = prefs?.historyFilter || 'all'
  const hasMore = Boolean(nextCursor)

  const listRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = (): void => setViewportH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
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

  const maxLane = useMemo(() => {
    let m = 0
    for (const g of graphBySha.values()) m = Math.max(m, g.lane, ...g.lanes)
    return m
  }, [graphBySha])

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
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const visibleCount = Math.ceil(viewportH / ROW_HEIGHT) + OVERSCAN * 2
  const endIndex = Math.min(totalRows, startIndex + visibleCount)
  const offsetY = startIndex * ROW_HEIGHT
  // Only a rendered row can be the active descendant.
  const activeRowId =
    selectedIndex >= startIndex && selectedIndex < endIndex ? rowId(commits[selectedIndex].sha) : undefined

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget
      setScrollTop(target.scrollTop)
      if (!hasMore || loadingMore || busy) return
      const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
      if (remaining < ROW_HEIGHT * 8) void loadMoreHistory()
    },
    [hasMore, loadMoreHistory, loadingMore, busy]
  )

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Keys pressed on a column resize handle are the handle's.
    if (e.target !== e.currentTarget) return
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
              {commits.slice(startIndex, endIndex).map((c) => {
                const node = graphBySha.get(c.sha)
                const refTitle =
                  c.refs.length > 0 ? c.refs.map((r) => r.name).join(', ') : undefined
                const author = formatAuthor(c)
                return (
                  <div
                    key={c.sha}
                    id={rowId(c.sha)}
                    role="option"
                    aria-selected={selectedSha === c.sha}
                    data-sha={c.sha}
                    className={`history-row ${selectedSha === c.sha ? 'selected' : ''}`}
                    style={{ gridTemplateColumns: cols, height: ROW_HEIGHT }}
                    onClick={() => selectCommit(c.sha)}
                    title={[c.subject, refTitle, c.shortSha, author].filter(Boolean).join('\n')}
                  >
                    <GraphCell
                      node={node}
                      maxLane={maxLane}
                      isHead={c.sha === headSha}
                      width={graphWidth}
                    />
                    <div className="cell-ellipsis history-desc">
                      {c.sha === headSha && <RefPill tone="success">HEAD</RefPill>}
                      {c.refs.length > 0 && (
                        <span className="ref-count muted" title={refTitle}>
                          {c.refs.length} ref{c.refs.length === 1 ? '' : 's'}
                        </span>
                      )}
                      {c.subject}
                    </div>
                    <div className="cell-ellipsis muted" title={c.authoredAt}>
                      {formatRelativeDate(c.authoredAt)}
                    </div>
                    <div className="cell-ellipsis muted" title={author}>
                      {author}
                    </div>
                  </div>
                )
              })}
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
