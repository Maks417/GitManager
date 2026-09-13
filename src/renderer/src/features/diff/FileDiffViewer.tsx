import type React from 'react'
import { DiffEditor } from '@monaco-editor/react'
import type { DiffResult } from '@shared/ipc'
import { monacoThemeFor, useResolvedTheme } from '../../lib/theme'
import { MONACO_FONT_FAMILY } from '../../lib/copy'

interface Props {
  diff: DiffResult
  editorKey?: string
  /** When false, show unified inline diff (better for narrow/bottom inspectors). */
  sideBySide?: boolean
}

/** Shared Monaco diff host — uses locally bundled Monaco (see setupMonaco). */
export function FileDiffViewer({ diff, editorKey, sideBySide = true }: Props): React.JSX.Element {
  const theme = useResolvedTheme()

  if (diff.binary) {
    return <div className="empty-state">Binary file — cannot display diff</div>
  }

  return (
    <div className="monaco-fill">
      <DiffEditor
        key={`${editorKey ?? diff.path}:${sideBySide ? 'sbs' : 'inline'}:${theme}`}
        height="100%"
        language={diff.language || 'plaintext'}
        theme={monacoThemeFor(theme)}
        original={diff.oldText}
        modified={diff.newText}
        loading={<div className="empty-state muted">Preparing editor…</div>}
        options={{
          readOnly: true,
          renderSideBySide: sideBySide,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 12,
          fontFamily: MONACO_FONT_FAMILY,
          wordWrap: 'off' as const,
          automaticLayout: true,
          renderValidationDecorations: 'off' as const,
          quickSuggestions: false,
          suggestOnTriggerCharacters: false,
          folding: false,
          links: false
        }}
      />
    </div>
  )
}
