import { useEffect, useMemo, useState } from 'react'
import type React from 'react'
import Editor from '@monaco-editor/react'
import type { ConflictFile, MergeSides } from '@shared/ipc'
import {
  applyRegionResolution,
  hasUnresolvedMarkers,
  parseConflictMarkers,
  type ConflictRegion
} from '@merge-core/conflict'
import { Banner, Button } from '../../components/ui'
import { monacoThemeFor, useResolvedTheme } from '../../lib/theme'

interface Props {
  repoPath: string
  onClose: () => void
  onResolved: () => Promise<void>
  rebaseInProgress?: boolean
  onRebaseContinue?: () => Promise<void>
  onRebaseAbort?: () => Promise<void>
}

export function MergeEditorModal({
  repoPath,
  onClose,
  onResolved,
  rebaseInProgress = false,
  onRebaseContinue,
  onRebaseAbort
}: Props): React.JSX.Element {
  const theme = useResolvedTheme()
  const monacoTheme = monacoThemeFor(theme)
  const [files, setFiles] = useState<ConflictFile[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  const [sides, setSides] = useState<MergeSides | null>(null)
  const [result, setResult] = useState('')
  const [regions, setRegions] = useState<ConflictRegion[]>([])
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const loadFiles = async (): Promise<void> => {
    const list = await window.gitManager.merge.listConflicts(repoPath)
    setFiles(list)
    setActivePath(list[0]?.path ?? null)
  }

  useEffect(() => {
    void loadFiles().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [repoPath])

  useEffect(() => {
    if (!activePath) {
      setSides(null)
      setResult('')
      setRegions([])
      return
    }
    void (async () => {
      const s = await window.gitManager.merge.getSides(repoPath, activePath)
      setSides(s)
      setResult(s.result)
      const parsed = parseConflictMarkers(s.result)
      setRegions(parsed)
      setActiveRegionId(parsed[0]?.id ?? null)
    })().catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [activePath, repoPath])

  const activeRegion = useMemo(
    () => regions.find((r) => r.id === activeRegionId) || regions[0] || null,
    [regions, activeRegionId]
  )

  const resolve = (choice: 'ours' | 'theirs' | 'both'): void => {
    if (!activeRegion) return
    const { text, region } = applyRegionResolution(result, activeRegion, choice)
    setResult(text)
    const nextRegions = parseConflictMarkers(text)
    setRegions(nextRegions.length ? nextRegions : [{ ...region, resolved: true }])
    setActiveRegionId(nextRegions[0]?.id ?? region.id)
  }

  const save = async (): Promise<void> => {
    if (!activePath) return
    if (hasUnresolvedMarkers(result)) {
      setError('Resolve all conflict markers before saving.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.gitManager.merge.saveResult(repoPath, activePath, result)
      await loadFiles()
      await onResolved()
      if (files.length <= 1) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const editorOpts = {
    minimap: { enabled: false },
    fontSize: 12,
    fontFamily: 'IBM Plex Mono, Cascadia Code, Consolas, monospace'
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        style={{
          width: 'min(1100px, 96vw)',
          height: 'min(820px, 92vh)',
          display: 'grid',
          gridTemplateRows: 'auto auto auto 1fr auto'
        }}
      >
        <h3>
          {rebaseInProgress ? 'Rebase' : 'Merge'} editor — {activePath || 'no conflicts'}
        </h3>
        <p className="muted" style={{ margin: 0 }}>
          Full-file conflict view. Accept Ours / Theirs / Both, or edit the result manually like VS Code.
        </p>
        {error && <Banner>{error}</Banner>}
        {rebaseInProgress && (
          <div className="merge-toolbar">
            <span className="muted">Rebase in progress</span>
            {onRebaseContinue && (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void (async () => {
                    setBusy(true)
                    setError(null)
                    try {
                      await onRebaseContinue()
                      await loadFiles()
                      await onResolved()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setBusy(false)
                    }
                  })()
                }
              >
                Continue rebase
              </Button>
            )}
            {onRebaseAbort && (
              <Button
                disabled={busy}
                onClick={() => {
                  if (!confirm('Abort the in-progress rebase?')) return
                  void (async () => {
                    setBusy(true)
                    setError(null)
                    try {
                      await onRebaseAbort()
                      await onResolved()
                      onClose()
                    } catch (err) {
                      setError(err instanceof Error ? err.message : String(err))
                    } finally {
                      setBusy(false)
                    }
                  })()
                }}
              >
                Abort rebase
              </Button>
            )}
          </div>
        )}
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
          <button disabled={!activeRegion} onClick={() => resolve('ours')}>
            Accept Ours
          </button>
          <button disabled={!activeRegion} onClick={() => resolve('theirs')}>
            Accept Theirs
          </button>
          <button disabled={!activeRegion} onClick={() => resolve('both')}>
            Accept Both
          </button>
          <select
            value={activeRegionId || ''}
            onChange={(e) => setActiveRegionId(e.target.value)}
            disabled={!regions.length}
          >
            {regions.map((r, i) => (
              <option key={r.id} value={r.id}>
                Conflict {i + 1}
                {r.resolved ? ' (resolved)' : ''}
              </option>
            ))}
          </select>
          <div className="spacer" />
          {sides && (
            <span className="muted">
              Base {sides.base.length} chars · Ours {sides.ours.length} · Theirs {sides.theirs.length}
            </span>
          )}
        </div>
        <div className="merge-editors">
          <Editor
            height="100%"
            theme={monacoTheme}
            language="plaintext"
            value={sides?.ours || ''}
            options={{ ...editorOpts, readOnly: true }}
          />
          <Editor
            height="100%"
            theme={monacoTheme}
            language="plaintext"
            value={result}
            onChange={(v) => setResult(v || '')}
            options={editorOpts}
          />
          <Editor
            height="100%"
            theme={monacoTheme}
            language="plaintext"
            value={sides?.theirs || ''}
            options={{ ...editorOpts, readOnly: true }}
          />
        </div>
        <div className="modal-actions">
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={busy || !activePath} onClick={() => void save()}>
            Save & stage
          </Button>
        </div>
      </div>
    </div>
  )
}
