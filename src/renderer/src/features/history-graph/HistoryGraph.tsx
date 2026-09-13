import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Locate } from 'lucide-react'
import type { Commit, GraphNode } from '@shared/ipc'
import { ColumnResizeHandle } from '../../components/ColumnResizeHandle'
import { Button, RefPill } from '../../components/ui'
import { formatRelativeDate } from '../../lib/format'
import { GraphCell } from './GraphCell'

const ROW_HEIGHT = 34
const OVERSCAN = 12

interface Props {
  commits: Commit[]
  graphBySha: Map<string, GraphNode>
  headSha: string | null
  selectedSha: string | null
  busy: boolean
  loadingMore?: boolean
  hasMore?: boolean
  onLoadMore?: () => void
  filter: 'all' | 'current'
  onFilterChange: (f: 'all' | 'current') => void
  onSelect: (sha: string) => void
  graphColWidth: number
  dateColWidth: number
  authorColWidth: number
  onGraphColWidthChange: (w: number) => void
  onDateColWidthChange: (w: number) => void
  onAuthorColWidthChange: (w: number) => void
  onColumnWidthsCommit: (next: {
    historyGraphColWidth: number
    historyDateColWidth: number
    historyAuthorColWidth: number
  }) => void
}

function formatAuthor(c: Commit): string {
  if (c.authorName && c.authorEmail) return `${c.authorName} <${c.authorEmail}>`
  return c.authorName || c.authorEmail || ''
}

export function HistoryGraph({
  commits,
  graphBySha,
  headSha,
  selectedSha,
  busy,
  loadingMore = false,
  hasMore = false,
  onLoadMore,
  filter,
  onFilterChange,
  onSelect,
  graphColWidth,
  dateColWidth,
  authorColWidth,
  onGraphColWidthChange,
  onDateColWidthChange,
  onAuthorColWidthChange,
  onColumnWidthsCommit
}: Props): React.JSX.Element {
  const listRef = useRef<HTMLDivElement>(null)
  const [graphW, setGraphW] = useState(graphColWidth)
  const [dateW, setDateW] = useState(dateColWidth)
  const [authorW, setAuthorW] = useState(authorColWidth)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(400)

  useEffect(() => setGraphW(graphColWidth), [graphColWidth])
  useEffect(() => setDateW(dateColWidth), [dateColWidth])
  useEffect(() => setAuthorW(authorColWidth), [authorColWidth])

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const measure = (): void => setViewportH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
    onColumnWidthsCommit({
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

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const target = e.currentTarget
      setScrollTop(target.scrollTop)
      if (!hasMore || !onLoadMore || loadingMore || busy) return
      const remaining = target.scrollHeight - target.scrollTop - target.clientHeight
      if (remaining < ROW_HEIGHT * 8) onLoadMore()
    },
    [hasMore, onLoadMore, loadingMore, busy]
  )

  return (
    <div className="history-graph-root">
      <div className="history-filters">
        <strong>History</strong>
        <span className="muted">
          {busy && !loadingMore
            ? 'Loading…'
            : `${commits.length} commit${commits.length === 1 ? '' : 's'}${hasMore ? '+' : ''}`}
        </span>
        <div className="spacer" />
        <select value={filter} onChange={(e) => onFilterChange(e.target.value as 'all' | 'current')}>
          <option value="all">All branches</option>
          <option value="current">Current branch</option>
        </select>
        <Button
          icon={<Locate size={16} strokeWidth={1.75} />}
          hint="Jump to HEAD commit"
          title="Jump to HEAD commit"
          disabled={!headSha}
          onClick={() => {
            if (!headSha) return
            onSelect(headSha)
            const idx = commits.findIndex((c) => c.sha === headSha)
            const el = listRef.current
            if (el && idx >= 0) {
              el.scrollTop = Math.max(0, idx * ROW_HEIGHT - el.clientHeight / 2)
            }
          }}
        >
          Jump to HEAD
        </Button>
      </div>
      <div className="history-table" ref={listRef} onScroll={onScroll}>
        <div className="history-header" style={{ gridTemplateColumns: cols }}>
          <div className="history-col">
            Graph
            <ColumnResizeHandle
              value={graphWidth}
              min={autoGraphMin}
              max={560}
              onChange={(w) => {
                setGraphW(w)
                onGraphColWidthChange(w)
              }}
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
              onChange={(w) => {
                setDateW(w)
                onDateColWidthChange(w)
              }}
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
              onChange={(w) => {
                setDateW(w)
                onDateColWidthChange(w)
              }}
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
              onChange={(w) => {
                setAuthorW(w)
                onAuthorColWidthChange(w)
              }}
              onChangeEnd={(w) => commitWidths({ historyAuthorColWidth: w })}
              title="Resize author column"
            />
          </div>
        </div>
        {commits.length === 0 ? (
          <div className="empty-state">
            {busy ? 'Loading…' : 'No commits yet. Switch to Changes to create the first commit.'}
          </div>
        ) : (
          <div className="history-virtual-body" style={{ height: totalRows * ROW_HEIGHT }}>
            <div className="history-virtual-window" style={{ transform: `translateY(${offsetY}px)` }}>
              {commits.slice(startIndex, endIndex).map((c) => {
                const node = graphBySha.get(c.sha)
                const refTitle =
                  c.refs.length > 0 ? c.refs.map((r) => r.name).join(', ') : undefined
                const author = formatAuthor(c)
                return (
                  <div
                    key={c.sha}
                    data-sha={c.sha}
                    className={`history-row ${selectedSha === c.sha ? 'selected' : ''}`}
                    style={{ gridTemplateColumns: cols, height: ROW_HEIGHT }}
                    onClick={() => onSelect(c.sha)}
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
          <div className="history-load-more muted">
            {loadingMore ? 'Loading older commits…' : hasMore ? 'Scroll for older commits' : null}
          </div>
        )}
      </div>
    </div>
  )
}
