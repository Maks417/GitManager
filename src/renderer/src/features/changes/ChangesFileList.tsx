import { memo, useCallback, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { StatusEntry } from '@shared/ipc'
import { FileStatusDot, isMenuKey, menuPointFor, RefPill } from '../../components/ui'
import type { DiffSide } from '../../hooks/selection'
import { LIST_ROW_ATTR, ListSpacer, useListWindow, type ListWindow } from '../../hooks/useListWindow'
import { statusKindFor } from '../../logic/file-status'
import { nextListIndex } from '../../logic/list-nav'
import { useFileMenu, type FileTarget } from '../../state/FileMenuProvider'
import { useSelectionActions, useSelectionFocus } from '../../state/SelectionProvider'

const changesRowId = (index: number): string => `changes-row-${index}`

export function fileTarget(s: StatusEntry): FileTarget {
  return {
    path: s.path,
    inWorkTree: s.workTreeStatus !== 'D' && s.indexStatus !== 'D',
    untracked: s.untracked
  }
}

interface RowProps {
  entry: StatusEntry
  side: DiffSide
  /** Position among the rows the arrow keys walk through, for the row id. */
  navIndex: number
  active: boolean
  checked: boolean
  onSelect: (path: string, side: DiffSide) => void
  onToggleChecked: (path: string) => void
  onMenu: (entry: StatusEntry, side: DiffSide, point: { x: number; y: number }) => void
}

const ChangesFileRow = memo(function ChangesFileRow({
  entry,
  side,
  navIndex,
  active,
  checked,
  onSelect,
  onToggleChecked,
  onMenu
}: RowProps): React.JSX.Element {
  return (
    <li
      {...{ [LIST_ROW_ATTR]: '' }}
      id={navIndex >= 0 ? changesRowId(navIndex) : undefined}
      role="option"
      aria-selected={active}
      aria-checked={checked}
      className={[active ? 'active' : '', checked ? 'checked' : ''].filter(Boolean).join(' ')}
      onClick={() => onSelect(entry.path, side)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(entry, side, { x: e.clientX, y: e.clientY })
      }}
      title={entry.path}
    >
      <div className="row-inline">
        <input
          type="checkbox"
          checked={checked}
          // Space on the list checks the active file, so the boxes stay out of the Tab order and a
          // click leaves keyboard focus on the list.
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          onChange={() => onToggleChecked(entry.path)}
          onClick={(e) => e.stopPropagation()}
          title="Check to include in Stage / Unstage / Discard"
        />
        <FileStatusDot kind={statusKindFor(entry, side)} oldPath={entry.oldPath} />
        <span className="cell-ellipsis">{entry.path}</span>
        {entry.conflicted && <RefPill tone="danger">conflict</RefPill>}
      </div>
    </li>
  )
})

interface ChangesFileListProps {
  stagedEntries: StatusEntry[]
  changesEntries: StatusEntry[]
  checked: ReadonlySet<string>
  busy: boolean
  onToggleChecked: (path: string) => void
  onSetGroupChecked: (paths: string[], selected: boolean) => void
}

/**
 * Staged files and other changes, each a collapsible section. Only the rows near the viewport are
 * rendered, so thousands of new files stay fast; the arrow keys walk both sections as one list.
 */
export const ChangesFileList = memo(function ChangesFileList({
  stagedEntries,
  changesEntries,
  checked,
  busy,
  onToggleChecked,
  onSetGroupChecked
}: ChangesFileListProps): React.JSX.Element {
  const { focusedStatusPath: focusedPath, diffSide } = useSelectionFocus()
  const { setFocusedStatusPath, setDiffSide } = useSelectionActions()
  const { openFileMenu } = useFileMenu()
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)

  const scrollerRef = useRef<HTMLDivElement>(null)
  const stagedListRef = useRef<HTMLUListElement>(null)
  const changesListRef = useRef<HTMLUListElement>(null)
  const stagedWindow = useListWindow(scrollerRef, stagedListRef, stagedExpanded ? stagedEntries.length : 0)
  const changesWindow = useListWindow(scrollerRef, changesListRef, changesExpanded ? changesEntries.length : 0)

  // The arrow keys walk the staged files, then the other changes, as far as they are expanded.
  const stagedNavCount = stagedExpanded ? stagedEntries.length : 0
  const navCount = stagedNavCount + (changesExpanded ? changesEntries.length : 0)
  const rowAt = (index: number): { entry: StatusEntry; side: DiffSide; sectionIndex: number } | null => {
    if (index < 0 || index >= navCount) return null
    if (index < stagedNavCount) return { entry: stagedEntries[index], side: 'staged', sectionIndex: index }
    const sectionIndex = index - stagedNavCount
    return { entry: changesEntries[sectionIndex], side: 'unstaged', sectionIndex }
  }

  const activeSectionIndex = useMemo(() => {
    if (!focusedPath) return -1
    const entries = diffSide === 'staged' ? (stagedExpanded ? stagedEntries : []) : changesExpanded ? changesEntries : []
    return entries.findIndex((s) => s.path === focusedPath)
  }, [focusedPath, diffSide, stagedExpanded, stagedEntries, changesExpanded, changesEntries])
  const navIndex =
    activeSectionIndex < 0 ? -1 : diffSide === 'staged' ? activeSectionIndex : stagedNavCount + activeSectionIndex
  const activeWindow = diffSide === 'staged' ? stagedWindow : changesWindow
  // Only a rendered row can be the active descendant.
  const activeRendered =
    activeSectionIndex >= activeWindow.startIndex && activeSectionIndex < activeWindow.endIndex

  const onSelect = useCallback(
    (path: string, side: DiffSide): void => {
      setFocusedStatusPath(path)
      setDiffSide(side)
    },
    [setFocusedStatusPath, setDiffSide]
  )

  const onMenu = useCallback(
    (entry: StatusEntry, side: DiffSide, point: { x: number; y: number }): void => {
      setFocusedStatusPath(entry.path)
      setDiffSide(side)
      openFileMenu(fileTarget(entry), point)
    },
    [setFocusedStatusPath, setDiffSide, openFileMenu]
  )

  const revealRow = (row: { side: DiffSide; sectionIndex: number }): void => {
    ;(row.side === 'staged' ? stagedWindow : changesWindow).scrollToRow(row.sectionIndex)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Section checkboxes and toggles handle their own keys.
    if (e.target !== e.currentTarget) return
    if (isMenuKey(e)) {
      const row = rowAt(navIndex)
      if (!row) return
      e.preventDefault()
      revealRow(row)
      const el = document.getElementById(changesRowId(navIndex))
      if (el) openFileMenu(fileTarget(row.entry), menuPointFor(el))
      return
    }
    if (e.key === ' ') {
      const row = rowAt(navIndex)
      if (!row) return
      e.preventDefault()
      onToggleChecked(row.entry.path)
      return
    }
    const next = nextListIndex(e.key, navIndex, navCount)
    if (next === null) return
    const row = rowAt(next)
    if (!row) return
    e.preventDefault()
    setFocusedStatusPath(row.entry.path)
    setDiffSide(row.side)
    revealRow(row)
  }

  const renderSection = (
    label: string,
    entries: StatusEntry[],
    side: DiffSide,
    expanded: boolean,
    onToggle: () => void,
    listRef: React.RefObject<HTMLUListElement | null>,
    win: ListWindow,
    navOffset: number
  ): React.JSX.Element | null => {
    if (entries.length === 0) return null
    const allChecked = entries.every((s) => checked.has(s.path))
    return (
      <div className="changes-file-section" role="group" aria-label={label}>
        <div className="changes-file-section-header">
          <label className="row-inline changes-select-all changes-file-section-check">
            <input
              type="checkbox"
              checked={allChecked}
              disabled={busy}
              onChange={(e) => onSetGroupChecked(entries.map((s) => s.path), e.target.checked)}
              title={`Select all ${label.toLowerCase()} files`}
            />
          </label>
          <button
            type="button"
            className="panel-title panel-disclosure changes-file-section-toggle"
            onClick={onToggle}
            aria-expanded={expanded}
            title={expanded ? `Collapse ${label}` : `Expand ${label}`}
          >
            <span>
              {label} ({entries.length})
            </span>
            <span className="muted">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
          </button>
        </div>
        {expanded && (
          <ul ref={listRef} className="file-list" role="presentation">
            <ListSpacer rows={win.startIndex} rowHeight={win.rowHeight} />
            {entries.slice(win.startIndex, win.endIndex).map((s, i) => {
              const sectionIndex = win.startIndex + i
              return (
                <ChangesFileRow
                  key={s.path}
                  entry={s}
                  side={side}
                  navIndex={navOffset + sectionIndex}
                  active={focusedPath === s.path && diffSide === side}
                  checked={checked.has(s.path)}
                  onSelect={onSelect}
                  onToggleChecked={onToggleChecked}
                  onMenu={onMenu}
                />
              )
            })}
            <ListSpacer rows={entries.length - win.endIndex} rowHeight={win.rowHeight} />
          </ul>
        )}
      </div>
    )
  }

  return (
    <div
      ref={scrollerRef}
      className="changes-file-list"
      role="listbox"
      aria-label="Changed files"
      tabIndex={0}
      aria-activedescendant={navIndex >= 0 && activeRendered ? changesRowId(navIndex) : undefined}
      onKeyDown={onKeyDown}
      data-pane-focus
    >
      {renderSection(
        'Staged',
        stagedEntries,
        'staged',
        stagedExpanded,
        () => setStagedExpanded((v) => !v),
        stagedListRef,
        stagedWindow,
        0
      )}
      {renderSection(
        'Changes',
        changesEntries,
        'unstaged',
        changesExpanded,
        () => setChangesExpanded((v) => !v),
        changesListRef,
        changesWindow,
        stagedNavCount
      )}
    </div>
  )
})
