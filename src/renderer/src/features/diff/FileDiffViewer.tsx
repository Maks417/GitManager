import { useEffect, useRef } from 'react'
import type React from 'react'
import * as monaco from 'monaco-editor'
import type { DiffResult } from '@shared/ipc'
import { MONACO_FONT_FAMILY } from '../../lib/copy'
import { monacoThemeFor, useResolvedTheme } from '../../lib/theme'
import {
  disposeWhenDiffSettled,
  nextContentVersion,
  type ContentVersion
} from '../../logic/monaco-lifecycle'

interface Props {
  diff: DiffResult
  editorKey?: string
  /** When false, show unified inline diff (better for narrow/bottom inspectors). */
  sideBySide?: boolean
}

const DIFF_OPTIONS: monaco.editor.IStandaloneDiffEditorConstructionOptions = {
  readOnly: true,
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
export function FileDiffViewer({ diff, editorKey, sideBySide = true }: Props): React.JSX.Element {
  // New text mounts a new editor instead of editing its models: each editor then computes exactly one
  // diff, which is what lets teardown wait for it (see disposeWhenDiffSettled).
  const versionRef = useRef<ContentVersion | null>(null)
  versionRef.current = nextContentVersion(versionRef.current, diff.oldText, diff.newText)

  if (diff.binary) {
    return <div className="empty-state">Binary file — cannot display diff</div>
  }

  return (
    <DiffEditorHost
      key={`${editorKey ?? diff.path}:${versionRef.current.version}`}
      original={diff.oldText}
      modified={diff.newText}
      language={diff.language || 'plaintext'}
      sideBySide={sideBySide}
    />
  )
}

function DiffEditorHost({
  original,
  modified,
  language,
  sideBySide
}: {
  original: string
  modified: string
  language: string
  sideBySide: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const theme = monacoThemeFor(useResolvedTheme())
  // Text and language are fixed for a mounted host (the parent re-keys it); layout and theme are
  // applied to the live editor by the effects below.
  const initialRef = useRef({ original, modified, language, sideBySide, theme })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const initial = initialRef.current
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

    return () => {
      editorRef.current = null
      host.remove()
      disposeWhenDiffSettled(editor, [originalModel, modifiedModel])
    }
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
  }, [sideBySide])

  useEffect(() => {
    monaco.editor.setTheme(theme)
  }, [theme])

  return <div ref={containerRef} className="monaco-fill" />
}
