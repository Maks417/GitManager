import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import type React from 'react'
import Editor from '@monaco-editor/react'
import { Check, ChevronDown, ChevronUp, Columns3, FileDiff, Info, LayoutPanelTop, Link2, RotateCcw } from 'lucide-react'
import type { ConflictFile, ConflictSide, MergeSides } from '@shared/ipc'
import {
  applyRegionResolution,
  detectEol,
  hasUnresolvedMarkers,
  locateRegions,
  parseConflictMarkers,
  resolutionText,
  type ConflictRegion,
  type RegionChoice
} from '@merge-core/conflict'
import { OperationBar } from '../../components/OperationBar'
import { Banner, Button, IconButton, Modal, SegmentedControl } from '../../components/ui'
import {
  confirmLeaveMergeEdits,
  confirmResetMergeResult,
  confirmResolveByDeleting,
  MONACO_FONT_FAMILY
} from '../../lib/copy'
import { toErrorMessage } from '../../lib/errors'
import * as monaco from '../../lib/monaco-api'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { syntaxLanguageFor } from '../../lib/syntax'
import { monacoThemeFor, useResolvedTheme } from '../../lib/theme'
import { baseLinePairs, mapLine, sideLinePairs } from '../../logic/merge-scroll'
import { tooLargeToHighlight } from '../../logic/syntax-language'
import { useLayoutPrefsState } from '../../state/LayoutProvider'
import { useConfirm } from '../../state/ConfirmProvider'
import { useDialogActions } from '../../state/DialogsProvider'
import { useGitActions } from '../../state/GitActionsProvider'
import { useActiveRepo, useSession, useSessionActions } from '../../state/RepoSessionProvider'
import { SyntaxHighlightToggle } from '../diff/SyntaxHighlightToggle'
import { attachConflictActions } from './merge-conflict-actions'
import { baseDecorations, resultDecorations, sideDecorations } from './merge-decorations'

const dialogStyle: React.CSSProperties = {
  width: '98vw',
  height: '95vh',
  maxWidth: 'none',
  display: 'flex',
  flexDirection: 'column'
}

/** More conflicted files than this are listed in a column beside the editors instead of a row above them. */
const FILE_ROW_MAX = 4

type Pane = 'ours' | 'base' | 'result' | 'theirs'
type CodeEditor = monaco.editor.IStandaloneCodeEditor

function takeSideLabel(file: ConflictFile | undefined, side: ConflictSide): string {
  const present = side === 'ours' ? file?.hasOurs : file?.hasTheirs
  return present ? `Take ${side} (whole file)` : `Take ${side} (delete file)`
}

const countLines = (text: string): number => text.split(/\r\n|\r|\n/).length

/** An editor that is still shown: @monaco-editor/react disposes editors whose pane unmounts, which drops the model. */
function live(editor: CodeEditor | undefined): CodeEditor | null {
  return editor && editor.getModel() ? editor : null
}

/** The region that holds 0-based result `line`, or -1. */
function regionAt(regions: readonly ConflictRegion[], line: number): number {
  return regions.findIndex((r) => line >= r.startLine && line <= r.endLine)
}

/** The edit that puts `text` in place of a region's lines, markers included; an empty text removes the lines. */
function regionEdit(model: monaco.editor.ITextModel, region: ConflictRegion, text: string): monaco.editor.IIdentifiedSingleEditOperation {
  const first = region.startLine + 1
  const last = Math.min(region.endLine + 1, model.getLineCount())
  if (text) {
    return { range: { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: model.getLineMaxColumn(last) }, text }
  }
  // Remove the lines together with one line break.
  if (last < model.getLineCount()) {
    return { range: { startLineNumber: first, startColumn: 1, endLineNumber: last + 1, endColumn: 1 }, text: '' }
  }
  if (first > 1) {
    const prev = first - 1
    return {
      range: { startLineNumber: prev, startColumn: model.getLineMaxColumn(prev), endLineNumber: last, endColumn: model.getLineMaxColumn(last) },
      text: ''
    }
  }
  return { range: { startLineNumber: first, startColumn: 1, endLineNumber: last, endColumn: model.getLineMaxColumn(last) }, text: '' }
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
  const { syntaxHighlighting, mergeEditorLayout, setMergeEditorLayout } = useLayoutPrefsState()
  const [files, setFiles] = useState<ConflictFile[]>([])
  /** Files resolved while the editor is open; Git no longer lists them as conflicted. */
  const [doneFiles, setDoneFiles] = useState<string[]>([])
  /** Conflicts Git left in each file opened so far. */
  const [conflictCounts, setConflictCounts] = useState<Record<string, number>>({})
  const [activePath, setActivePath] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [syncScroll, setSyncScroll] = useState(true)
  const [showBase, setShowBase] = useState(false)
  const fileKey = activePath === null ? null : `${reloadKey}\0${activePath}`
  // Kept with the load they belong to, so a new file starts clean without resetting state in an effect.
  const [loaded, setLoaded] = useState<ForFile<MergeSides | null> | null>(null)
  const [edited, setEdited] = useState<ForFile<string> | null>(null)
  const [chosenRegion, setChosenRegion] = useState<ForFile<number> | null>(null)
  const { busy, error, setError, run } = useAsyncAction()

  const editors = useRef<Partial<Record<Pane, CodeEditor>>>({})
  /** Bumped whenever an editor mounts, so the effects that decorate and link editors run for the new one. */
  const [mounts, setMounts] = useState(0)
  const onEditorMount = (pane: Pane, editor: CodeEditor): void => {
    editors.current[pane] = editor
    // Monaco keeps one line ending per model and picks the platform's for text without any, which would turn the
    // whole result CRLF on Windows: keep the file's own.
    if (pane === 'result') {
      const crlf = detectEol(editor.getValue()) === '\r\n'
      editor.getModel()?.setEOL(crlf ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
    }
    setMounts((n) => n + 1)
  }

  const sides = loaded?.key === fileKey ? loaded.value : null
  const sidesLoading = fileKey !== null && loaded?.key !== fileKey
  const result = edited?.key === fileKey ? edited.value : (sides?.result ?? '')
  const dirty = Boolean(sides && edited?.key === fileKey && edited.value !== sides.result)
  const setResult = (text: string): void => {
    if (fileKey !== null) setEdited({ key: fileKey, value: text })
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
        if (cancelled) return
        setLoaded({ key: fileKey, value: s })
        setConflictCounts((counts) => ({ ...counts, [activePath]: parseConflictMarkers(s.result).length }))
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
  const anchors = useMemo(
    () => (sides ? locateRegions(result, regions, sides.ours, sides.theirs) : []),
    [result, regions, sides]
  )
  // Ids number the regions in order, so after a resolution the same index is the next conflict.
  const activeIndex = regions.length === 0 ? -1 : Math.min(chosenRegion?.key === fileKey ? chosenRegion.value : 0, regions.length - 1)
  const activeRegion = activeIndex >= 0 ? regions[activeIndex] : null
  const setActiveIndex = (index: number): void => {
    if (fileKey !== null) setChosenRegion({ key: fileKey, value: index })
  }
  // Labels as Git wrote them (`HEAD`, the merged branch); they stay after every conflict is resolved.
  const gitRegions = useMemo(() => parseConflictMarkers(sides?.result ?? ''), [sides])
  const oursLabel = gitRegions[0]?.oursLabel ?? ''
  const theirsLabel = gitRegions[0]?.theirsLabel ?? ''

  const activeFile = files.find((f) => f.path === activePath)
  const textEditable = Boolean(sides && !sides.binary && !sides.tooLarge)
  const oneSideDeleted = Boolean(activeFile && (!activeFile.hasOurs || !activeFile.hasTheirs))
  // Decided by the sides as loaded, not by the result being edited, so colors never switch off mid-edit.
  const longestSide = Math.max(sides?.ours.length ?? 0, sides?.theirs.length ?? 0, sides?.result.length ?? 0)
  const language = activePath ? syntaxLanguageFor(activePath, syntaxHighlighting, longestSide) : 'plaintext'

  // Lines that face each other across the panes, for scrolling them together.
  const resultLineCount = useMemo(() => countLines(result), [result])
  const sideLineCounts = useMemo(
    () => ({
      ours: countLines(sides?.ours ?? ''),
      theirs: countLines(sides?.theirs ?? ''),
      base: countLines(sides?.base ?? '')
    }),
    [sides]
  )
  const pairs = useMemo(
    () => ({
      ours: sideLinePairs(regions, anchors, 'ours', resultLineCount, sideLineCounts.ours),
      theirs: sideLinePairs(regions, anchors, 'theirs', resultLineCount, sideLineCounts.theirs),
      oursBase: baseLinePairs(sides?.oursChanges ?? [], sideLineCounts.ours, sideLineCounts.base)
    }),
    [regions, anchors, resultLineCount, sideLineCounts, sides]
  )

  /** The result line shown next to `line` of `pane`, and back. */
  const toResult = (pane: Pane, line: number): number => {
    if (pane === 'result') return line
    if (pane === 'base') return mapLine(pairs.ours, mapLine(pairs.oursBase, line, true), true)
    return mapLine(pane === 'ours' ? pairs.ours : pairs.theirs, line, true)
  }
  const fromResult = (pane: Pane, line: number): number => {
    if (pane === 'result') return line
    if (pane === 'base') return mapLine(pairs.oursBase, mapLine(pairs.ours, line))
    return mapLine(pane === 'ours' ? pairs.ours : pairs.theirs, line)
  }

  /** Scroll every pane to conflict `index` and put the cursor in it. */
  const revealConflict = (index: number): void => {
    const region = regions[index]
    const resultEditor = live(editors.current.result)
    if (!region || !resultEditor) return
    resultEditor.setPosition({ lineNumber: region.startLine + 1, column: 1 })
    resultEditor.revealLineInCenterIfOutsideViewport(region.startLine + 1)
    // With scrolling linked the sides follow the result; otherwise each shows its own block.
    if (syncScroll) return
    live(editors.current.ours)?.revealLineInCenterIfOutsideViewport(anchors[index]?.ours.start ?? 1)
    live(editors.current.theirs)?.revealLineInCenterIfOutsideViewport(anchors[index]?.theirs.start ?? 1)
  }

  const goToConflict = (index: number): void => {
    if (regions.length === 0) return
    const wrapped = (index + regions.length) % regions.length
    setActiveIndex(wrapped)
    revealConflict(wrapped)
    live(editors.current.result)?.focus()
  }

  /** Set by a resolution: once the text is parsed again, show the conflict that took its place. */
  const revealAfterEdit = useRef(false)

  const acceptRegion = (choice: RegionChoice, index = activeIndex): void => {
    const region = regions[index]
    if (!region) return
    const editor = live(editors.current.result)
    const model = editor?.getModel()
    if (!editor || !model) {
      setResult(applyRegionResolution(result, region, choice).text)
      return
    }
    const text = resolutionText(region, choice).split('\n').join(model.getEOL())
    // One undo step per resolution, which keeps the cursor and the scroll position.
    editor.pushUndoStop()
    editor.executeEdits('merge-editor', [regionEdit(model, region, text)])
    editor.pushUndoStop()
    setActiveIndex(index)
    revealAfterEdit.current = true
  }

  const revealActive = useEffectEvent(() => {
    if (activeIndex >= 0) revealConflict(activeIndex)
  })
  useEffect(() => {
    if (!revealAfterEdit.current) return
    revealAfterEdit.current = false
    revealActive()
  }, [regions])

  const resetResult = async (): Promise<void> => {
    if (!sides || !activePath) return
    if (!(await confirm(confirmResetMergeResult(activePath)))) return
    setResult(sides.result)
    setActiveIndex(0)
    revealAfterEdit.current = true
  }

  const openFile = async (path: string): Promise<void> => {
    if (path === activePath) return
    if (dirty && activePath && !(await confirm(confirmLeaveMergeEdits(activePath)))) return
    setActivePath(path)
  }

  const afterResolved = async (path: string): Promise<void> => {
    setDoneFiles((done) => (done.includes(path) ? done : [...done, path]))
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
      await afterResolved(path)
    })
  }

  const takeSide = async (side: ConflictSide): Promise<void> => {
    if (!activePath) return
    const path = activePath
    const deletes = side === 'ours' ? !activeFile?.hasOurs : !activeFile?.hasTheirs
    if (deletes && !(await confirm(confirmResolveByDeleting(path)))) return
    void run(async () => {
      await window.gitManager.merge.resolveSide(repoPath, path, side)
      await afterResolved(path)
    })
  }

  // Jump to the first conflict once a file is shown.
  const revealedFor = useRef<string | null>(null)
  useEffect(() => {
    const editor = live(editors.current.result)
    if (!sides || !fileKey || revealedFor.current === fileKey || !editor) return
    revealedFor.current = fileKey
    // A just-mounted editor may not have its height yet; every line would count as off screen and be scrolled to.
    if (editor.getLayoutInfo().height >= 3 * editor.getOption(monaco.editor.EditorOption.lineHeight)) {
      revealActive()
      return
    }
    let revealed = false
    const layout = editor.onDidLayoutChange(() => {
      layout.dispose()
      revealed = true
      revealActive()
    })
    return () => {
      layout.dispose()
      // Another editor mounted first: the next run waits for the layout again.
      if (!revealed && revealedFor.current === fileKey) revealedFor.current = null
    }
  }, [sides, fileKey, mounts])

  // Colors: conflicts in the result, each side's changes and conflicting blocks, and what the sides replaced in base.
  useEffect(() => {
    const editor = live(editors.current.result)
    if (!editor) return
    const collection = editor.createDecorationsCollection(resultDecorations(regions, activeRegion?.id ?? null))
    return () => collection.clear()
  }, [regions, activeRegion, mounts])

  useEffect(() => {
    if (!sides) return
    const collections = (['ours', 'theirs'] as const).flatMap((side) => {
      const editor = live(editors.current[side])
      if (!editor) return []
      const changes = side === 'ours' ? sides.oursChanges : sides.theirsChanges
      const lineCount = editor.getModel()?.getLineCount() ?? 0
      return [editor.createDecorationsCollection(sideDecorations(side, lineCount, changes, anchors, activeIndex))]
    })
    return () => collections.forEach((c) => c.clear())
  }, [sides, anchors, activeIndex, mounts])

  useEffect(() => {
    const editor = live(editors.current.base)
    if (!sides || !editor || !showBase) return
    const lineCount = editor.getModel()?.getLineCount() ?? 0
    const collection = editor.createDecorationsCollection(baseDecorations(lineCount, sides.oursChanges, sides.theirsChanges))
    return () => collection.clear()
  }, [sides, showBase, mounts])

  // The toolbar at the active conflict, and the conflict under the cursor or the pointer becoming the active one.
  const conflictActions = useRef<ReturnType<typeof attachConflictActions> | null>(null)
  const activeRegionNow = useEffectEvent(() => activeRegion)
  const acceptFromToolbar = useEffectEvent((choice: RegionChoice) => acceptRegion(choice))
  const activateLine = useEffectEvent((line: number) => {
    const index = regionAt(regions, line)
    if (index >= 0 && index !== activeIndex) setActiveIndex(index)
  })
  useEffect(() => {
    const editor = live(editors.current.result)
    if (!editor) return
    const actions = attachConflictActions(editor, {
      region: () => activeRegionNow(),
      accept: (choice) => acceptFromToolbar(choice),
      hover: (line) => activateLine(line)
    })
    conflictActions.current = actions
    const cursor = editor.onDidChangeCursorPosition((e) => activateLine(e.position.lineNumber - 1))
    return () => {
      cursor.dispose()
      actions.dispose()
      conflictActions.current = null
    }
  }, [mounts])
  useEffect(() => {
    conflictActions.current?.update()
  }, [activeRegion, mounts])

  // Scrolling one pane scrolls the others to the lines that face its top line. (Lining up the middle lines would
  // push a file shorter than its pane down.)
  const followScroll = useEffectEvent((source: Pane) => {
    const from = live(editors.current[source])
    if (!from) return
    const lineHeight = from.getOption(monaco.editor.EditorOption.lineHeight)
    const resultLine = toResult(source, from.getScrollTop() / lineHeight + 1)
    for (const pane of ['ours', 'base', 'result', 'theirs'] as const) {
      const to = pane === source ? null : live(editors.current[pane])
      if (to) to.setScrollTop(Math.max(0, (fromResult(pane, resultLine) - 1) * lineHeight))
    }
  })
  useEffect(() => {
    if (!syncScroll) return
    let following = false
    const subscriptions = (['ours', 'base', 'result', 'theirs'] as const).flatMap((pane) => {
      const editor = live(editors.current[pane])
      if (!editor) return []
      return [
        editor.onDidScrollChange((e) => {
          // The panes this scroll moves report scrolls of their own, synchronously; those must not lead.
          if (!e.scrollTopChanged || following) return
          following = true
          try {
            followScroll(pane)
          } finally {
            following = false
          }
        })
      ]
    })
    // A pane that just mounted, or scrolling that was just linked again, starts lined up with the result.
    following = true
    try {
      followScroll('result')
    } finally {
      following = false
    }
    return () => subscriptions.forEach((s) => s.dispose())
  }, [syncScroll, showBase, mounts])

  // F7 / Shift+F7: next / previous conflict, wherever the focus is in the dialog.
  const onNavigationKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== 'F7' || e.ctrlKey || e.altKey || e.metaKey) return
    e.preventDefault()
    goToConflict(activeIndex + (e.shiftKey ? -1 : 1))
  })
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => onNavigationKey(e)
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const editorOpts: monaco.editor.IStandaloneEditorConstructionOptions = {
    minimap: { enabled: false },
    fontSize: 12,
    fontFamily: MONACO_FONT_FAMILY,
    automaticLayout: true,
    // Decorations fill the narrow strip beside the line numbers.
    lineDecorationsWidth: 6,
    overviewRulerLanes: 3
  }
  const readOnlyOpts = { ...editorOpts, readOnly: true }

  const listFilesBeside = files.length + doneFiles.length > FILE_ROW_MAX
  const doneOnly = doneFiles.filter((path) => !files.some((f) => f.path === path))
  const fileButtons = (
    <>
      {files.map((f) => {
        const count = f.path === activePath && sides ? regions.length : conflictCounts[f.path]
        return (
          <button
            key={f.path}
            className={f.path === activePath ? 'primary' : ''}
            title={f.path}
            onClick={() => void openFile(f.path)}
          >
            <span className="cell-ellipsis">{f.path}</span>
            {count !== undefined && (
              <span className="merge-file-count" title={`${count} conflict${count === 1 ? '' : 's'} left`}>
                {count}
              </span>
            )}
          </button>
        )
      })}
      {doneOnly.map((path) => (
        <button key={path} className="merge-file-done" disabled title={`${path} — resolved and staged`}>
          <Check size={12} strokeWidth={2} aria-hidden />
          <span className="cell-ellipsis">{path}</span>
        </button>
      ))}
      {files.length === 0 && <span className="muted">No unmerged paths</span>}
    </>
  )

  const rebaseHint = rebaseInProgress
    ? 'During a rebase, ours is the branch being rebased onto and theirs is your commit being replayed.'
    : undefined
  const paneHead = (pane: Pane, title: string, label: string, extra?: React.ReactNode): React.JSX.Element => (
    <div className="merge-pane-head" title={pane === 'ours' || pane === 'theirs' ? rebaseHint : undefined}>
      <span className={`merge-swatch merge-swatch-${pane}`} aria-hidden />
      <strong>{title}</strong>
      {label && <span className="muted cell-ellipsis">{label}</span>}
      {extra}
    </div>
  )

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
          <Button disabled={busy || sidesLoading || !activePath} onClick={() => void takeSide('ours')}>
            {takeSideLabel(activeFile, 'ours')}
          </Button>
          <Button disabled={busy || sidesLoading || !activePath} onClick={() => void takeSide('theirs')}>
            {takeSideLabel(activeFile, 'theirs')}
          </Button>
          <div className="spacer" />
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
      {!listFilesBeside && <div className="conflict-list">{fileButtons}</div>}
      <div className="merge-toolbar">
        {textEditable && (
          <>
            <div className="merge-nav" role="group" aria-label="Conflicts">
              <IconButton
                label="Previous conflict"
                hint="Previous conflict (Shift+F7)"
                disabled={regions.length === 0}
                onClick={() => goToConflict(activeIndex - 1)}
              >
                <ChevronUp size={14} strokeWidth={1.75} />
              </IconButton>
              <span className="merge-nav-status" aria-live="polite">
                {regions.length > 0 ? `Conflict ${activeIndex + 1} of ${regions.length}` : 'No conflicts left'}
              </span>
              <IconButton
                label="Next conflict"
                hint="Next conflict (F7)"
                disabled={regions.length === 0}
                onClick={() => goToConflict(activeIndex + 1)}
              >
                <ChevronDown size={14} strokeWidth={1.75} />
              </IconButton>
            </div>
            <button disabled={!activeRegion} onClick={() => acceptRegion('ours')}>
              Accept ours
            </button>
            <button disabled={!activeRegion} onClick={() => acceptRegion('theirs')}>
              Accept theirs
            </button>
            <button disabled={!activeRegion} onClick={() => acceptRegion('both')}>
              Accept both
            </button>
            <IconButton
              label="Start over"
              hint="Start over from Git's merge"
              disabled={!dirty}
              onClick={() => void resetResult()}
            >
              <RotateCcw size={14} strokeWidth={1.75} />
            </IconButton>
          </>
        )}
        <div className="spacer" />
        {textEditable && (
          <>
            {syntaxHighlighting && tooLargeToHighlight(longestSide) && (
              <span className="muted">Too large for syntax colors</span>
            )}
            <SegmentedControl
              ariaLabel="Pane layout"
              value={mergeEditorLayout}
              onChange={setMergeEditorLayout}
              options={[
                {
                  value: 'columns',
                  label: 'Columns',
                  hint: 'Ours, result and theirs side by side',
                  icon: <Columns3 size={14} strokeWidth={1.75} />
                },
                {
                  value: 'stacked',
                  label: 'Stacked',
                  hint: 'Ours and theirs above the result',
                  icon: <LayoutPanelTop size={14} strokeWidth={1.75} />
                }
              ]}
            />
            <IconButton
              label="Base"
              hint={showBase ? 'Hide the common ancestor' : 'Show the common ancestor (base)'}
              className="toggle-btn"
              aria-pressed={showBase}
              disabled={!activeFile?.hasBase}
              onClick={() => setShowBase(!showBase)}
            >
              <FileDiff size={14} strokeWidth={1.75} />
            </IconButton>
            <IconButton
              label="Scroll together"
              hint={syncScroll ? 'Panes scroll together' : 'Panes scroll on their own'}
              className="toggle-btn"
              aria-pressed={syncScroll}
              onClick={() => setSyncScroll(!syncScroll)}
            >
              <Link2 size={14} strokeWidth={1.75} />
            </IconButton>
            <SyntaxHighlightToggle />
          </>
        )}
        <IconButton
          label="How this works"
          hint="The result starts from Git's merge: changes that don't overlap are already combined, and markers remain only where both sides changed the same lines. Colored lines in ours and theirs are what each side changed."
        >
          <Info size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
      <div className={`merge-main${listFilesBeside ? ' with-files' : ''}`}>
        {listFilesBeside && <nav className="merge-file-list" aria-label="Conflicted files">{fileButtons}</nav>}
        <div className={`merge-editors ${mergeEditorLayout}${showBase && activeFile?.hasBase ? ' with-base' : ''}`}>
          {/* Editors mount with the file's text, never empty: Monaco takes a model's line ending from its first text. */}
          {!sides ? (
            <div className="empty-state" style={{ gridColumn: '1 / -1', gridRow: '1 / -1' }}>
              {activePath ? 'Loading…' : ''}
            </div>
          ) : !textEditable ? (
            <div className="empty-state" style={{ gridColumn: '1 / -1', gridRow: '1 / -1' }}>
              {sides.binary
                ? 'Binary file — it can’t be edited here. Take ours or theirs.'
                : 'This file is too large to edit here. Take ours or theirs.'}
            </div>
          ) : (
            <>
              <div className="merge-pane" style={{ gridArea: 'ours' }}>
                {paneHead('ours', 'Ours', oursLabel, <ChangeCount count={sides?.oursChanges.length} />)}
                <Editor
                  key={`ours:${activePath}`}
                  height="100%"
                  theme={monacoTheme}
                  language={language}
                  value={sides?.ours || ''}
                  onMount={(editor) => onEditorMount('ours', editor)}
                  options={readOnlyOpts}
                />
              </div>
              {showBase && activeFile?.hasBase && (
                <div className="merge-pane" style={{ gridArea: 'base' }}>
                  {paneHead('base', 'Base', 'common ancestor')}
                  <Editor
                    key={`base:${activePath}`}
                    height="100%"
                    theme={monacoTheme}
                    language={language}
                    value={sides?.base || ''}
                    onMount={(editor) => onEditorMount('base', editor)}
                    options={readOnlyOpts}
                  />
                </div>
              )}
              <div className="merge-pane" style={{ gridArea: 'result' }}>
                {paneHead(
                  'result',
                  'Result',
                  '',
                  <>
                    {sides && (
                      <span className={regions.length > 0 ? 'merge-pane-state unresolved' : 'merge-pane-state'}>
                        {regions.length > 0
                          ? `${regions.length} conflict${regions.length === 1 ? '' : 's'} left`
                          : 'All conflicts resolved'}
                      </span>
                    )}
                    {dirty && <span className="muted">· edited</span>}
                  </>
                )}
                <Editor
                  key={`result:${activePath}`}
                  height="100%"
                  theme={monacoTheme}
                  language={language}
                  value={result}
                  onChange={(v) => setResult(v ?? '')}
                  onMount={(editor) => onEditorMount('result', editor)}
                  options={editorOpts}
                />
              </div>
              <div className="merge-pane" style={{ gridArea: 'theirs' }}>
                {paneHead('theirs', 'Theirs', theirsLabel, <ChangeCount count={sides?.theirsChanges.length} />)}
                <Editor
                  key={`theirs:${activePath}`}
                  height="100%"
                  theme={monacoTheme}
                  language={language}
                  value={sides?.theirs || ''}
                  onMount={(editor) => onEditorMount('theirs', editor)}
                  options={readOnlyOpts}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ChangeCount({ count }: { count: number | undefined }): React.JSX.Element | null {
  if (!count) return null
  return (
    <span className="muted merge-pane-changes">
      {count} change{count === 1 ? '' : 's'} from base
    </span>
  )
}

