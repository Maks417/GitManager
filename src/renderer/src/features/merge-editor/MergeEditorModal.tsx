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
import { Banner, Button } from '../../components/ui'
import { MONACO_FONT_FAMILY } from '../../lib/copy'
import { toErrorMessage } from '../../lib/errors'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { monacoThemeFor, useResolvedTheme } from '../../lib/theme'

interface Props {
  repoPath: string
  onClose: () => void
  onResolved: () => Promise<void>
  rebaseInProgress?: boolean
  onRebaseContinue?: () => Promise<void>
  onRebaseSkip?: () => Promise<void>
  onRebaseAbort?: () => Promise<void>
  mergeInProgress?: boolean
  onMergeAbort?: () => Promise<void>
}

const paneStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', minHeight: 0, gap: 4 }

function takeSideLabel(file: ConflictFile | undefined, side: ConflictSide): string {
  const present = side === 'ours' ? file?.hasOurs : file?.hasTheirs
  return present ? `Take ${side} (whole file)` : `Take ${side} (delete file)`
}

export function MergeEditorModal({
  repoPath,
  onClose,
  onResolved,
  rebaseInProgress = false,
  onRebaseContinue,
  onRebaseSkip,
  onRebaseAbort,
  mergeInProgress = false,
  onMergeAbort
}: Props): React.JSX.Element {
  const theme = useResolvedTheme()
  const monacoTheme = monacoThemeFor(theme)
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [sides, setSides] = useState<MergeSides | null>(null)
  const [sidesLoading, setSidesLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [result, setResult] = useState('')
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
  const { busy, error, setError, run } = useAsyncAction()

  const loadFiles = useCallback(async (): Promise<ConflictFile[]> => {
    const list = await window.gitManager.merge.listConflicts(repoPath)
    setFiles(list)
    setActivePath((prev) => (prev && list.some((f) => f.path === prev) ? prev : (list[0]?.path ?? null)))
    setReloadKey((k) => k + 1)
    return list
  }, [repoPath])

  useEffect(() => {
    void loadFiles().catch((err) => setError(toErrorMessage(err)))
  }, [loadFiles, setError])

  useEffect(() => {
    setSides(null)
    setResult('')
    setActiveRegionId(null)
    if (!activePath) return
    // Ignore responses for a file the user already navigated away from.
    let cancelled = false
    setSidesLoading(true)
    window.gitManager.merge
      .getSides(repoPath, activePath)
      .then((s) => {
        if (cancelled) return
        setSides(s)
        setResult(s.result)
      })
      .catch((err) => {
        if (!cancelled) setError(toErrorMessage(err))
      })
      .finally(() => {
        if (!cancelled) setSidesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [activePath, repoPath, reloadKey, setError])

  // Regions always come from the current text, so manual edits never leave stale line ranges.
  const regions = useMemo(() => parseConflictMarkers(result), [result])
  const activeRegion = regions.find((r) => r.id === activeRegionId) ?? regions[0] ?? null
  const activeFile = files.find((f) => f.path === activePath)
  const textEditable = Boolean(sides && !sides.binary && !sides.tooLarge)
  const oneSideDeleted = Boolean(activeFile && (!activeFile.hasOurs || !activeFile.hasTheirs))

  const acceptRegion = (choice: 'ours' | 'theirs' | 'both'): void => {
    if (!activeRegion) return
    setResult(applyRegionResolution(result, activeRegion, choice).text)
    setActiveRegionId(null)
  }

  const afterResolved = async (): Promise<void> => {
    const remaining = await loadFiles()
    await onResolved()
    // While rebasing, stay open so the user can continue the rebase from here.
    if (remaining.length === 0 && !rebaseInProgress) onClose()
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

  const takeSide = (side: ConflictSide): void => {
    if (!activePath) return
    const path = activePath
    const deletes = side === 'ours' ? !activeFile?.hasOurs : !activeFile?.hasTheirs
    if (deletes && !confirm(`Resolve the conflict by deleting ${path}?`)) return
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
    <div className="modal-backdrop">
      <div
        className="modal"
        style={{
          width: 'min(1100px, 96vw)',
          height: 'min(820px, 92vh)',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        <h3>
          {rebaseInProgress ? 'Rebase' : 'Merge'} editor — {activePath || 'no conflicts'}
        </h3>
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
            onContinue={
              onRebaseContinue
                ? () =>
                    run(async () => {
                      await onRebaseContinue()
                      await loadFiles()
                      await onResolved()
                    })
                : undefined
            }
            onSkip={
              onRebaseSkip
                ? () =>
                    run(async () => {
                      await onRebaseSkip()
                      await loadFiles()
                      await onResolved()
                    })
                : undefined
            }
            onAbort={
              onRebaseAbort
                ? () =>
                    run(async () => {
                      await onRebaseAbort()
                      await onResolved()
                      onClose()
                    })
                : undefined
            }
          />
        ) : mergeInProgress ? (
          <OperationBar
            kind="merge"
            busy={busy}
            onAbort={
              onMergeAbort
                ? () =>
                    run(async () => {
                      await onMergeAbort()
                      await onResolved()
                      onClose()
                    })
                : undefined
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
            </>
          )}
          <div className="spacer" />
          <Button disabled={busy || sidesLoading || !activePath} onClick={() => takeSide('ours')}>
            {takeSideLabel(activeFile, 'ours')}
          </Button>
          <Button disabled={busy || sidesLoading || !activePath} onClick={() => takeSide('theirs')}>
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
                  language="plaintext"
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
                  language="plaintext"
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
                  language="plaintext"
                  value={sides?.theirs || ''}
                  options={{ ...editorOpts, readOnly: true }}
                />
              </div>
            </>
          )}
        </div>
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
      </div>
    </div>
  )
}
