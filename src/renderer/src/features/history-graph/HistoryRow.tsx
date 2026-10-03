import { memo } from 'react'
import type React from 'react'
import type { Commit, GraphNode } from '@shared/ipc'
import { RefPill } from '../../components/ui'
import { formatRelativeDate } from '../../lib/format'
import { GraphCell } from './GraphCell'

export function commitRowId(sha: string): string {
  return `commit-row-${sha}`
}

export function formatAuthor(c: Commit): string {
  if (c.authorName && c.authorEmail) return `${c.authorName} <${c.authorEmail}>`
  return c.authorName || c.authorEmail || ''
}

interface Props {
  commit: Commit
  node?: GraphNode
  maxLane: number
  isHead: boolean
  selected: boolean
  graphWidth: number
  cols: string
  rowHeight: number
  onSelect: (sha: string) => void
  onOpenMenu: (commit: Commit, point: { x: number; y: number }) => void
}

function HistoryRowInner({
  commit,
  node,
  maxLane,
  isHead,
  selected,
  graphWidth,
  cols,
  rowHeight,
  onSelect,
  onOpenMenu
}: Props): React.JSX.Element {
  const refTitle = commit.refs.length > 0 ? commit.refs.map((r) => r.name).join(', ') : undefined
  const author = formatAuthor(commit)
  return (
    <div
      id={commitRowId(commit.sha)}
      role="option"
      aria-selected={selected}
      data-sha={commit.sha}
      className={`history-row${selected ? ' selected' : ''}`}
      style={{ gridTemplateColumns: cols, height: rowHeight }}
      onClick={() => onSelect(commit.sha)}
      onContextMenu={(e) => {
        e.preventDefault()
        onSelect(commit.sha)
        onOpenMenu(commit, { x: e.clientX, y: e.clientY })
      }}
      title={[commit.subject, refTitle, commit.shortSha, author].filter(Boolean).join('\n')}
    >
      <GraphCell node={node} maxLane={maxLane} isHead={isHead} width={graphWidth} />
      <div className="cell-ellipsis history-desc">
        {isHead && <RefPill tone="success">HEAD</RefPill>}
        {commit.refs.length > 0 && (
          <span className="ref-count muted" title={refTitle}>
            {commit.refs.length} ref{commit.refs.length === 1 ? '' : 's'}
          </span>
        )}
        {commit.subject}
      </div>
      <div className="cell-ellipsis muted" title={commit.authoredAt}>
        {formatRelativeDate(commit.authoredAt)}
      </div>
      <div className="cell-ellipsis muted" title={author}>
        {author}
      </div>
    </div>
  )
}

export const HistoryRow = memo(HistoryRowInner)
