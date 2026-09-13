import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { Locate } from 'lucide-react'
import type { Commit, GraphNode } from '@shared/ipc'
import { ColumnResizeHandle } from '../../components/ColumnResizeHandle'
import { Button, RefPill } from '../../components/ui'
import { GraphCell } from './GraphCell'

interface Props {
  commits: Commit[]
  graphBySha: Map<string, GraphNode>
  headSha: string | null
  selectedSha: string | null
  busy: boolean
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

function formatRelativeDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diffMs = Date.now() - d.getTime()
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
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

  useEffect(() => setGraphW(graphColWidth), [graphColWidth])
  useEffect(() => setDateW(dateColWidth), [dateColWidth])
  useEffect(() => setAuthorW(authorColWidth), [authorColWidth])

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

  return (
    <>
      <div className="history-filters">
        <strong>History</strong>
        <span className="muted">{busy ? 'Loading…' : `${commits.length} commits`}</span>
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
            const el = listRef.current?.querySelector(`[data-sha="${headSha}"]`)
            el?.scrollIntoView({ block: 'center' })
          }}
        >
          Jump to HEAD
        </Button>
      </div>
      <div className="history-table" ref={listRef}>
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
          commits.map((c) => {
            const node = graphBySha.get(c.sha)
            const refTitle =
              c.refs.length > 0 ? c.refs.map((r) => r.name).join(', ') : undefined
            const author = formatAuthor(c)
            return (
              <div
                key={c.sha}
                data-sha={c.sha}
                className={`history-row ${selectedSha === c.sha ? 'selected' : ''}`}
                style={{ gridTemplateColumns: cols }}
                onClick={() => onSelect(c.sha)}
                title={[c.body || c.subject, refTitle, c.shortSha, author].filter(Boolean).join('\n')}
              >
                <GraphCell node={node} maxLane={maxLane} isHead={c.sha === headSha} width={graphWidth} />
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
          })
        )}
      </div>
    </>
  )
}
