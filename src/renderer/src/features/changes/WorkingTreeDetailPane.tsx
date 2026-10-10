import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import {
  Archive,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  History,
  ListMinus,
  ListPlus,
  Minus,
  Play,
  Plus,
  Trash2
} from 'lucide-react'
import type { GitIdentity, PartialAction, PartialSelection, StashEntry } from '@shared/ipc'
import { ChangesFileList } from './ChangesFileList'
import { CommitForm } from './CommitForm'
import { DiffViewSwitch } from '../diff/DiffViewSwitch'
import { SyntaxHighlightToggle } from '../diff/SyntaxHighlightToggle'
import { FileDiffViewer } from '../diff/FileDiffViewer'
import { OperationBar } from '../../components/OperationBar'
import { Splitter } from '../../components/Splitter'
import { Button, IconButton, SegmentedControl } from '../../components/ui'
import { CONFIRM_DISCARD, confirmDiscardPart, confirmDropStash } from '../../lib/copy'
import { toErrorMessage } from '../../lib/errors'
import { useAppStatusActions } from '../../state/AppStatusProvider'
import { useConfirm } from '../../state/ConfirmProvider'
import { useDialogActions } from '../../state/DialogsProvider'
import { useGitActions } from '../../state/GitActionsProvider'
import { useHistoryState } from '../../state/HistoryProvider'
import {
  useLayoutActions,
  useLayoutPaneFiles,
  useLayoutPrefsState
} from '../../state/LayoutProvider'
import { useActiveRepo, useSession, useSessionActions, useStatus } from '../../state/RepoSessionProvider'
import {
  useSelectionActions,
  useSelectionDiffContent,
  useSelectionFocus
} from '../../state/SelectionProvider'
import { useWorkingTreeActions } from '../../state/WorkingTreeProvider'

function formatIdentity(id: GitIdentity | null | undefined): string {
  if (!id) return 'Loading identity…'
  if (!id.name && !id.email) return 'No name/email set — commits will fail'
  if (!id.name) return `(no name) <${id.email}>`
  if (!id.email) return `${id.name} <no email>`
  return `${id.name} <${id.email}>`
}

const NONE_CHECKED: ReadonlySet<string> = new Set()

export const WorkingTreeDetailPane = memo(function WorkingTreeDetailPane(): React.JSX.Element {
  const repoPath = useActiveRepo().path
  const { status } = useStatus()
  const { identity, rebaseInProgress, mergeInProgress, sequencerOp } = useSession()
  const { afterGitMutation } = useSessionActions()
  const { focusedStatusPath: focusedPath, diffSide } = useSelectionFocus()
  const { diff, diffLoading } = useSelectionDiffContent()
  const { setDiffSide } = useSelectionActions()
  const { headSha } = useHistoryState()
  const { setError: onError } = useAppStatusActions()
  const { goHistory } = useWorkingTreeActions()
  const { openDialog } = useDialogActions()
  const { rebaseContinue, rebaseSkip, rebaseAbort, mergeAbort, sequencerStep } = useGitActions()
  const { diffView, syntaxHighlighting } = useLayoutPrefsState()
  const { persistLayout } = useLayoutActions()
  const { changesFilesWidth: filesWidth, setChangesFilesWidth } = useLayoutPaneFiles()
  const confirm = useConfirm()
  const canAmend = Boolean(headSha)

  const [checked, setChecked] = useState<ReadonlySet<string>>(NONE_CHECKED)
  const [busy, setBusy] = useState(false)
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [stashesExpanded, setStashesExpanded] = useState(false)

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

  const loadStashes = useCallback(async (): Promise<void> => {
    try {
      setStashes(await window.gitManager.git.stashList(repoPath))
    } catch {
      setStashes([])
    }
  }, [repoPath])

  // Stashing, popping and committing change the file count; reload the stash list when it changes.
  useEffect(() => {
    let cancelled = false
    window.gitManager.git.stashList(repoPath).then(
      (list) => {
        if (!cancelled) setStashes(list)
      },
      () => {
        if (!cancelled) setStashes([])
      }
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, status.length])

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
      await afterGitMutation({ history: 'tip' }).catch(() => undefined)
      await loadStashes()
      setBusy(false)
    }
  }

  /** Stage, unstage or discard one hunk or the selected lines of the diff shown. */
  const applyPartial = async (selection: PartialSelection, action: PartialAction): Promise<void> => {
    const fingerprint = diff?.hunks?.fingerprint
    const path = diff?.path
    if (!fingerprint || !path) return
    if (action === 'discard' && !(await confirm(confirmDiscardPart('hunk' in selection ? 'hunk' : 'lines', path)))) {
      return
    }
    await run(() =>
      window.gitManager.git.applyPartial({ repoPath, path, side: diffSide, action, fingerprint, selection })
    )
  }

  const toggleChecked = useCallback((path: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }, [])

  const setGroupChecked = useCallback((paths: string[], selected: boolean): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const p of paths) {
        if (selected) next.add(p)
        else next.delete(p)
      }
      return next
    })
  }, [])

  const clearChecked = useCallback((): void => setChecked(NONE_CHECKED), [])

  const targets = useMemo(() => [...checked], [checked])

  const identityBar = (
    <div className="identity-bar">
      <div className="cell-ellipsis muted" title={formatIdentity(identity)}>
        Committing as {formatIdentity(identity)}
      </div>
      <button type="button" className="ghost-btn" onClick={() => openDialog('identity')}>
        Change
      </button>
    </div>
  )

  const operationBar = rebaseInProgress ? (
    <OperationBar
      kind="rebase"
      variant="pane"
      busy={busy}
      onContinue={() => run(rebaseContinue)}
      onSkip={() => run(rebaseSkip)}
      onAbort={() => run(rebaseAbort)}
    />
  ) : mergeInProgress ? (
    <OperationBar kind="merge" variant="pane" busy={busy} onAbort={() => run(mergeAbort)} />
  ) : sequencerOp ? (
    <OperationBar
      kind={sequencerOp}
      variant="pane"
      busy={busy}
      onContinue={() => run(() => sequencerStep('continue'))}
      onSkip={() => run(() => sequencerStep('skip'))}
      onAbort={() => run(() => sequencerStep('abort'))}
    />
  ) : null

  const stashActionLabel =
    status.length === 0
      ? 'Nothing to stash'
      : !canAmend
        ? 'Cannot stash before the first commit'
        : 'Stash including untracked'

  const stashPanel = (
    <div className="stash-panel">
      <div className="stash-panel-header panel-disclosure-row">
        <button
          type="button"
          className="panel-title panel-disclosure"
          onClick={() => setStashesExpanded((v) => !v)}
          aria-expanded={stashesExpanded}
          title={stashesExpanded ? 'Collapse Stashes' : 'Expand Stashes'}
        >
          <span>
            Stashes{stashes.length > 0 ? ` (${stashes.length})` : ''}
          </span>
          <span className="muted">
            {stashesExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </button>
        <IconButton
          label={stashActionLabel}
          disabled={busy || status.length === 0 || !canAmend}
          onClick={() => void run(() => window.gitManager.git.stash(repoPath))}
        >
          <Archive size={16} strokeWidth={1.75} />
        </IconButton>
      </div>
      {stashesExpanded && (
        <div className="stash-panel-body">
          {stashes.length === 0 ? (
            <p className="muted text-sm stash-empty">No stashes</p>
          ) : (
            <ul className="stash-list" aria-label="Stashes">
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
                      onClick={() =>
                        void confirm(confirmDropStash(s.reflogSelector)).then((ok) => {
                          if (ok) void run(() => window.gitManager.git.stashDrop(repoPath, s.reflogSelector))
                        })
                      }
                    >
                      Drop
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
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
            <Button
              variant="primary"
              className="mt-3"
              icon={<History size={16} strokeWidth={1.75} />}
              hint="Browse commit history"
              title="Browse commit history"
              onClick={goHistory}
            >
              Browse History
            </Button>
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
                checked={status.length > 0 && status.every((s) => checked.has(s.path))}
                disabled={busy || status.length === 0}
                onChange={(e) => {
                  setChecked(e.target.checked ? new Set(status.map((s) => s.path)) : NONE_CHECKED)
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
            {checked.size > 0 ? ` · ${checked.size} selected` : ''}
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
                  setChecked(NONE_CHECKED)
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
                  setChecked(NONE_CHECKED)
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
                  setChecked(NONE_CHECKED)
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
                  setChecked(NONE_CHECKED)
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
                const paths = targets
                void confirm(CONFIRM_DISCARD).then((ok) => {
                  if (!ok) return
                  void run(async () => {
                    await window.gitManager.git.discard(repoPath, paths)
                    setChecked(NONE_CHECKED)
                  })
                })
              }}
            >
              Discard
            </Button>
          </div>
        </div>
        <ChangesFileList
          stagedEntries={stagedEntries}
          changesEntries={changesEntries}
          checked={checked}
          busy={busy}
          onToggleChecked={toggleChecked}
          onSetGroupChecked={setGroupChecked}
        />
        {stashPanel}
        <CommitForm
          // Each repository restores its own saved draft.
          key={repoPath}
          repoPath={repoPath}
          busy={busy}
          canAmend={canAmend}
          identityReady={identityReady}
          identityBar={identityBar}
          stagedCount={stagedEntries.length}
          changesCount={changesEntries.length}
          mergeInProgress={mergeInProgress}
          run={run}
          onCommitted={clearChecked}
        />
      </aside>
      <Splitter
        axis="x"
        className="splitter-inline-x"
        value={filesWidth}
        min={200}
        max={560}
        onChange={setChangesFilesWidth}
        onChangeEnd={(w) => persistLayout({ changesFilesWidth: w })}
        title="Resize changes panel"
      />
      <div className="diff-host changes-diff">
        <div className="diff-toolbar">
          {bothSides && (
            <>
              <span className="muted">Show</span>
              <SegmentedControl
                ariaLabel="Diff side"
                value={diffSide}
                onChange={setDiffSide}
                options={[
                  { value: 'unstaged', label: 'Unstaged', hint: 'Show the unstaged changes' },
                  { value: 'staged', label: 'Staged', hint: 'Show the staged changes' }
                ]}
              />
            </>
          )}
          <div className="diff-toolbar-end">
            <SyntaxHighlightToggle />
            <DiffViewSwitch />
          </div>
        </div>
        <div className="diff-editor-slot">
          {diffLoading ? (
            <div className="empty-state muted">Loading diff…</div>
          ) : diff ? (
            <FileDiffViewer
              diff={diff}
              editorKey={`${diff.path}:${diffSide}`}
              sideBySide={diffView === 'side-by-side'}
              syntaxHighlighting={syntaxHighlighting}
              hunkActions={busy || focused?.conflicted ? undefined : { side: diffSide, run: applyPartial }}
            />
          ) : (
            <div className="empty-state muted">Select a file to view its changes</div>
          )}
        </div>
      </div>
    </div>
  )
})
