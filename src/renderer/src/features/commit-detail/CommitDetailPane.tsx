import type React from 'react'
import { Copy, GitBranch, GitMerge } from 'lucide-react'
import { DiffViewSwitch } from '../diff/DiffViewSwitch'
import { FileDiffViewer } from '../diff/FileDiffViewer'
import { Splitter } from '../../components/Splitter'
import { Button, FileStatusDot } from '../../components/ui'
import { confirmMerge, confirmRebase } from '../../lib/copy'
import { formatRelativeDate } from '../../lib/format'
import { nextListIndex } from '../../logic/list-nav'
import { useAppStatus } from '../../state/AppStatusProvider'
import { useConfirm } from '../../state/ConfirmProvider'
import { useGitActions } from '../../state/GitActionsProvider'
import { useLayout } from '../../state/LayoutProvider'
import { useSelection, useSelectionActions } from '../../state/SelectionProvider'

const fileOptionId = (index: number): string => `inspector-file-${index}`

export function CommitDetailPane(): React.JSX.Element {
  const { busy } = useAppStatus()
  const { detail, selectedFile, diff, diffLoading } = useSelection()
  const { setSelectedFile } = useSelectionActions()
  const { diffView, inspectorFilesWidth: filesWidth, setInspectorFilesWidth, persistLayout } = useLayout()
  const { runMergeOrRebase } = useGitActions()
  const confirm = useConfirm()

  if (!detail) {
    return (
      <div className="empty-state">
        <div>
          <h3>Commit details</h3>
          <p className="muted">Select a commit in the graph to inspect its changes.</p>
        </div>
      </div>
    )
  }

  const { commit, files } = detail
  const selectedIndex = files.findIndex((f) => f.path === selectedFile?.path)

  const onFilesKeyDown = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    if (e.key === 'Escape') {
      // Back to the commit list this file list was entered from.
      const commits = document.querySelector<HTMLElement>('.history-table')
      if (!commits) return
      e.preventDefault()
      commits.focus()
      return
    }
    const next = nextListIndex(e.key, selectedIndex, files.length)
    if (next === null) return
    e.preventDefault()
    setSelectedFile(files[next])
    document.getElementById(fileOptionId(next))?.scrollIntoView({ block: 'nearest' })
  }

  return (
    <div className="detail-fill inspector-fill">
      <div className="commit-meta commit-meta-compact">
        <div className="commit-meta-line">
          <span className="commit-meta-subject cell-ellipsis" title={commit.subject}>
            {commit.subject}
          </span>
          <span className="muted commit-meta-bits">
            <span className="sha" title={commit.sha}>
              {commit.shortSha}
            </span>
            {' · '}
            <span title={`${commit.authorName} <${commit.authorEmail}>`}>{commit.authorName}</span>
            {' · '}
            <span title={commit.authoredAt}>{formatRelativeDate(commit.authoredAt)}</span>
          </span>
          <div className="commit-meta-actions">
            <Button
              variant="ghost"
              icon={<Copy size={14} strokeWidth={1.75} />}
              hint="Copy full SHA"
              title="Copy full SHA"
              onClick={() => void navigator.clipboard.writeText(commit.sha)}
            >
              Copy SHA
            </Button>
            <Button
              variant="ghost"
              icon={<GitMerge size={14} strokeWidth={1.75} />}
              hint="Merge this commit into the current branch"
              title="Merge this commit into the current branch"
              disabled={busy}
              onClick={() =>
                void confirm(confirmMerge(commit.shortSha)).then((ok) => {
                  if (ok) void runMergeOrRebase('merge', commit.sha)
                })
              }
            >
              Merge into current…
            </Button>
            <Button
              variant="ghost"
              icon={<GitBranch size={14} strokeWidth={1.75} />}
              hint="Rebase the current branch onto this commit"
              title="Rebase the current branch onto this commit"
              disabled={busy}
              onClick={() =>
                void confirm(confirmRebase(commit.shortSha)).then((ok) => {
                  if (ok) void runMergeOrRebase('rebase', commit.sha)
                })
              }
            >
              Rebase onto…
            </Button>
          </div>
        </div>
        {commit.body ? (
          <pre className="commit-body-compact muted">{commit.body}</pre>
        ) : null}
      </div>
      <div className="inspector-body" style={{ ['--inspector-files-width' as string]: `${filesWidth}px` }}>
        <ul
          className="file-list inspector-files"
          role="listbox"
          aria-label="Changed files"
          tabIndex={0}
          aria-activedescendant={selectedIndex >= 0 ? fileOptionId(selectedIndex) : undefined}
          onKeyDown={onFilesKeyDown}
          data-pane-focus
        >
          {files.map((f, index) => (
            <li
              key={f.path}
              id={fileOptionId(index)}
              role="option"
              aria-selected={selectedFile?.path === f.path}
              className={selectedFile?.path === f.path ? 'active' : ''}
              onClick={() => setSelectedFile(f)}
              title={f.path}
            >
              <div className="row-inline">
                <FileStatusDot kind={f.status} oldPath={f.oldPath} />
                <span className="cell-ellipsis">{f.path}</span>
              </div>
            </li>
          ))}
          {files.length === 0 && (
            <li className="muted" role="presentation">
              No file changes
            </li>
          )}
        </ul>
        <Splitter
          axis="x"
          className="splitter-inline-x"
          value={filesWidth}
          min={140}
          max={480}
          onChange={setInspectorFilesWidth}
          onChangeEnd={(w) => persistLayout({ inspectorFilesWidth: w })}
          title="Resize file list"
        />
        <div className="diff-host">
          <div className="diff-toolbar">
            <div className="diff-toolbar-end">
              <DiffViewSwitch />
            </div>
          </div>
          <div className="diff-editor-slot">
            {diffLoading ? (
              <div className="empty-state muted">Loading diff…</div>
            ) : diff ? (
              <FileDiffViewer
                diff={diff}
                editorKey={`${commit.sha}:${diff.path}`}
                sideBySide={diffView === 'side-by-side'}
              />
            ) : (
              <div className="empty-state muted">Select a file</div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
