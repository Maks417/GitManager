import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import type { DiffHunk, DiffResult } from '@shared/ipc'
import { SegmentedControl } from '../../components/ui'
import { MONACO_FONT_FAMILY } from '../../lib/copy'
import * as monaco from '../../lib/monaco-api'
import { syntaxLanguageFor } from '../../lib/syntax'
import { monacoThemeFor, useResolvedTheme } from '../../lib/theme'
import { useLatestRef } from '../../hooks/useLatestRef'
import { disposeWhenDiffSettled, nextContentVersion } from '../../logic/monaco-lifecycle'
import { attachHunkActions, type HunkActionsOptions } from './hunk-actions'
import { ImageDiffView } from './ImageDiffView'

interface Props {
  diff: DiffResult
  editorKey?: string
  /** Old and new text in two panes instead of one inline diff. */
  sideBySide: boolean
  /** Syntax colors for the file's language (plain text when off or the file is too large). */
  syntaxHighlighting: boolean
  /** Work-tree diffs: stage, unstage or discard single hunks and lines, when the diff has hunks. */
  hunkActions?: HunkActionsOptions
}

const DIFF_OPTIONS: monaco.editor.IStandaloneDiffEditorConstructionOptions = {
  readOnly: true,
  // Side by side is the user's choice (inline is the default), so a narrow editor keeps both panes instead of
  // Monaco switching to inline below its 900px breakpoint.
  useInlineViewWhenSpaceIsLimited: false,
  // Revert / stage hunk actions cannot apply to a read-only diff. The gutter menu also re-reads its
  // context keys on a debounced change event that outlives the editor, throwing after disposal.
  renderGutterMenu: false,
  renderMarginRevertIcon: false,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 12,
  fontFamily: MONACO_FONT_FAMILY,
  wordWrap: 'off',
  automaticLayout: true,
  renderValidationDecorations: 'off',
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  folding: false,
  links: false
}

/** Shared Monaco diff viewer — uses locally bundled Monaco (see setupMonaco). */
export function FileDiffViewer({
  diff,
  editorKey,
  sideBySide,
  syntaxHighlighting,
  hunkActions
}: Props): React.JSX.Element {
  // New text mounts a new editor instead of editing its models: each editor then computes exactly one
  // diff, which is what lets teardown wait for it (see disposeWhenDiffSettled).
  const [shown, setShown] = useState(() => nextContentVersion(null, diff.oldText, diff.newText))
  const content = nextContentVersion(shown, diff.oldText, diff.newText)
  // Numbers the next text; React re-renders with it before anything is painted.
  if (content !== shown) setShown(content)
  // Text images (SVG) open as code; the choice stays while moving between files.
  const [textImageMode, setTextImageMode] = useState<'code' | 'preview'>('code')

  if (diff.binary) {
    if (diff.image) return <ImageDiffView image={diff.image} sideBySide={sideBySide} />
    return <div className="empty-state">Binary file — cannot display diff</div>
  }

  const editor = (
    <DiffEditorHost
      key={`${editorKey ?? diff.path}:${content.version}`}
      original={diff.oldText}
      modified={diff.newText}
      language={syntaxLanguageFor(
        diff.path,
        syntaxHighlighting,
        Math.max(diff.oldText.length, diff.newText.length)
      )}
      sideBySide={sideBySide}
      hunks={hunkActions ? diff.hunks?.hunks : undefined}
      hunkActions={hunkActions}
    />
  )
  if (!diff.image) return editor

  return (
    <div className="diff-with-preview">
      <div className="diff-preview-bar">
        <SegmentedControl
          ariaLabel="Show image as"
          value={textImageMode}
          onChange={setTextImageMode}
          options={[
            { value: 'code', label: 'Code', hint: 'Show the changes to the file’s text' },
            { value: 'preview', label: 'Preview', hint: 'Show the image before and after' }
          ]}
        />
      </div>
      <div className="diff-editor-slot">
        {textImageMode === 'preview' ? <ImageDiffView image={diff.image} sideBySide={sideBySide} /> : editor}
      </div>
    </div>
  )
}

function DiffEditorHost({
  original,
  modified,
  language,
  sideBySide,
  hunks,
  hunkActions
}: {
  original: string
  modified: string
  language: string
  sideBySide: boolean
  hunks?: DiffHunk[]
  hunkActions?: HunkActionsOptions
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<monaco.editor.ITextModel[]>([])
  const theme = monacoThemeFor(useResolvedTheme())
  // Text is fixed for a mounted host (the parent re-keys it); language, layout and theme are applied to
  // the live editor by the effects below, so switching syntax colors keeps the diff and its scroll position.
  const [initial] = useState(() => ({ original, modified, language, sideBySide, theme }))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    // Monaco renders into an element of its own, so the page can drop a torn-down editor at once while
    // it waits for its diff to arrive.
    const host = document.createElement('div')
    host.className = 'monaco-fill'
    container.appendChild(host)

    const originalModel = monaco.editor.createModel(initial.original, initial.language)
    const modifiedModel = monaco.editor.createModel(initial.modified, initial.language)
    const editor = monaco.editor.createDiffEditor(host, {
      ...DIFF_OPTIONS,
      renderSideBySide: initial.sideBySide,
      theme: initial.theme
    })
    editor.setModel({ original: originalModel, modified: modifiedModel })
    editorRef.current = editor
    modelsRef.current = [originalModel, modifiedModel]

    return () => {
      editorRef.current = null
      modelsRef.current = []
      host.remove()
      disposeWhenDiffSettled(editor, [originalModel, modifiedModel])
    }
  }, [initial])

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  // The latest side and callback, without re-creating the toolbar when only they change.
  const hunkActionsRef = useLatestRef(hunkActions)
  const hasHunkActions = Boolean(hunkActions)
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !hunks || hunks.length === 0 || !hasHunkActions) return
    return attachHunkActions(editor, hunks, () => hunkActionsRef.current as HunkActionsOptions)
  }, [hunks, hasHunkActions, hunkActionsRef])

  useEffect(() => {
    for (const model of modelsRef.current) monaco.editor.setModelLanguage(model, language)
  }, [language])

  useEffect(() => {
    monaco.editor.setTheme(theme)
  }, [theme])

  return <div ref={containerRef} className="monaco-fill" />
}
