import { useEffect, useState } from 'react'
import type React from 'react'
import type { Commit, ResetMode } from '@shared/ipc'
import { Banner, Button, Modal } from '../../components/ui'
import { useAsyncAction } from '../../lib/useAsyncAction'

interface Props {
  commit: Commit
  repoPath: string
  /** The branch that moves, or null with a detached HEAD. */
  branch: string | null
  /** Files with uncommitted changes. */
  changedFiles: number
  onClose: () => void
  onReset: (mode: ResetMode) => Promise<void>
}

const MODES: { mode: ResetMode; title: string; detail: string }[] = [
  { mode: 'soft', title: 'Soft', detail: 'Keep every change, staged: the commits after it become one set of staged changes.' },
  { mode: 'mixed', title: 'Mixed', detail: 'Keep every change in the files, unstaged.' },
  { mode: 'hard', title: 'Hard', detail: 'Discard every change after it, committed or not. The files match the commit.' }
]

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

export function ResetModal({ commit, repoPath, branch, changedFiles, onClose, onReset }: Props): React.JSX.Element {
  const [mode, setMode] = useState<ResetMode>('mixed')
  const [commitsAfter, setCommitsAfter] = useState<number | null>(null)
  const { busy, error, run } = useAsyncAction()

  useEffect(() => {
    let cancelled = false
    window.gitManager.git.commitsAfter(repoPath, commit.sha).then(
      (n) => {
        if (!cancelled) setCommitsAfter(n)
      },
      () => undefined
    )
    return () => {
      cancelled = true
    }
  }, [repoPath, commit.sha])

  const target = branch ?? 'HEAD'
  const losses: string[] = []
  if (commitsAfter) losses.push(`${plural(commitsAfter, 'commit')} after it will no longer be on ${target}`)
  if (mode === 'hard' && changedFiles > 0) {
    losses.push(`uncommitted changes in ${plural(changedFiles, 'file')} will be lost`)
  }

  return (
    <Modal
      title={`Reset ${target}`}
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={mode === 'hard' ? 'danger' : 'primary'}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await onReset(mode)
                onClose()
              })
            }
          >
            {busy ? 'Resetting' : `Reset (${mode})`}
          </Button>
        </div>
      }
    >
      <p className="muted modal-lead">
        Move {target} to <span className="sha">{commit.shortSha}</span> {commit.subject}
      </p>
      {error && <Banner>{error}</Banner>}
      <div className="reset-modes" role="radiogroup" aria-label="Reset mode">
        {MODES.map((m) => (
          <label key={m.mode} className={`reset-mode${mode === m.mode ? ' active' : ''}`}>
            <input type="radio" name="reset-mode" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
            <span>
              <strong className={m.mode === 'hard' ? 'reset-mode-danger' : undefined}>{m.title}</strong>
              <span className="muted"> — {m.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {losses.length > 0 && (
        <Banner tone={mode === 'hard' ? 'warning' : 'info'}>
          {losses.join('; ').replace(/^./, (c) => c.toUpperCase())}.
          {commitsAfter ? ' The previous commit is saved in Repository → Recovery.' : ''}
          {mode === 'hard' && changedFiles > 0 ? ' Tracked changes are backed up there before reset; untracked files are not included.' : ''}
        </Banner>
      )}
    </Modal>
  )
}
