import type React from 'react'
import { ChevronDown, ChevronRight, Folder } from 'lucide-react'
import { useRovingList } from '../hooks/useRovingList'
import type { BranchLeafRow, BranchRow } from '../logic/branch-tree'

const INDENT = 14

/** The branch's label, with the parts a filter matched marked. */
export function BranchLabel({ row }: { row: BranchLeafRow }): React.JSX.Element {
  if (!row.match?.length) return <div className="cell-ellipsis">{row.label}</div>
  const parts: React.ReactNode[] = []
  let at = 0
  for (const [start, end] of row.match) {
    if (start > at) parts.push(row.label.slice(at, start))
    parts.push(<mark key={start} className="branch-match">{row.label.slice(start, end)}</mark>)
    at = end
  }
  parts.push(row.label.slice(at))
  return <div className="cell-ellipsis">{parts}</div>
}

export interface BranchRowView {
  /** Props of the branch's `<li>`: class, title, double-click, context menu. */
  props: React.LiHTMLAttributes<HTMLLIElement>
  content: React.ReactNode
}

interface BranchTreeListProps {
  label: string
  /** A new key (another repository) forgets the row focused last. */
  listKey: string
  rows: readonly BranchRow[]
  /** Holds the Tab stop until a row is focused: the current branch. */
  preferredIndex: number
  onToggleFolder: (key: string, open: boolean) => void
  onActivateBranch: (name: string) => void
  renderBranch: (row: BranchLeafRow) => BranchRowView
  /** Shown below the rows, such as "No matching branches" or how many results were left out. */
  footer?: React.ReactNode
}

/**
 * One list of branch rows and folder rows sharing a Tab stop. Enter checks a branch out or opens and closes
 * a folder; → opens a folder and ← closes it.
 */
export function BranchTreeList({
  label,
  listKey,
  rows,
  preferredIndex,
  onToggleFolder,
  onActivateBranch,
  renderBranch,
  footer
}: BranchTreeListProps): React.JSX.Element {
  const roving = useRovingList(
    rows.length,
    preferredIndex,
    (index) => {
      const row = rows[index]
      if (!row) return
      if (row.kind === 'folder') onToggleFolder(row.key, !row.open)
      else onActivateBranch(row.name)
    },
    listKey
  )

  return (
    <ul className="branch-list" aria-label={label} onKeyDown={roving.onKeyDown}>
      {rows.map((row, index) => {
        const indent = { paddingLeft: 10 + row.depth * INDENT }
        if (row.kind === 'folder') {
          return (
            <li
              key={`folder:${row.key}`}
              {...roving.rowProps(index)}
              className="branch-folder"
              style={indent}
              aria-expanded={row.open}
              title={row.key}
              onClick={() => onToggleFolder(row.key, !row.open)}
              onKeyDown={(e) => {
                if ((e.key === 'ArrowRight' && !row.open) || (e.key === 'ArrowLeft' && row.open)) {
                  e.preventDefault()
                  onToggleFolder(row.key, !row.open)
                }
              }}
            >
              <span className="muted branch-folder-chevron">{row.open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
              <Folder size={14} strokeWidth={1.75} className="muted" aria-hidden />
              <span className="cell-ellipsis">{row.label}</span>
              <span className="muted text-xs branch-folder-count">{row.count}</span>
            </li>
          )
        }
        const view = renderBranch(row)
        return (
          <li key={row.key} {...roving.rowProps(index)} {...view.props} style={indent}>
            {view.content}
          </li>
        )
      })}
      {footer}
    </ul>
  )
}
