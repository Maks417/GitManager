import { useEffect, useState } from 'react'
import type React from 'react'
import type { RecoveryEntry } from '@shared/ipc'
import { Banner, Button, Modal } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'
import { toErrorMessage } from '../../lib/errors'
import { formatRelativeDate } from '../../lib/format'
import { useConfirm } from '../../state/ConfirmProvider'
import { useGitActions, useRemoteOp } from '../../state/GitActionsProvider'
import { useAppStatus } from '../../state/AppStatusProvider'
import { useHistoryActions } from '../../state/HistoryProvider'
import { useSessionActions } from '../../state/RepoSessionProvider'
import { CreateBranchModal } from '../branches/CreateBranchModal'

interface Props { repoPath: string; onClose: () => void }

export function RecoveryModal({ repoPath, onClose }: Props): React.JSX.Element {
  const [entries, setEntries] = useState<RecoveryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [branchAt, setBranchAt] = useState<RecoveryEntry | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const { busy, error, setError, run } = useAsyncAction()
  const { busy: appBusy } = useAppStatus()
  const remoteOp = useRemoteOp()
  const blocked = busy || appBusy || Boolean(remoteOp)
  const confirm = useConfirm()
  const { createBranch } = useGitActions()
  const { afterGitMutation } = useSessionActions()
  const { inspectCommit } = useHistoryActions()

  useEffect(() => {
    let cancelled = false
    window.gitManager.git.recovery(repoPath).then(
      (list) => { if (!cancelled) { setEntries(list); setLoading(false) } },
      (err) => { if (!cancelled) { setError(toErrorMessage(err)); setLoading(false) } }
    )
    return () => { cancelled = true }
  }, [repoPath, setError])

  const reload = async (): Promise<void> => setEntries(await window.gitManager.git.recovery(repoPath))

  return (
    <>
      <Modal title="Recovery" wide onClose={onClose} dismissible={!busy}
        footer={<div className="modal-actions"><Button disabled={busy} onClick={() => void run(reload)}>Refresh</Button><Button disabled={busy} onClick={onClose}>Close</Button></div>}
      >
        <p className="muted">Recover a commit by creating a branch at it. Restore a tracked-file backup after committing or stashing your current changes. Backups are kept until you remove them.</p>
        {error && <Banner>{error}</Banner>}
        {notice && <Banner tone="info">{notice}</Banner>}
        {loading && <p className="muted">Loading recovery history…</p>}
        <ul className="repo-list recovery-list" aria-label="Saved backups and recent HEAD history">
          {entries.map((entry, index) => <li key={`${entry.id}:${index}`}>
            <div className="remote-config-description"><strong>{entry.label}</strong><div className="muted text-xs"><span className="sha">{entry.sha.slice(0, 7)}</span> · {entry.createdAt ? formatRelativeDate(entry.createdAt) : ''} · {entry.saved ? entry.kind === 'worktree' ? 'Tracked-file backup' : 'Saved commit' : 'HEAD history'}</div></div>
            <div className="row-inline">
              {entry.kind === 'commit' ? <>
                <Button disabled={blocked} onClick={() => setBranchAt(entry)}>Create branch…</Button>
                <Button disabled={busy} onClick={() => { onClose(); void inspectCommit(entry.sha) }}>Show commit</Button>
              </> : <Button disabled={blocked} onClick={() => {
                void confirm({ title: 'Restore tracked changes', message: 'Apply this backup to the current branch, including its staged changes? Your working tree must be clean. The backup is kept, and Git may report conflicts when the branch has changed.', confirmLabel: 'Restore' }).then((ok) => {
                  if (ok) void run(async () => {
                    try { await window.gitManager.git.restoreRecovery(repoPath, entry.id) } finally { await afterGitMutation({ history: 'tip' }) }
                    setNotice('Restored tracked changes. The backup is still available.')
                  })
                })
              }}>Restore changes</Button>}
              {entry.saved && <Button disabled={blocked} onClick={() => {
                void confirm({ title: 'Remove recovery backup', message: 'Remove this saved recovery backup? Work that exists only in this backup may become unrecoverable after Git garbage collection.', confirmLabel: 'Remove', danger: true }).then((ok) => {
                  if (ok) void run(async () => { await window.gitManager.git.deleteRecovery(repoPath, entry.id); await reload() })
                })
              }}>Remove</Button>}
            </div>
          </li>)}
        </ul>
        {!loading && entries.length === 0 && <p className="muted">No recovery history yet.</p>}
        <p className="muted text-xs">Showing up to 50 saved backups and 100 recent HEAD entries. Tracked-file backups include the index and working tree; untracked files discarded from Changes are in the Trash.</p>
      </Modal>
      {branchAt && <CreateBranchModal initialCheckout={false} lead={<>Recover <span className="sha">{branchAt.sha.slice(0, 7)}</span> · {branchAt.label}</>} onClose={() => setBranchAt(null)} onCreate={async (name, checkout) => { await createBranch(name, checkout, branchAt.sha); await reload(); setNotice(`Recovered as ${name}.`) }} />}
    </>
  )
}
