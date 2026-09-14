import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import {
  Archive,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  History,
  ListMinus,
  ListPlus,
  Minus,
  Pencil,
  Play,
  Plus,
  Trash2
} from 'lucide-react'
import type { DiffResult, GitIdentity, StashEntry, StatusEntry } from '@shared/ipc'
import { FileDiffViewer } from '../diff/FileDiffViewer'
import { OperationBar } from '../../components/OperationBar'
import { Splitter } from '../../components/Splitter'
import { Button, RefPill } from '../../components/ui'
import { NOTHING_STAGED_COMMIT } from '@shared/git-messages'
import { toErrorMessage } from '../../lib/errors'

export type DiffSide = 'staged' | 'unstaged'

interface Props {
  repoPath: string
  status: StatusEntry[]
  focusedPath: string | null
  diffSide: DiffSide
  diff: DiffResult | null
  diffLoading: boolean
  onFocusFile: (path: string) => void
  onDiffSideChange: (side: DiffSide) => void
  onRefresh: () => Promise<void>
  onError: (msg: string | null) => void
  onBrowseHistory?: () => void
  onEditIdentity?: () => void
  identity?: GitIdentity | null
  canAmend?: boolean
  rebaseInProgress?: boolean
  onRebaseContinue?: () => Promise<void>
  onRebaseSkip?: () => Promise<void>
  onRebaseAbort?: () => Promise<void>
  mergeInProgress?: boolean
  onMergeAbort?: () => Promise<void>
  filesWidth?: number
  onFilesWidthChange?: (width: number) => void
  onFilesWidthCommit?: (width: number) => void
}

function defaultSideFor(entry: StatusEntry | undefined): DiffSide {
  if (!entry) return 'unstaged'
  if (entry.unstaged || entry.untracked) return 'unstaged'
  if (entry.staged) return 'staged'
  return 'unstaged'
}

function formatIdentity(id: GitIdentity | null | undefined): string {
  if (!id) return 'Loading identity…'
  if (!id.name && !id.email) return 'No name/email set — commits will fail'
  if (!id.name) return `(no name) <${id.email}>`
  if (!id.email) return `${id.name} <no email>`
  return `${id.name} <${id.email}>`
}

const STAGE_BEFORE_COMMIT = NOTHING_STAGED_COMMIT

export function WorkingTreeDetailPane({
  repoPath,
  status,
  focusedPath,
  diffSide,
  diff,
  diffLoading,
  onFocusFile,
  onDiffSideChange,
  onRefresh,
  onError,
  onBrowseHistory,
  onEditIdentity,
  identity,
  canAmend = false,
  rebaseInProgress = false,
  onRebaseContinue,
  onRebaseSkip,
  onRebaseAbort,
  mergeInProgress = false,
  onMergeAbort,
  filesWidth = 300,
  onFilesWidthChange,
  onFilesWidthCommit
}: Props): React.JSX.Element {
  const [message, setMessage] = useState('')
  const [amend, setAmend] = useState(false)
  const [pushAfterCommit, setPushAfterCommit] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [stagedExpanded, setStagedExpanded] = useState(true)
  const [changesExpanded, setChangesExpanded] = useState(true)

  const focused = useMemo(() => status.find((s) => s.path === focusedPath), [status, focusedPath])
  const bothSides = Boolean(focused?.staged && focused?.unstaged)
  const identityReady = Boolean(identity?.name && identity?.email)
  const stagedEntries = useMemo(() => status.filter((s) => s.staged), [status])
  const changesEntries = useMemo(
    () => status.filter((s) => s.unstaged || s.untracked),
    [status]
  )
  const stageablePaths = useMemo(() => changesEntries.map((s) => s.path), [changesEntries])
  const unstageablePaths = useMemo(() => stagedEntries.map((s) => s.path), [stagedEntries])

  const loadStashes = async (): Promise<void> => {
    try {
      setStashes(await window.gitManager.git.stashList(repoPath))
    } catch {
      setStashes([])
    }
  }

  useEffect(() => {
    void loadStashes()
  }, [repoPath, status.length])

  useEffect(() => {
    if (!canAmend) setAmend(false)
  }, [canAmend])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    onError(null)
    try {
      await fn()
    } catch (err) {
      onError(toErrorMessage(err))
    } finally {
      // Refresh after failures too: a failed step (a push after a successful commit, a stash pop
      // with conflicts) can still have changed the repository.
      await onRefresh().catch(() => undefined)
      await loadStashes()
      setBusy(false)
    }
  }

  // Concluding a merge may legitimately commit no new changes (e.g. every conflict resolved as ours).
  const needsStageBeforeCommit = !amend && !mergeInProgress && stagedEntries.length === 0

  const toggleChecked = (path: string): void => {
    setChecked((prev) => (prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path]))
  }

  const setGroupChecked = (paths: string[], selected: boolean): void => {
    setChecked((prev) => {
      if (selected) return [...new Set([...prev, ...paths])]
      const drop = new Set(paths)
      return prev.filter((p) => !drop.has(p))
    })
  }

  const groupAllChecked = (paths: string[]): boolean =>
    paths.length > 0 && paths.every((p) => checked.includes(p))

  const targets = checked

  const renderFileRow = (s: StatusEntry, side: DiffSide): React.JSX.Element => (
    <li
      key={`${side}:${s.path}`}
      className={[
        focusedPath === s.path && diffSide === side ? 'active' : '',
        checked.includes(s.path) ? 'checked' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={() => {
        onFocusFile(s.path)
        onDiffSideChange(side)
      }}
      title={s.path}
    >
      <div className="row-inline">
        <input
          type="checkbox"
          checked={checked.includes(s.path)}
          onChange={() => toggleChecked(s.path)}
          onClick={(e) => e.stopPropagation()}
          title="Check to include in Stage / Unstage / Discard"
        />
        <code className="status-code">
          {s.indexStatus}
          {s.workTreeStatus}
        </code>
        <span className="cell-ellipsis">{s.path}</span>
        {s.conflicted && <RefPill tone="danger">conflict</RefPill>}
      </div>
    </li>
  )

  const renderFileSection = (
    label: string,
    entries: StatusEntry[],
    side: DiffSide,
    expanded: boolean,
    onToggle: () => void
  ): React.JSX.Element | null => {
    if (entries.length === 0) return null
    const paths = entries.map((s) => s.path)
    return (
      <div className="changes-file-section">
        <div className="changes-file-section-header">
          <label className="row-inline changes-select-all changes-file-section-check">
            <input
              type="checkbox"
              checked={groupAllChecked(paths)}
              disabled={busy}
              onChange={(e) => setGroupChecked(paths, e.target.checked)}
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
            <span className="muted">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>
        </div>
        {expanded && <ul className="file-list">{entries.map((s) => renderFileRow(s, side))}</ul>}
      </div>
    )
  }

  const identityBar = (
    <div className="identity-bar">
      <div className="cell-ellipsis muted" title={formatIdentity(identity)}>
        Committing as {formatIdentity(identity)}
      </div>
      {onEditIdentity && (
        <button type="button" className="ghost-btn" onClick={onEditIdentity}>
          Change…
        </button>
      )}
    </div>
  )

  const operationBar = rebaseInProgress ? (
    <OperationBar
      kind="rebase"
      variant="pane"
      busy={busy}
      onContinue={onRebaseContinue ? () => run(() => onRebaseContinue()) : undefined}
      onSkip={onRebaseSkip ? () => run(() => onRebaseSkip()) : undefined}
      onAbort={onRebaseAbort ? () => run(() => onRebaseAbort()) : undefined}
    />
  ) : mergeInProgress ? (
    <OperationBar
      kind="merge"
      variant="pane"
      busy={busy}
      onAbort={onMergeAbort ? () => run(() => onMergeAbort()) : undefined}
    />
  ) : null

  const stashPanel = (
    <div className="stash-panel">
      <div className="stash-panel-header">
        <span className="panel-title stash-title">Stashes</span>
        <Button
          icon={<Archive size={16} strokeWidth={1.75} />}
          disabled={busy || status.length === 0 || !canAmend}
          hint={
            status.length === 0
              ? 'Nothing to stash'
              : !canAmend
                ? 'Cannot stash before the first commit'
                : 'Stash including untracked'
          }
          title={
            status.length === 0
              ? 'Nothing to stash'
              : !canAmend
                ? 'Cannot stash before the first commit'
                : 'Stash including untracked'
          }
          onClick={() => void run(() => window.gitManager.git.stash(repoPath))}
        >
          Stash
        </Button>
      </div>
      {stashes.length === 0 ? (
        <p className="muted text-sm stash-empty">No stashes</p>
      ) : (
        <ul className="stash-list">
          {stashes.map((s) => (
            <li key={s.reflogSelector}>
              <div className="cell-ellipsis" title={s.message}>
                <code>{s.reflogSelector}</code> {s.message}
              </div>
              <div className="stash-row-actions">
                <Button
                  icon={<Play size={14} strokeWidth={1.75} />}
                  disabled={busy}
                  hint="Apply stash (keep entry)"
                  title="Apply stash (keep entry)"
                  onClick={() => void run(() => window.gitManager.git.stashApply(repoPath, s.reflogSelector))}
                >
                  Apply
                </Button>
                <Button
                  icon={<ArrowUpFromLine size={14} strokeWidth={1.75} />}
                  disabled={busy}
                  hint="Pop stash (apply and drop)"
                  title="Pop stash (apply and drop)"
                  onClick={() => void run(() => window.gitManager.git.stashPop(repoPath, s.reflogSelector))}
                >
                  Pop
                </Button>
                <Button
                  icon={<Trash2 size={14} strokeWidth={1.75} />}
                  disabled={busy}
                  hint={`Drop ${s.reflogSelector}`}
                  title={`Drop ${s.reflogSelector}`}
                  onClick={() => {
                    if (!confirm(`Drop ${s.reflogSelector}?`)) return
                    void run(() => window.gitManager.git.stashDrop(repoPath, s.reflogSelector))
                  }}
                >
                  Drop
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  // While merging, keep the commit form even with a clean tree so the merge can be concluded.
  if (status.length === 0 && !mergeInProgress) {
    return (
      <div className="changes-workspace changes-workspace-empty">
        <div className="empty-state changes-empty">
          <div>
            <h3>Working tree clean</h3>
            <p className="muted">No uncommitted changes.</p>
            {onBrowseHistory && (
              <Button
                variant="primary"
                className="mt-3"
                icon={<History size={16} strokeWidth={1.75} />}
                hint="Browse commit history"
                title="Browse commit history"
                onClick={onBrowseHistory}
              >
                Browse History
              </Button>
            )}
          </div>
        </div>
        <div className="changes-footer-stack">
          {operationBar}
          {stashPanel}
          {identityBar}
        </div>
      </div>
    )
  }

  return (
    <div className="changes-workspace" style={{ ['--changes-files-width' as string]: `${filesWidth}px` }}>
      <aside className="changes-sidebar">
        <div className="changes-sidebar-header">
          <div className="panel-title changes-files-title">
            <label className="row-inline changes-select-all">
              <input
                type="checkbox"
                checked={status.length > 0 && checked.length === status.length}
                disabled={busy || status.length === 0}
                onChange={(e) => {
                  setChecked(e.target.checked ? status.map((s) => s.path) : [])
                }}
                title="Select all files"
              />
              <span>Files</span>
            </label>
          </div>
          <span className="muted text-sm changes-files-meta">
            {status.length} file{status.length === 1 ? '' : 's'}
            {status.length > 0 && (
              <>
                {' · '}
                <span className="changes-count-staged">{stagedEntries.length}</span> staged
                {' · '}
                <span className="changes-count-unstaged">{changesEntries.length}</span> unstaged
              </>
            )}
            {checked.length > 0 ? ` · ${checked.length} selected` : ''}
          </span>
          {operationBar}
          <div className="changes-actions">
            <Button
              icon={<Plus size={16} strokeWidth={1.75} />}
              hint="Stage selected files"
              title="Stage selected files"
              disabled={busy || !targets.length}
              onClick={() =>
                void run(async () => {
                  await window.gitManager.git.stage(repoPath, targets)
                  setChecked([])
                })
              }
            >
              Stage
            </Button>
            <Button
              icon={<ListPlus size={16} strokeWidth={1.75} />}
              hint="Stage every unstaged and untracked file"
              title="Stage every unstaged and untracked file"
              disabled={busy || !stageablePaths.length}
              onClick={() => {
                const paths = stageablePaths
                void run(async () => {
                  await window.gitManager.git.stage(repoPath, paths)
                  setChecked([])
                })
              }}
            >
              Stage all
            </Button>
            <Button
              icon={<Minus size={16} strokeWidth={1.75} />}
              hint="Unstage selected files"
              title="Unstage selected files"
              disabled={busy || !targets.length}
              onClick={() =>
                void run(async () => {
                  await window.gitManager.git.unstage(repoPath, targets)
                  setChecked([])
                })
              }
            >
              Unstage
            </Button>
            <Button
              icon={<ListMinus size={16} strokeWidth={1.75} />}
              hint="Unstage every staged file"
              title="Unstage every staged file"
              disabled={busy || !unstageablePaths.length}
              onClick={() => {
                const paths = unstageablePaths
                void run(async () => {
                  await window.gitManager.git.unstage(repoPath, paths)
                  setChecked([])
                })
              }}
            >
              Unstage all
            </Button>
            <Button
              icon={<Trash2 size={16} strokeWidth={1.75} />}
              hint="Discard local changes for selected files"
              title="Discard local changes for selected files"
              disabled={busy || !targets.length}
              onClick={() => {
                if (
                  !confirm(
                    'Discard changes in the selected files?\n\nModified files go back to their staged or committed version. Untracked files are moved to the Trash.'
                  )
                ) {
                  return
                }
                void run(async () => {
                  await window.gitManager.git.discard(repoPath, targets)
                  setChecked([])
                })
              }}
            >
              Discard
            </Button>
          </div>
        </div>
        <div className="changes-file-list">
          {renderFileSection('Staged', stagedEntries, 'staged', stagedExpanded, () =>
            setStagedExpanded((v) => !v)
          )}
          {renderFileSection('Changes', changesEntries, 'unstaged', changesExpanded, () =>
            setChangesExpanded((v) => !v)
          )}
        </div>
        {stashPanel}
        <div className="changes-commit-form">
          {identityBar}
          {!identityReady && (
            <p className="muted text-sm" style={{ margin: 0 }}>
              Set your name and email before committing.
            </p>
          )}
          {needsStageBeforeCommit && changesEntries.length > 0 && (
            <p className="muted text-sm" style={{ margin: 0 }}>
              Stage files with <strong>Stage</strong> or <strong>Stage all</strong> before committing.
            </p>
          )}
          <textarea
            rows={3}
            placeholder="Commit message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <label className="amend-check row-inline text-sm">
            <input
              type="checkbox"
              checked={amend}
              disabled={!canAmend || busy}
              onChange={(e) => setAmend(e.target.checked)}
            />
            Amend last commit
          </label>
          {amend && (
            <p className="muted text-xs" style={{ margin: 0 }}>
              Replaces HEAD with this message and any staged changes.
            </p>
          )}
          <label className="amend-check row-inline text-sm">
            <input
              type="checkbox"
              checked={pushAfterCommit}
              disabled={busy}
              onChange={(e) => setPushAfterCommit(e.target.checked)}
            />
            Push to remote
          </label>
          <Button
            variant="primary"
            icon={
              amend ? (
                <Pencil size={16} strokeWidth={1.75} />
              ) : (
                <Check size={16} strokeWidth={1.75} />
              )
            }
            hint={
              needsStageBeforeCommit && changesEntries.length > 0
                ? STAGE_BEFORE_COMMIT
                : amend
                  ? 'Amend the last commit'
                  : 'Create a new commit'
            }
            title={
              needsStageBeforeCommit && changesEntries.length > 0
                ? STAGE_BEFORE_COMMIT
                : amend
                  ? 'Amend the last commit'
                  : 'Create a new commit'
            }
            disabled={busy || !message.trim() || !identityReady}
            onClick={() =>
              void run(async () => {
                if (needsStageBeforeCommit) {
                  if (changesEntries.length > 0) throw new Error(STAGE_BEFORE_COMMIT)
                  throw new Error('Nothing to commit — the working tree is clean.')
                }
                await window.gitManager.git.commit(repoPath, message.trim(), amend)
                // The commit exists now: clear the form before pushing, which can fail on its own.
                setMessage('')
                setAmend(false)
                setChecked([])
                if (pushAfterCommit) {
                  try {
                    await window.gitManager.git.push(repoPath)
                  } catch (err) {
                    throw new Error(`Committed, but the push failed: ${toErrorMessage(err)}`)
                  }
                }
              })
            }
          >
            {amend ? 'Amend' : 'Commit'}
          </Button>
        </div>
      </aside>
      {onFilesWidthChange && (
        <Splitter
          axis="x"
          className="splitter-inline-x"
          value={filesWidth}
          min={200}
          max={560}
          onChange={onFilesWidthChange}
          onChangeEnd={onFilesWidthCommit}
          title="Resize changes panel"
        />
      )}
      <div className="diff-host changes-diff">
        {bothSides && (
          <div className="diff-side-tabs">
            <span className="muted">Show</span>
            <button className={diffSide === 'unstaged' ? 'primary' : ''} onClick={() => onDiffSideChange('unstaged')}>
              Unstaged
            </button>
            <button className={diffSide === 'staged' ? 'primary' : ''} onClick={() => onDiffSideChange('staged')}>
              Staged
            </button>
          </div>
        )}
        <div className="diff-editor-slot">
          {diffLoading ? (
            <div className="empty-state muted">Loading diff…</div>
          ) : diff ? (
            <FileDiffViewer diff={diff} editorKey={`${diff.path}:${diffSide}`} sideBySide />
          ) : (
            <div className="empty-state muted">Select a file to view its changes</div>
          )}
        </div>
      </div>
    </div>
  )
}

export { defaultSideFor }
