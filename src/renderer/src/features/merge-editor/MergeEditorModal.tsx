import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import Editor from '@monaco-editor/react'
import type { ConflictFile, ConflictSide, MergeSides } from '@shared/ipc'
import {
  applyRegionResolution,
  hasUnresolvedMarkers,
  parseConflictMarkers
} from '@merge-core/conflict'
import { OperationBar } from '../../components/OperationBar'
import { Banner, Button, Modal } from '../../components/ui'
import { confirmResolveByDeleting, MONACO_FONT_FAMILY } from '../../lib/copy'
import { toErrorMessage } from '../../lib/errors'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { syntaxLanguageFor } from '../../lib/syntax'
import { monacoThemeFor, useResolvedTheme } from '../../lib/theme'
import { tooLargeToHighlight } from '../../logic/syntax-language'
import { useLayout } from '../../state/LayoutProvider'
import { useConfirm } from '../../state/ConfirmProvider'
import { useDialogActions } from '../../state/DialogsProvider'
import { useGitActions } from '../../state/GitActionsProvider'
import { useActiveRepo, useSession, useSessionActions } from '../../state/RepoSessionProvider'
import { SyntaxHighlightToggle } from '../diff/SyntaxHighlightToggle'

const paneStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', minHeight: 0, gap: 4 }

const dialogStyle: React.CSSProperties = {
  width: 'min(1100px, 96vw)',
  height: 'min(820px, 92vh)',
  display: 'flex',
  flexDirection: 'column'
}

function takeSideLabel(file: ConflictFile | undefined, side: ConflictSide): string {
  const present = side === 'ours' ? file?.hasOurs : file?.hasTheirs
  return present ? `Take ${side} (whole file)` : `Take ${side} (delete file)`
}

/** A value that belongs to one load of one file: another file, or loading the file again, makes it stale. */
interface ForFile<T> {
  key: string
  value: T
}

export function MergeEditorModal(): React.JSX.Element {
  const repoPath = useActiveRepo().path
  const { rebaseInProgress, mergeInProgress, sequencerOp } = useSession()
  const { afterGitMutation } = useSessionActions()
  const { closeDialog } = useDialogActions()
  const { rebaseContinue, rebaseSkip, rebaseAbort, mergeAbort, sequencerStep } = useGitActions()
  const confirm = useConfirm()
  const onClose = (): void => closeDialog('mergeEditor')
  const editorKind = rebaseInProgress
    ? 'Rebase'
    : sequencerOp === 'cherry-pick'
      ? 'Cherry-pick'
      : sequencerOp === 'revert'
        ? 'Revert'
        : 'Merge'

  const theme = useResolvedTheme()
  const monacoTheme = monacoThemeFor(theme)
  const { syntaxHighlighting } = useLayout()
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const fileKey = activePath === null ? null : `${reloadKey}\0${activePath}`
  // Kept with the load they belong to, so a new file starts clean without resetting state in an effect.
  const [loaded, setLoaded] = useState<ForFile<MergeSides | null> | null>(null)
  const [edited, setEdited] = useState<ForFile<string> | null>(null)
  const [chosenRegion, setChosenRegion] = useState<ForFile<string> | null>(null)
  const { busy, error, setError, run } = useAsyncAction()

  const sides = loaded?.key === fileKey ? loaded.value : null
  const sidesLoading = fileKey !== null && loaded?.key !== fileKey
  const result = edited?.key === fileKey ? edited.value : (sides?.result ?? '')
  const activeRegionId = chosenRegion?.key === fileKey ? chosenRegion.value : null
  const setResult = (text: string): void => {
    if (fileKey !== null) setEdited({ key: fileKey, value: text })
  }
  const setActiveRegionId = (id: string | null): void => {
    setChosenRegion(fileKey !== null && id ? { key: fileKey, value: id } : null)
  }

  const showFiles = useCallback((list: ConflictFile[]): void => {
    setFiles(list)
    setActivePath((prev) => (prev && list.some((f) => f.path === prev) ? prev : (list[0]?.path ?? null)))
    setReloadKey((k) => k + 1)
  }, [])

  const loadFiles = useCallback(async (): Promise<ConflictFile[]> => {
    const list = await window.gitManager.merge.listConflicts(repoPath)
    showFiles(list)
    return list
  }, [repoPath, showFiles])

  useEffect(() => {
    let cancelled = false
    window.gitManager.merge.listConflicts(repoPath).then(
      (list) => {
        if (!cancelled) showFiles(list)
      },
      (err) => {
        if (!cancelled) setError(toErrorMessage(err))
      }
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, showFiles, setError])

  useEffect(() => {
    if (activePath === null || fileKey === null) return
    // Ignore responses for a file the user already navigated away from.
    let cancelled = false
    window.gitManager.merge.getSides(repoPath, activePath).then(
      (s) => {
        if (!cancelled) setLoaded({ key: fileKey, value: s })
      },
      (err) => {
        if (cancelled) return
        // This load has nothing to show; it is no longer loading either.
        setLoaded({ key: fileKey, value: null })
        setError(toErrorMessage(err))
      }
    )
    return () => {
      cancelled = true
    }
  }, [activePath, fileKey, repoPath, setError])

  // Regions always come from the current text, so manual edits never leave stale line ranges.
  const regions = useMemo(() => parseConflictMarkers(result), [result])
  const activeRegion = regions.find((r) => r.id === activeRegionId) ?? regions[0] ?? null
  const activeFile = files.find((f) => f.path === activePath)
  const textEditable = Boolean(sides && !sides.binary && !sides.tooLarge)
  const oneSideDeleted = Boolean(activeFile && (!activeFile.hasOurs || !activeFile.hasTheirs))
  // Decided by the sides as loaded, not by the result being edited, so colors never switch off mid-edit.
  const longestSide = Math.max(sides?.ours.length ?? 0, sides?.theirs.length ?? 0, sides?.result.length ?? 0)
  const language = activePath ? syntaxLanguageFor(activePath, syntaxHighlighting, longestSide) : 'plaintext'

  const acceptRegion = (choice: 'ours' | 'theirs' | 'both'): void => {
    if (!activeRegion) return
    setResult(applyRegionResolution(result, activeRegion, choice).text)
    setActiveRegionId(null)
  }

  const afterResolved = async (): Promise<void> => {
    const remaining = await loadFiles()
    await afterGitMutation({ history: 'full' })
    // While rebasing, cherry-picking or reverting, stay open so the user can continue from here.
    if (remaining.length === 0 && !rebaseInProgress && !sequencerOp) onClose()
  }

  const save = (): void => {
    if (!activePath || !textEditable) return
    if (hasUnresolvedMarkers(result)) {
      setError('Resolve all conflict markers before saving.')
      return
    }
    const path = activePath
    void run(async () => {
      await window.gitManager.merge.saveResult(repoPath, path, result)
      await afterResolved()
    })
  }

  const takeSide = async (side: ConflictSide): Promise<void> => {
    if (!activePath) return
    const path = activePath
    const deletes = side === 'ours' ? !activeFile?.hasOurs : !activeFile?.hasTheirs
    if (deletes && !(await confirm(confirmResolveByDeleting(path)))) return
    void run(async () => {
      await window.gitManager.merge.resolveSide(repoPath, path, side)
      await afterResolved()
    })
  }

  const editorOpts = {
    minimap: { enabled: false },
    fontSize: 12,
    fontFamily: MONACO_FONT_FAMILY
  }

  return (
    <Modal
      title={`${editorKind} editor — ${activePath || 'no conflicts'}`}
      onClose={onClose}
      // Escape or a stray click must not throw away unsaved edits in the result.
      dismissible={false}
      className="merge-editor-modal"
      bodyClassName="merge-editor-body"
      style={dialogStyle}
      footer={
        <div className="modal-actions">
          <Button onClick={onClose}>Close</Button>
          <Button
            variant="primary"
            disabled={busy || sidesLoading || !activePath || !textEditable}
            onClick={save}
          >
            Save &amp; stage
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        The result starts from Git&apos;s merge: changes that don&apos;t overlap are already combined,
        and markers remain only where both sides changed the same lines.
      </p>
      {error && <Banner>{error}</Banner>}
      {oneSideDeleted && textEditable && (
        <Banner tone="info">
          One side deleted this file. Save &amp; stage keeps the version below; taking the deleting
          side removes the file.
        </Banner>
      )}
      {rebaseInProgress ? (
        <OperationBar
          kind="rebase"
          busy={busy}
          // Each step refreshes the repository and closes this editor once no conflicts remain.
          onContinue={() =>
            run(async () => {
              await rebaseContinue()
              await loadFiles()
            })
          }
          onSkip={() =>
            run(async () => {
              await rebaseSkip()
              await loadFiles()
            })
          }
          onAbort={() =>
            run(async () => {
              await rebaseAbort()
              onClose()
            })
          }
        />
      ) : mergeInProgress ? (
        <OperationBar
          kind="merge"
          busy={busy}
          onAbort={() =>
            run(async () => {
              await mergeAbort()
              onClose()
            })
          }
        />
      ) : sequencerOp ? (
        <OperationBar
          kind={sequencerOp}
          busy={busy}
          onContinue={() =>
            run(async () => {
              await sequencerStep('continue')
              await loadFiles()
            })
          }
          onSkip={() =>
            run(async () => {
              await sequencerStep('skip')
              await loadFiles()
            })
          }
          onAbort={() =>
            run(async () => {
              await sequencerStep('abort')
              onClose()
            })
          }
        />
      ) : null}
      <div className="conflict-list">
        {files.map((f) => (
          <button
            key={f.path}
            className={f.path === activePath ? 'primary' : ''}
            onClick={() => setActivePath(f.path)}
          >
            {f.path}
          </button>
        ))}
        {files.length === 0 && <span className="muted">No unmerged paths</span>}
      </div>
      <div className="merge-toolbar">
        {textEditable && (
          <>
            <button disabled={!activeRegion} onClick={() => acceptRegion('ours')}>
              Accept Ours
            </button>
            <button disabled={!activeRegion} onClick={() => acceptRegion('theirs')}>
              Accept Theirs
            </button>
            <button disabled={!activeRegion} onClick={() => acceptRegion('both')}>
              Accept Both
            </button>
            <select
              value={activeRegion?.id ?? ''}
              onChange={(e) => setActiveRegionId(e.target.value)}
              disabled={!regions.length}
            >
              {regions.map((r, i) => (
                <option key={r.id} value={r.id}>
                  Conflict {i + 1} of {regions.length}
                </option>
              ))}
            </select>
            {sides && regions.length === 0 && (
              <span className="muted">No conflict markers left</span>
            )}
            <SyntaxHighlightToggle />
            {syntaxHighlighting && tooLargeToHighlight(longestSide) && (
              <span className="muted">Too large for syntax colors</span>
            )}
          </>
        )}
        <div className="spacer" />
        <Button disabled={busy || sidesLoading || !activePath} onClick={() => void takeSide('ours')}>
          {takeSideLabel(activeFile, 'ours')}
        </Button>
        <Button disabled={busy || sidesLoading || !activePath} onClick={() => void takeSide('theirs')}>
          {takeSideLabel(activeFile, 'theirs')}
        </Button>
      </div>
      <div className="merge-editors" style={{ flex: 1 }}>
        {sides && !textEditable ? (
          <div className="empty-state" style={{ gridColumn: '1 / -1' }}>
            {sides.binary
              ? 'Binary file — it can’t be edited here. Take ours or theirs.'
              : 'This file is too large to edit here. Take ours or theirs.'}
          </div>
        ) : (
          <>
            <div style={paneStyle}>
              <span className="muted text-xs">Ours</span>
              <Editor
                key={`ours:${activePath}`}
                height="100%"
                theme={monacoTheme}
                language={language}
                value={sides?.ours || ''}
                options={{ ...editorOpts, readOnly: true }}
              />
            </div>
            <div style={paneStyle}>
              <span className="muted text-xs">Result</span>
              <Editor
                key={`result:${activePath}`}
                height="100%"
                theme={monacoTheme}
                language={language}
                value={result}
                onChange={(v) => setResult(v ?? '')}
                options={editorOpts}
              />
            </div>
            <div style={paneStyle}>
              <span className="muted text-xs">Theirs</span>
              <Editor
                key={`theirs:${activePath}`}
                height="100%"
                theme={monacoTheme}
                language={language}
                value={sides?.theirs || ''}
                options={{ ...editorOpts, readOnly: true }}
              />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
