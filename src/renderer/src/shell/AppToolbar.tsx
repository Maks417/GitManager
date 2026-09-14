import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import {
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Download,
  FileDiff,
  GitMerge,
  History,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Sun
} from 'lucide-react'
import type { BranchInfo } from '@shared/ipc'
import type { ThemePreference } from '@shared/theme'
import { Button, SegmentedControl } from '../components/ui'
import type { ViewMode } from '../hooks/selection'

type AppToolbarProps = {
  activeRepo: boolean
  busy: boolean
  viewMode: ViewMode
  statusCount: number
  conflictCount: number
  search: string
  onSearchChange: (value: string) => void
  onSearchSubmit: (e: React.FormEvent) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  currentBranch: BranchInfo | null
  theme: ThemePreference
  onThemeChange: (theme: ThemePreference) => void
  onGoHistory: () => void
  onSelectWorkingCopy: () => void
  onResolveConflicts: () => void
  onFetch: () => void
  onPull: () => void
  onPush: () => void
}

export function AppToolbar({
  activeRepo,
  busy,
  viewMode,
  statusCount,
  conflictCount,
  search,
  onSearchChange,
  onSearchSubmit,
  searchRef,
  currentBranch,
  theme,
  onThemeChange,
  onGoHistory,
  onSelectWorkingCopy,
  onResolveConflicts,
  onFetch,
  onPull,
  onPush
}: AppToolbarProps): React.JSX.Element {
  const [syncMenuOpen, setSyncMenuOpen] = useState(false)
  const syncRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!syncMenuOpen) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (syncRef.current && !syncRef.current.contains(t)) setSyncMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [syncMenuOpen])

  const syncBadge =
    currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0) ? (
      <span className="ahead-behind">
        <ArrowUp size={12} strokeWidth={2} />
        {currentBranch.ahead}
        <ArrowDown size={12} strokeWidth={2} />
        {currentBranch.behind}
      </span>
    ) : null

  return (
    <header className="toolbar">
      <SegmentedControl
        ariaLabel="View mode"
        className="mode-switch"
        disabled={!activeRepo}
        value={viewMode}
        onChange={(mode) => {
          if (mode === 'history') onGoHistory()
          else onSelectWorkingCopy()
        }}
        options={[
          {
            value: 'history',
            label: 'History',
            hint: 'History view',
            icon: <History size={16} strokeWidth={1.75} />
          },
          {
            value: 'changes',
            label: statusCount ? `Changes (${statusCount})` : 'Changes',
            hint: 'Working tree changes',
            icon: <FileDiff size={16} strokeWidth={1.75} />
          }
        ]}
      />

      {conflictCount > 0 && (
        <Button
          variant="primary"
          icon={<GitMerge size={16} strokeWidth={1.75} />}
          hint="Resolve merge conflicts"
          title="Resolve merge conflicts"
          className="has-hint-above"
          onClick={onResolveConflicts}
        >
          Resolve conflicts ({conflictCount})
        </Button>
      )}

      {viewMode === 'history' && (
        <form className="spacer search-form" onSubmit={onSearchSubmit}>
          <div className="search-field">
            <Search className="search-field-icon" size={16} strokeWidth={1.75} aria-hidden />
            <input
              ref={searchRef}
              className="search"
              placeholder="Search messages, a commit SHA, or author:name…"
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              disabled={!activeRepo}
              title="Search commits"
            />
          </div>
        </form>
      )}
      {viewMode !== 'history' && <div className="spacer" />}

      <div className="toolbar-menu" ref={syncRef}>
        <button
          type="button"
          disabled={!activeRepo || busy}
          className={['btn-icon', 'has-hint', 'has-hint-above', syncMenuOpen ? 'primary' : '']
            .filter(Boolean)
            .join(' ')}
          onClick={() => setSyncMenuOpen((o) => !o)}
          title="Fetch, pull, or push"
          data-hint="Fetch, pull, or push"
        >
          <RefreshCw size={16} strokeWidth={1.75} />
          Sync{syncBadge ? <> {syncBadge}</> : null}
        </button>
        {syncMenuOpen && (
          <div className="dropdown-menu dropdown-menu-end" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              className="btn-icon has-hint has-hint-above"
              title="Fetch remotes"
              data-hint="Fetch remotes"
              onClick={() => {
                setSyncMenuOpen(false)
                onFetch()
              }}
            >
              <Download size={16} strokeWidth={1.75} />
              Fetch
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              className="btn-icon has-hint has-hint-above"
              title="Pull from upstream"
              data-hint="Pull from upstream"
              onClick={() => {
                setSyncMenuOpen(false)
                onPull()
              }}
            >
              <ArrowDownToLine size={16} strokeWidth={1.75} />
              Pull
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={busy}
              className="btn-icon has-hint has-hint-above"
              title="Push to upstream"
              data-hint="Push to upstream"
              onClick={() => {
                setSyncMenuOpen(false)
                onPush()
              }}
            >
              <ArrowUpFromLine size={16} strokeWidth={1.75} />
              Push
            </button>
          </div>
        )}
      </div>

      <SegmentedControl
        ariaLabel="Theme"
        value={theme}
        onChange={onThemeChange}
        options={[
          {
            value: 'system',
            label: 'System',
            hint: 'Match system theme',
            icon: <Monitor size={14} strokeWidth={1.75} />
          },
          {
            value: 'light',
            label: 'Light',
            hint: 'Light theme',
            icon: <Sun size={14} strokeWidth={1.75} />
          },
          {
            value: 'dark',
            label: 'Dark',
            hint: 'Dark theme',
            icon: <Moon size={14} strokeWidth={1.75} />
          }
        ]}
      />
    </header>
  )
}
