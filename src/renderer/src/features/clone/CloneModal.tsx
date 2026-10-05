import { useEffect, useState } from 'react'
import type React from 'react'
import { repoNameFromUrl } from '@shared/clone-target'
import type { Repository } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal } from '../../components/ui'
import { CLONE_URL_SESSION_KEY } from '../../lib/copy'
import { toErrorMessage } from '../../lib/errors'
import { joinDisplayPath } from '../../lib/paths'

interface Props {
  onClose: () => void
  onCloned: (repo: Repository) => Promise<void>
}

/** The clone that is running: Git's current step, and whether a cancel was requested. */
interface RunningClone {
  opId: string
  phase: string | null
  percent: number | null
  cancelling: boolean
}

function progressLabel(clone: RunningClone): string {
  if (clone.cancelling) return 'Cancelling…'
  const phase = clone.phase ? ` · ${clone.phase}` : '…'
  const percent = clone.percent !== null ? ` ${clone.percent}%` : ''
  return `Cloning${phase}${percent}`
}

export function CloneModal({ onClose, onCloned }: Props): React.JSX.Element {
  // A URL handed over by the Accounts dialog, read when the dialog opens.
  const [url, setUrl] = useState(() => sessionStorage.getItem(CLONE_URL_SESSION_KEY) ?? '')
  const [targetDir, setTargetDir] = useState('')
  const [clone, setClone] = useState<RunningClone | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const opId = clone?.opId ?? null

  // The handed-over URL is used once; a later clone dialog starts empty.
  useEffect(() => {
    sessionStorage.removeItem(CLONE_URL_SESSION_KEY)
  }, [])

  useEffect(() => {
    if (!opId) return
    return window.gitManager.git.onProgress((progress) => {
      if (progress.opId !== opId) return
      setClone((current) =>
        current?.opId === opId ? { ...current, phase: progress.phase, percent: progress.percent } : current
      )
    })
  }, [opId])

  const pickDir = async (): Promise<void> => {
    const next = await window.gitManager.repo.pickDirectory()
    if (next) setTargetDir(next)
  }

  const start = async (): Promise<void> => {
    const source = url.trim()
    const parent = targetDir.trim()
    if (!source || !parent) {
      setError('Enter the repository URL and the parent folder.')
      return
    }
    const id = crypto.randomUUID()
    setError(null)
    setNotice(null)
    setClone({ opId: id, phase: null, percent: null, cancelling: false })
    try {
      const result = await window.gitManager.repo.clone({ url: source, targetDir: parent, opId: id })
      if (result.outcome === 'cancelled') {
        setNotice('Clone cancelled. The partly cloned folder was removed.')
        return
      }
      await onCloned(result.repo)
    } catch (err) {
      setError(toErrorMessage(err))
    } finally {
      setClone(null)
    }
  }

  const cancel = (): void => {
    if (!clone || clone.cancelling) return
    setClone({ ...clone, cancelling: true })
    void window.gitManager.git.cancelOperation(clone.opId)
  }

  const cloning = clone !== null
  const destination =
    url.trim() && targetDir.trim() ? joinDisplayPath(targetDir.trim(), repoNameFromUrl(url)) : null

  return (
    <Modal
      title="Clone repository"
      onClose={onClose}
      // A running clone ends through Cancel clone, which also removes its folder.
      dismissible={!cloning}
      footer={
        <div className="modal-actions">
          {cloning ? (
            <Button disabled={clone.cancelling} onClick={cancel}>
              Cancel clone
            </Button>
          ) : (
            <Button onClick={onClose}>Cancel</Button>
          )}
          <Button variant="primary" disabled={cloning} onClick={() => void start()}>
            {cloning ? 'Cloning' : 'Clone'}
          </Button>
        </div>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        Paste an HTTPS or SSH URL from GitHub, GitLab, Bitbucket, or any Git host. HTTPS uses your Git
        credential helper; SSH uses your SSH agent and keys.
      </p>
      {error && <Banner>{error}</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}
      <Field label="Repository URL">
        <Input className="w-full" value={url} disabled={cloning} onChange={(e) => setUrl(e.target.value)} />
      </Field>
      <Field label="Parent folder">
        <div className="row-inline">
          <Input
            className="w-full"
            value={targetDir}
            disabled={cloning}
            onChange={(e) => setTargetDir(e.target.value)}
          />
          <Button disabled={cloning} onClick={() => void pickDir()}>
            Browse
          </Button>
        </div>
      </Field>
      {destination && (
        <p className="muted text-sm" style={{ margin: 0, wordBreak: 'break-all' }}>
          Clones into <code>{destination}</code>
        </p>
      )}
      {clone && (
        <div className="clone-progress" role="status" aria-live="polite">
          <span className="clone-progress-label cell-ellipsis">{progressLabel(clone)}</span>
          <span className={`sync-progress-bar${clone.percent === null ? ' indeterminate' : ''}`} aria-hidden>
            <span style={clone.percent === null ? undefined : { width: `${clone.percent}%` }} />
          </span>
        </div>
      )}
    </Modal>
  )
}
