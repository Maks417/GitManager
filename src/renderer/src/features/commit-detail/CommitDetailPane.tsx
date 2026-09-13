import type React from 'react'
import { Copy, GitBranch, GitMerge } from 'lucide-react'
import type { CommitDetail, DiffResult, FileChange } from '@shared/ipc'
import { FileDiffViewer } from '../diff/FileDiffViewer'
import { Splitter } from '../../components/Splitter'
import { Button } from '../../components/ui'

interface Props {
  detail: CommitDetail | null
  selectedFile: FileChange | null
  diff: DiffResult | null
  diffLoading?: boolean
  onSelectFile: (file: FileChange) => void
  /** Prefer side-by-side when inspector is wide/tall enough. */
  sideBySide?: boolean
  busy?: boolean
  onMergeIntoCurrent?: (sha: string) => Promise<void>
  onRebaseOnto?: (sha: string) => Promise<void>
  filesWidth?: number
  onFilesWidthChange?: (width: number) => void
  onFilesWidthCommit?: (width: number) => void
}

function formatRelativeDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diffMs = Date.now() - d.getTime()
  const sec = Math.round(diffMs / 1000)
  if (sec < 60) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' })
}

export function CommitDetailPane({
  detail,
  selectedFile,
  diff,
  diffLoading,
  onSelectFile,
  sideBySide = false,
  busy = false,
  onMergeIntoCurrent,
  onRebaseOnto,
  filesWidth = 200,
  onFilesWidthChange,
  onFilesWidthCommit
}: Props): React.JSX.Element {
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
          <Button
            variant="ghost"
            icon={<Copy size={14} strokeWidth={1.75} />}
            hint="Copy full SHA"
            title="Copy full SHA"
            onClick={() => void navigator.clipboard.writeText(commit.sha)}
          >
            Copy SHA
          </Button>
          {onMergeIntoCurrent && (
            <Button
              variant="ghost"
              icon={<GitMerge size={14} strokeWidth={1.75} />}
              hint="Merge this commit into the current branch"
              title="Merge this commit into the current branch"
              disabled={busy}
              onClick={() => void onMergeIntoCurrent(commit.sha)}
            >
              Merge into current…
            </Button>
          )}
          {onRebaseOnto && (
            <Button
              variant="ghost"
              icon={<GitBranch size={14} strokeWidth={1.75} />}
              hint="Rebase the current branch onto this commit"
              title="Rebase the current branch onto this commit"
              disabled={busy}
              onClick={() => void onRebaseOnto(commit.sha)}
            >
              Rebase onto…
            </Button>
          )}
        </div>
        {commit.body ? (
          <pre className="commit-body-compact muted">{commit.body}</pre>
        ) : null}
      </div>
      <div className="inspector-body" style={{ ['--inspector-files-width' as string]: `${filesWidth}px` }}>
        <ul className="file-list inspector-files">
          {files.map((f) => (
            <li
              key={f.path}
              className={selectedFile?.path === f.path ? 'active' : ''}
              onClick={() => onSelectFile(f)}
              title={f.path}
            >
              <span className="muted" style={{ marginRight: 6 }}>
                {f.status[0]?.toUpperCase()}
              </span>
              <span className="cell-ellipsis">{f.path}</span>
            </li>
          ))}
          {files.length === 0 && <li className="muted">No file changes</li>}
        </ul>
        {onFilesWidthChange && (
          <Splitter
            axis="x"
            className="splitter-inline-x"
            value={filesWidth}
            min={140}
            max={480}
            onChange={onFilesWidthChange}
            onChangeEnd={onFilesWidthCommit}
            title="Resize file list"
          />
        )}
        <div className="diff-host">
          <div className="diff-editor-slot">
            {diffLoading ? (
              <div className="empty-state muted">Loading diff…</div>
            ) : diff ? (
              <FileDiffViewer
                diff={diff}
                editorKey={`${commit.sha}:${diff.path}`}
                sideBySide={sideBySide}
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
