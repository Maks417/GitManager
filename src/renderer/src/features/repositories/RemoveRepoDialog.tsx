import { useEffect, useState } from 'react'
import type React from 'react'
import type { RepoRemovalInfo, RepoRemoveOptions, Repository, WorktreeInfo } from '@shared/ipc'
import { Banner, Button, Field, Input, Modal } from '../../components/ui'
import { toErrorMessage } from '../../lib/errors'

interface Props {
  repo: Repository
  busy: boolean
  error: string | null
  /** Set once the repository is off the list but Git still lists it as a worktree; only Close is left. */
  warning: string | null
  onCancel: () => void
  onConfirm: (options: RepoRemoveOptions) => void
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** The last segment of a path, to name a repository in a sentence. */
function folderName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function RemoveRepoDialog({ repo, busy, error, warning, onCancel, onConfirm }: Props): React.JSX.Element {
  const [deleteFiles, setDeleteFiles] = useState(false)
  const [pruneRecord, setPruneRecord] = useState(true)
  const [info, setInfo] = useState<(RepoRemovalInfo & { path: string }) | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [worktree, setWorktree] = useState<WorktreeInfo | null>(null)
  const [typed, setTyped] = useState('')

  // Quick: whether the folder still exists, and how it relates to other worktrees.
  useEffect(() => {
    let cancelled = false
    window.gitManager.repo.worktreeInfo(repo.id).then(
      (next) => {
        if (!cancelled) setWorktree(next)
      },
      // Without it the dialog offers what it offers for any repository.
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [repo.id])

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

  const done = warning !== null
  const folderMissing = worktree?.exists === false
  const trashing = deleteFiles && !folderMissing
  const linked = worktree?.linkedTo ?? null
  const dependents = trashing ? (worktree?.otherWorktrees ?? 0) : 0
  const risks = info
    ? [
        info.uncommitted > 0 && plural(info.uncommitted, 'uncommitted change', 'uncommitted changes'),
        info.stashes > 0 && plural(info.stashes, 'stash', 'stashes'),
        info.unpushed > 0 && plural(info.unpushed, 'commit not pushed to any remote', 'commits not pushed to any remote')
      ].filter((r): r is string => Boolean(r))
    : []
  const checking = trashing && !info && !infoError
  // Unknown state (check failed) is treated like risky work: require typing the name.
  const needsTypedName = trashing && (risks.length > 0 || dependents > 0 || Boolean(infoError))
  // Git's record of a linked worktree can go once its folder does, unless the worktree is locked.
  const canPrune = Boolean(linked?.mainExists && !linked.locked && (trashing || folderMissing))
  const canConfirm = !busy && !done && !checking && (!needsTypedName || typed.trim() === repo.name)

  return (
    <Modal
      title="Remove repository"
      onClose={busy ? () => undefined : onCancel}
      className="confirm-dialog"
      style={{ width: 'min(520px, 92vw)' }}
      footer={
        <div className="modal-actions">
          {done ? (
            <Button variant="primary" onClick={onCancel}>
              Close
            </Button>
          ) : (
            <>
              <Button disabled={busy} onClick={onCancel}>
                Cancel
              </Button>
              <Button
                variant={trashing ? 'danger' : 'primary'}
                disabled={!canConfirm}
                onClick={() => onConfirm({ deleteFiles: trashing, pruneWorktree: canPrune && pruneRecord })}
              >
                {busy ? 'Working…' : trashing ? 'Move to Trash' : 'Remove from list'}
              </Button>
            </>
          )}
        </div>
      }
    >
      <p className="confirm-dialog-message">
        {done ? `“${repo.name}” was removed from the list.` : `Remove “${repo.name}” from the list?`}
      </p>
      <code className="text-sm" style={{ wordBreak: 'break-all' }}>
        {info?.path ?? repo.path}
      </code>
      {linked && (
        <p className="muted text-sm" style={{ margin: 0, wordBreak: 'break-all' }}>
          A linked worktree of <code>{linked.mainPath}</code>.
        </p>
      )}
      {folderMissing && (
        <p className="muted text-sm" style={{ margin: 0 }}>
          The folder no longer exists.
        </p>
      )}
      {!folderMissing && !done && (
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
      )}
      {linked && canPrune && !done && (
        <label className="confirm-dialog-check">
          <input
            type="checkbox"
            checked={pruneRecord}
            disabled={busy}
            onChange={(e) => setPruneRecord(e.target.checked)}
          />
          <span>Also remove it from the worktrees of {folderName(linked.mainPath)}</span>
        </label>
      )}
      {linked?.locked && (trashing || folderMissing) && !done && (
        <p className="muted text-sm" style={{ margin: 0 }}>
          Git keeps this worktree locked, so {folderName(linked.mainPath)} will still list it. Unlock it with git
          worktree unlock to remove that record.
        </p>
      )}
      {trashing && !done && (
        <>
          {checking && <p className="muted text-sm">Checking for work that is not saved elsewhere…</p>}
          {risks.length > 0 && (
            <Banner tone="warning">
              This folder contains {risks.join(', ')}. They will only be recoverable from the Trash.
            </Banner>
          )}
          {dependents > 0 && (
            <Banner tone="warning">
              {plural(dependents, 'linked worktree uses', 'linked worktrees use')} this repository&apos;s history and
              will stop working once its folder is gone.
            </Banner>
          )}
          {infoError && (
            <Banner tone="warning">Could not check the repository for unsaved work: {infoError}</Banner>
          )}
          {info && risks.length === 0 && dependents === 0 && (
            <p className="muted text-sm">
              {linked
                ? `No uncommitted changes found. Its commits, branches and stashes stay in ${folderName(linked.mainPath)}.`
                : 'No uncommitted changes, stashes, or unpushed commits found.'}
            </p>
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
      {warning && <Banner tone="warning">{warning}</Banner>}
      {error && <Banner>{error}</Banner>}
    </Modal>
  )
}
