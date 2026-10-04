import { memo } from 'react'
import type React from 'react'
import { Tag } from 'lucide-react'
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
  const tags = commit.refs.filter((r) => r.type === 'tag')
  const otherRefs = commit.refs.filter((r) => r.type !== 'tag')
  const tagTitle = tags.map((r) => r.name).join(', ')
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
        {tags.length > 0 && (
          <span className="history-tags" role="group" aria-label={`Tags: ${tagTitle}`} title={tagTitle}>
            {tags.slice(0, 2).map((tag) => (
              <RefPill key={tag.name} className="history-tag" title={`Tag: ${tag.name}`}>
                <Tag size={12} strokeWidth={1.75} aria-hidden="true" />
                <span className="cell-ellipsis">{tag.name}</span>
              </RefPill>
            ))}
            {tags.length > 2 && (
              <span className="ref-count muted" title={tagTitle}>+{tags.length - 2} tags</span>
            )}
          </span>
        )}
        {otherRefs.length > 0 && (
          <span className="ref-count muted" title={otherRefs.map((r) => r.name).join(', ')}>
            {otherRefs.length} ref{otherRefs.length === 1 ? '' : 's'}
          </span>
        )}
        <span className="cell-ellipsis history-subject">{commit.subject}</span>
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
