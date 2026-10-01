import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import Editor from '@monaco-editor/react'
import type { BlameCommit, BlameResult } from '@shared/ipc'
import { Banner, Button, Modal } from '../../components/ui'
import { MONACO_FONT_FAMILY } from '../../lib/copy'
import { toErrorMessage } from '../../lib/errors'
import { formatRelativeDate } from '../../lib/format'
import type * as monaco from '../../lib/monaco-api'
import { syntaxLanguageFor } from '../../lib/syntax'
import { monacoThemeFor, useResolvedTheme } from '../../lib/theme'
import { useLayout } from '../../state/LayoutProvider'

interface Props {
  repoPath: string
  path: string
  /** Blame at this commit; the work tree when null. */
  rev: string | null
  onClose: () => void
  onShowInHistory: (sha: string) => void
  onFileHistory: (path: string) => void
}

interface BlameTarget {
  path: string
  rev: string | null
}

const dialogStyle: React.CSSProperties = {
  width: 'min(1200px, 96vw)',
  height: 'min(860px, 92vh)',
  display: 'flex',
  flexDirection: 'column'
}

/** Width of the commit column in the gutter, in characters. */
const LABEL_CHARS = 30

function pad(text: string, width: number): string {
  return text.length > width ? `${text.slice(0, width - 1)}…` : text.padEnd(width)
}

/** `a1b2c3d Author name   3d ago`, or the work-tree label. */
function commitLabel(commit: BlameCommit): string {
  if (commit.uncommitted) return pad('Not committed yet', LABEL_CHARS - 1)
  const date = formatRelativeDate(commit.authoredAt)
  return `${commit.shortSha} ${pad(commit.author, LABEL_CHARS - 10 - date.length)} ${date}`
}

/**
 * The file with, in the gutter, the commit that last changed each block of lines. The line under the cursor
 * names its commit in the bar above; from there: show it in History, or blame the file as it was before it.
 */
export function BlameModal({ repoPath, path, rev, onClose, onShowInHistory, onFileHistory }: Props): React.JSX.Element {
  const { syntaxHighlighting } = useLayout()
  const theme = monacoThemeFor(useResolvedTheme())
  // Earlier targets, for Back after "Blame before this change".
  const [trail, setTrail] = useState<BlameTarget[]>([])
  const [target, setTarget] = useState<BlameTarget>({ path, rev })
  const [loaded, setLoaded] = useState<BlameResult | null>(null)
  // Only the blame of the target shown: after Back or "Blame before", the previous one is stale until it loads.
  const blame = loaded && loaded.path === target.path && loaded.rev === target.rev ? loaded : null
  const [error, setError] = useState<string | null>(null)
  const [line, setLine] = useState(1)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  // Counts editor mounts, so the bands are drawn on each new editor.
  const [mounts, setMounts] = useState(0)

  useEffect(() => {
    let cancelled = false
    window.gitManager.history.blame(repoPath, target.path, target.rev ?? undefined).then(
      (result) => {
        if (cancelled) return
        setLoaded(result)
        setError(null)
        setLine(1)
      },
      (err) => {
        if (!cancelled) setError(toErrorMessage(err))
      }
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, target])

  /** Per line: its commit, and whether the line starts a block (the label shows there only). */
  const lineInfo = useMemo(() => {
    const info: { sha: string; first: boolean; band: boolean }[] = []
    blame?.groups.forEach((g, index) => {
      for (let i = 0; i < g.lineCount; i++) info[g.startLine + i] = { sha: g.sha, first: i === 0, band: index % 2 === 1 }
    })
    return info
  }, [blame])

  const lineNumbers = useMemo(() => {
    const width = String(lineInfo.length).length
    return (n: number): string => {
      const info = lineInfo[n]
      const commit = info && blame?.commits[info.sha]
      const label = commit && info.first ? commitLabel(commit) : ''.padEnd(LABEL_CHARS - 1)
      return `${label} ${String(n).padStart(width)}`
    }
  }, [lineInfo, blame])

  // Alternate background bands, so neighbouring blocks from different commits stay apart.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !blame) return
    const collection = editor.createDecorationsCollection(
      blame.groups
        .filter((_, index) => index % 2 === 1)
        .map((g) => ({
          range: { startLineNumber: g.startLine, startColumn: 1, endLineNumber: g.startLine + g.lineCount - 1, endColumn: 1 },
          options: { isWholeLine: true, className: 'blame-band', marginClassName: 'blame-band' }
        }))
    )
    return () => collection.clear()
  }, [blame, mounts])

  const current = blame?.commits[lineInfo[line]?.sha ?? '']
  const back = trail[trail.length - 1]

  return (
    <Modal
      title={`Blame — ${target.path}${target.rev ? ` at ${target.rev.slice(0, 7)}` : ''}`}
      onClose={onClose}
      className="blame-modal"
      bodyClassName="blame-body"
      style={dialogStyle}
      footer={
        <div className="modal-actions">
          <Button onClick={() => onFileHistory(target.path)}>File history</Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {error && <Banner>{error}</Banner>}
      <div className="blame-bar">
        {back && (
          <Button
            variant="ghost"
            onClick={() => {
              setTrail((t) => t.slice(0, -1))
              setTarget(back)
            }}
          >
            ← Back
          </Button>
        )}
        <span className="cell-ellipsis blame-bar-commit">
          {current ? (
            current.uncommitted ? (
              'Line ' + line + ': changed in the work tree, not committed yet'
            ) : (
              <>
                Line {line}: <span className="sha">{current.shortSha}</span> {current.author} ·{' '}
                {formatRelativeDate(current.authoredAt)} — {current.summary}
              </>
            )
          ) : (
            <span className="muted">{blame ? 'Pick a line to see its commit.' : 'Loading…'}</span>
          )}
        </span>
        <Button
          disabled={!current || current.uncommitted}
          onClick={() => current && onShowInHistory(current.sha)}
        >
          Show in History
        </Button>
        <Button
          disabled={!current?.previousSha || !current.previousPath}
          title="Blame the file as it was just before this commit"
          onClick={() => {
            if (!current?.previousSha || !current.previousPath) return
            setTrail((t) => [...t, target])
            setTarget({ path: current.previousPath, rev: current.previousSha })
          }}
        >
          Blame before this change
        </Button>
      </div>
      <div className="blame-editor">
        {blame && (
          <Editor
            key={`${blame.path}@${blame.rev ?? 'worktree'}`}
            height="100%"
            theme={theme}
            language={syntaxLanguageFor(blame.path, syntaxHighlighting, blame.text.length)}
            value={blame.text}
            onMount={(editor) => {
              editorRef.current = editor
              editor.onDidChangeCursorPosition((e) => setLine(e.position.lineNumber))
              setMounts((n) => n + 1)
            }}
            options={{
              readOnly: true,
              domReadOnly: true,
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: MONACO_FONT_FAMILY,
              lineNumbers,
              lineNumbersMinChars: LABEL_CHARS + String(lineInfo.length).length + 1,
              folding: false,
              glyphMargin: false,
              renderLineHighlight: 'all',
              scrollBeyondLastLine: false,
              wordWrap: 'off'
            }}
          />
        )}
      </div>
    </Modal>
  )
}
