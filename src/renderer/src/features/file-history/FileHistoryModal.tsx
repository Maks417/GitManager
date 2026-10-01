import { useEffect, useState } from 'react'
import type React from 'react'
import type { DiffResult, FileHistoryEntry } from '@shared/ipc'
import { Banner, Button, FileStatusDot, Modal } from '../../components/ui'
import { toErrorMessage } from '../../lib/errors'
import { formatRelativeDate } from '../../lib/format'
import { nextListIndex } from '../../logic/list-nav'
import { useLayout } from '../../state/LayoutProvider'
import { DiffViewSwitch } from '../diff/DiffViewSwitch'
import { FileDiffViewer } from '../diff/FileDiffViewer'
import { SyntaxHighlightToggle } from '../diff/SyntaxHighlightToggle'

interface Props {
  repoPath: string
  path: string
  onClose: () => void
  onShowInHistory: (sha: string) => void
  onBlame: (path: string, sha: string) => void
}

const dialogStyle: React.CSSProperties = {
  width: 'min(1200px, 96vw)',
  height: 'min(860px, 92vh)',
  display: 'flex',
  flexDirection: 'column'
}

const optionId = (index: number): string => `file-history-${index}`

/** Every commit that changed a file, across renames, with the file's diff in the selected one. */
export function FileHistoryModal({ repoPath, path, onClose, onShowInHistory, onBlame }: Props): React.JSX.Element {
  const { diffView, syntaxHighlighting } = useLayout()
  const [entries, setEntries] = useState<FileHistoryEntry[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [diff, setDiff] = useState<{ sha: string; result: DiffResult } | null>(null)

  useEffect(() => {
    let cancelled = false
    window.gitManager.history.fileHistory(repoPath, path).then(
      (page) => {
        if (cancelled) return
        setEntries(page.entries)
        setHasMore(page.hasMore)
        setLoading(false)
      },
      (err) => {
        if (cancelled) return
        setError(toErrorMessage(err))
        setLoading(false)
      }
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, path])

  const entry = entries[selected]
  const entrySha = entry?.sha
  const entryPath = entry?.path
  const entryOldPath = entry?.oldPath
  useEffect(() => {
    if (!entrySha || !entryPath) return
    let cancelled = false
    window.gitManager.history
      .fileDiff({ repoPath, sha: entrySha, path: entryPath, oldPath: entryOldPath, parentIndex: 0 })
      .then(
        (result) => {
          if (!cancelled) setDiff({ sha: entrySha, result })
        },
        (err) => {
          if (!cancelled) setError(toErrorMessage(err))
        }
      )
    return () => {
      cancelled = true
    }
  }, [repoPath, entrySha, entryPath, entryOldPath])

  const loadMore = (): void => {
    setLoading(true)
    window.gitManager.history.fileHistory(repoPath, path, entries.length).then(
      (page) => {
        setEntries((prev) => [...prev, ...page.entries])
        setHasMore(page.hasMore)
        setLoading(false)
      },
      (err) => {
        setError(toErrorMessage(err))
        setLoading(false)
      }
    )
  }

  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>): void => {
    const next = nextListIndex(e.key, selected, entries.length)
    if (next === null) return
    e.preventDefault()
    setSelected(next)
    document.getElementById(optionId(next))?.scrollIntoView({ block: 'nearest' })
  }

  const shown = diff && diff.sha === entrySha ? diff.result : null

  return (
    <Modal
      title={`History of ${path}`}
      onClose={onClose}
      className="file-history-modal"
      bodyClassName="file-history-body"
      style={dialogStyle}
      footer={
        <div className="modal-actions">
          <Button disabled={!entry} onClick={() => entry && onShowInHistory(entry.sha)}>
            Show in History
          </Button>
          <Button
            disabled={!entry || entry.status === 'deleted'}
            onClick={() => entry && onBlame(entry.path, entry.sha)}
          >
            Blame at this commit
          </Button>
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      {error && <Banner>{error}</Banner>}
      <div className="file-history-layout">
        <ul
          className="file-list file-history-list"
          role="listbox"
          aria-label="Commits that changed the file"
          tabIndex={0}
          aria-activedescendant={entry ? optionId(selected) : undefined}
          onKeyDown={onListKeyDown}
        >
          {entries.map((e, index) => (
            <li
              key={e.sha}
              id={optionId(index)}
              role="option"
              aria-selected={index === selected}
              className={index === selected ? 'active' : ''}
              onClick={() => setSelected(index)}
              title={[e.subject, e.oldPath ? `${e.oldPath} → ${e.path}` : e.path].join('\n')}
            >
              <div className="row-inline">
                <FileStatusDot kind={e.status} oldPath={e.oldPath} />
                <span className="cell-ellipsis">{e.subject}</span>
              </div>
              <div className="muted file-history-meta cell-ellipsis">
                <span className="sha">{e.shortSha}</span> · {e.authorName} · {formatRelativeDate(e.authoredAt)}
                {e.path !== path && <> · {e.path}</>}
              </div>
            </li>
          ))}
          {!loading && entries.length === 0 && !error && (
            <li className="muted" role="presentation">
              No commits changed this file.
            </li>
          )}
          {(loading || hasMore) && (
            <li role="presentation" className="file-history-more">
              {loading ? (
                <span className="muted">Loading…</span>
              ) : (
                <Button variant="ghost" onClick={loadMore}>
                  Load older commits
                </Button>
              )}
            </li>
          )}
        </ul>
        <div className="diff-host">
          <div className="diff-toolbar">
            {entry && (
              <span className="muted cell-ellipsis">
                {entry.oldPath ? `${entry.oldPath} → ${entry.path}` : entry.path}
              </span>
            )}
            <div className="diff-toolbar-end">
              <SyntaxHighlightToggle />
              <DiffViewSwitch />
            </div>
          </div>
          <div className="diff-editor-slot">
            {shown ? (
              <FileDiffViewer
                diff={shown}
                editorKey={`file-history:${entrySha}`}
                sideBySide={diffView === 'side-by-side'}
                syntaxHighlighting={syntaxHighlighting}
              />
            ) : (
              <div className="empty-state muted">{entry ? 'Loading diff…' : ''}</div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
