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
  Sun,
  X
} from 'lucide-react'
import { Button, IconButton, SegmentedControl } from '../components/ui'
import { nextListIndex } from '../logic/list-nav'
import { useAppStatus } from '../state/AppStatusProvider'
import { useDialogActions } from '../state/DialogsProvider'
import { useGitActions, useRemoteOp, type RemoteOpState } from '../state/GitActionsProvider'
import { useLayoutPrefsState } from '../state/LayoutProvider'
import { useSession, useStatus } from '../state/RepoSessionProvider'
import { useSelectionCore } from '../state/SelectionProvider'
import { useWorkingTreeActions } from '../state/WorkingTreeProvider'
import { HistorySearchBox } from './HistorySearchBox'

const REMOTE_OP_LABEL = { fetch: 'Fetching', pull: 'Pulling', push: 'Pushing' } as const
const MENU_ITEMS = '[role="menuitem"]:not(:disabled)'

function remoteOpLabel(op: RemoteOpState): string {
  if (op.cancelling) return 'Cancelling…'
  const phase = op.phase ? ` · ${op.phase}` : '…'
  const percent = op.percent !== null ? ` ${op.percent}%` : ''
  return `${REMOTE_OP_LABEL[op.kind]}${phase}${percent}`
}

export function AppToolbar(): React.JSX.Element {
  const { busy } = useAppStatus()
  const { activeRepo, currentBranch } = useSession()
  const { status, conflictCount } = useStatus()
  const { viewMode } = useSelectionCore()
  const { prefs, setThemePref } = useLayoutPrefsState()
  const { goHistory, selectWorkingCopy } = useWorkingTreeActions()
  const { openDialog, openBranchDialog } = useDialogActions()
  const { runSync, cancelRemote } = useGitActions()
  const remoteOp = useRemoteOp()
  const hasRepo = Boolean(activeRepo)

  const [syncMenuOpen, setSyncMenuOpen] = useState(false)
  const syncRef = useRef<HTMLDivElement>(null)
  const syncTriggerRef = useRef<HTMLButtonElement>(null)
  const syncMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!syncMenuOpen) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (syncRef.current && !syncRef.current.contains(t)) setSyncMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [syncMenuOpen])

  // The menu opens with its first item focused, so the arrow keys work at once.
  useEffect(() => {
    if (syncMenuOpen) syncMenuRef.current?.querySelector<HTMLElement>(MENU_ITEMS)?.focus()
  }, [syncMenuOpen])

  const onSyncMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setSyncMenuOpen(false)
      syncTriggerRef.current?.focus()
      return
    }
    if (e.key === 'Tab') {
      setSyncMenuOpen(false)
      return
    }
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEMS)]
    const next = nextListIndex(e.key, items.indexOf(document.activeElement as HTMLElement), items.length, {
      wrap: true
    })
    if (next === null) return
    e.preventDefault()
    items[next].focus()
  }

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
        disabled={!hasRepo}
        value={viewMode}
        onChange={(mode) => {
          if (mode === 'history') goHistory()
          else selectWorkingCopy()
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
            label: status.length ? `Changes (${status.length})` : 'Changes',
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
          onClick={() => openDialog('mergeEditor')}
        >
          Resolve conflicts ({conflictCount})
        </Button>
      )}

      {viewMode === 'history' && <HistorySearchBox disabled={!hasRepo} />}
      {viewMode !== 'history' && <div className="spacer" />}

      {remoteOp ? (
        <div className="sync-progress" role="status" aria-live="polite" title={remoteOp.repoName}>
          <RefreshCw className="spin" size={16} strokeWidth={1.75} aria-hidden />
          <span className="sync-progress-label cell-ellipsis">{remoteOpLabel(remoteOp)}</span>
          <span className={`sync-progress-bar${remoteOp.percent === null ? ' indeterminate' : ''}`} aria-hidden>
            <span style={remoteOp.percent === null ? undefined : { width: `${remoteOp.percent}%` }} />
          </span>
          <IconButton
            label={`Cancel ${remoteOp.kind}`}
            hint={remoteOp.cancellable ? `Cancel ${remoteOp.kind}` : 'Updating files; this step cannot be cancelled'}
            className="has-hint-above"
            disabled={!remoteOp.cancellable || remoteOp.cancelling}
            onClick={cancelRemote}
          >
            <X size={14} strokeWidth={2} />
          </IconButton>
        </div>
      ) : (
        <div className="toolbar-menu" ref={syncRef}>
          <button
            ref={syncTriggerRef}
            type="button"
            disabled={!hasRepo || busy}
            aria-haspopup="menu"
            aria-expanded={syncMenuOpen}
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
            <div
              ref={syncMenuRef}
              className="dropdown-menu dropdown-menu-end"
              role="menu"
              aria-label="Sync"
              onKeyDown={onSyncMenuKeyDown}
            >
              <button
                type="button"
                role="menuitem"
                disabled={busy || !activeRepo?.remotes.length}
                className="btn-icon has-hint has-hint-above"
                title="Fetch remotes"
                data-hint="Fetch remotes"
                onClick={() => {
                  setSyncMenuOpen(false)
                  syncTriggerRef.current?.focus()
                  void runSync('fetch')
                }}
              >
                <Download size={16} strokeWidth={1.75} />
                Fetch
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={busy || !currentBranch?.upstream}
                className="btn-icon has-hint has-hint-above"
                title="Pull from upstream"
                data-hint="Pull from upstream"
                onClick={() => {
                  setSyncMenuOpen(false)
                  syncTriggerRef.current?.focus()
                  void runSync('pull')
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
                title={currentBranch?.upstream ? 'Push to upstream' : 'Review where to publish this branch'}
                data-hint={currentBranch?.upstream ? 'Push to upstream' : 'Review where to publish this branch'}
                onClick={() => {
                  setSyncMenuOpen(false)
                  syncTriggerRef.current?.focus()
                  void runSync('push')
                }}
              >
                <ArrowUpFromLine size={16} strokeWidth={1.75} />
                {currentBranch?.upstream ? 'Push' : 'Publish branch'}
              </button>
              {currentBranch?.upstream && <button type="button" role="menuitem" className="btn-icon" disabled={busy} onClick={() => {
                setSyncMenuOpen(false)
                syncTriggerRef.current?.focus()
                if (activeRepo) openBranchDialog({ kind: 'publish', repoPath: activeRepo.path, branchName: currentBranch.name })
              }}>Push to</button>}
            </div>
          )}
        </div>
      )}

      <SegmentedControl
        ariaLabel="Theme"
        value={prefs?.theme ?? 'system'}
        onChange={setThemePref}
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
