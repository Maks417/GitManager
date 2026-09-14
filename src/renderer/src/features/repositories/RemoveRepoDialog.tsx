import { useEffect, useState } from 'react'
import type React from 'react'
import type { RepoRemovalInfo, Repository } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal } from '../../components/ui'
import { toErrorMessage } from '../../lib/errors'

interface Props {
  repo: Repository
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (deleteFiles: boolean) => void
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

export function RemoveRepoDialog({ repo, busy, error, onCancel, onConfirm }: Props): React.JSX.Element {
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [info, setInfo] = useState<(RepoRemovalInfo & { path: string }) | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!deleteFiles || info || infoError) return
    let cancelled = false
    void window.gitManager.repo
      .removalInfo(repo.id)
      .then((next) => {
        if (!cancelled) setInfo(next)
      })
      .catch((err) => {
        if (!cancelled) setInfoError(toErrorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [deleteFiles, info, infoError, repo.id])

  const risks = info
    ? [
        info.uncommitted > 0 && plural(info.uncommitted, 'uncommitted change', 'uncommitted changes'),
        info.stashes > 0 && plural(info.stashes, 'stash', 'stashes'),
        info.unpushed > 0 && plural(info.unpushed, 'commit not pushed to any remote', 'commits not pushed to any remote')
      ].filter((r): r is string => Boolean(r))
    : []
  const checking = deleteFiles && !info && !infoError
  // Unknown state (check failed) is treated like risky work: require typing the name.
  const needsTypedName = deleteFiles && (risks.length > 0 || Boolean(infoError))
  const canConfirm = !busy && !checking && (!needsTypedName || typed.trim() === repo.name)

  return (
    <Modal
      title="Remove repository"
      onClose={busy ? () => undefined : onCancel}
      className="confirm-dialog"
      style={{ width: 'min(520px, 92vw)' }}
      footer={
        <div className="modal-actions">
          <Button disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={deleteFiles ? 'danger' : 'primary'}
            disabled={!canConfirm}
            onClick={() => onConfirm(deleteFiles)}
          >
            {busy ? 'Working…' : deleteFiles ? 'Move to Trash' : 'Remove from list'}
          </Button>
        </div>
      }
    >
      <p className="confirm-dialog-message">Remove “{repo.name}” from the list?</p>
      <code className="text-sm" style={{ wordBreak: 'break-all' }}>
        {info?.path ?? repo.path}
      </code>
      <label className="confirm-dialog-check">
        <input
          type="checkbox"
          checked={deleteFiles}
          disabled={busy}
          onChange={(e) => {
            setDeleteFiles(e.target.checked)
            setTyped('')
          }}
        />
        <span>Also move the repository folder to the Trash</span>
      </label>
      {deleteFiles && (
        <>
          {checking && <p className="muted text-sm">Checking for work that is not saved elsewhere…</p>}
          {risks.length > 0 && (
            <Banner tone="warning">
              This folder contains {risks.join(', ')}. They will only be recoverable from the Trash.
            </Banner>
          )}
          {infoError && (
            <Banner tone="warning">Could not check the repository for unsaved work: {infoError}</Banner>
          )}
          {info && risks.length === 0 && (
            <p className="muted text-sm">No uncommitted changes, stashes, or unpushed commits found.</p>
          )}
          {needsTypedName && (
            <Field label={`Type “${repo.name}” to confirm`}>
              <Input
                className="w-full"
                value={typed}
                disabled={busy}
                onChange={(e) => setTyped(e.target.value)}
                autoFocus
              />
            </Field>
          )}
        </>
      )}
      {error && <Banner>{error}</Banner>}
    </Modal>
  )
}
