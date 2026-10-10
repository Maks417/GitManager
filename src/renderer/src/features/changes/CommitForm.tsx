import { useState } from 'react'
import type React from 'react'
import { Check, Pencil } from 'lucide-react'
import type { RemoteOpResult } from '@shared/ipc'
import { NOTHING_STAGED_COMMIT } from '@shared/git-messages'
import { Button } from '../../components/ui'
import { toErrorMessage } from '../../lib/errors'
import { loadCommitDraft, saveCommitDraft } from '../../logic/commit-drafts'
import { useGitActions } from '../../state/GitActionsProvider'

const STAGE_BEFORE_COMMIT = NOTHING_STAGED_COMMIT

interface CommitFormProps {
  repoPath: string
  busy: boolean
  /** Nothing can be amended before the first commit. */
  canAmend: boolean
  identityReady: boolean
  identityBar: React.ReactNode
  stagedCount: number
  changesCount: number
  mergeInProgress: boolean
  /** Runs a Git action with the pane's busy state, error reporting and refresh. */
  run: (fn: () => Promise<void>) => Promise<void>
  onCommitted: () => void
}

/**
 * Message, amend and push options and the Commit button. The message lives here, so typing renders
 * only this form, not the file list beside it.
 */
export function CommitForm({
  repoPath,
  busy,
  canAmend,
  identityReady,
  identityBar,
  stagedCount,
  changesCount,
  mergeInProgress,
  run,
  onCommitted
}: CommitFormProps): React.JSX.Element {
  const { pushCurrentBranch, resolveRemoteOutcome } = useGitActions()
  const [message, setMessageState] = useState(() => loadCommitDraft(repoPath))
  const setMessage = (next: string): void => {
    saveCommitDraft(repoPath, next)
    setMessageState(next)
  }
  const [amendChecked, setAmend] = useState(false)
  const amend = amendChecked && canAmend
  const [pushAfterCommit, setPushAfterCommit] = useState(false)

  // Concluding a merge may legitimately commit no new changes (e.g. every conflict resolved as ours).
  const needsStageBeforeCommit = !amend && !mergeInProgress && stagedCount === 0
  const hint =
    needsStageBeforeCommit && changesCount > 0
      ? STAGE_BEFORE_COMMIT
      : amend
        ? 'Amend the last commit'
        : 'Create a new commit'

  return (
    <div className="changes-commit-form">
      {identityBar}
      {!identityReady && (
        <p className="muted text-sm" style={{ margin: 0 }}>
          Set your name and email before committing.
        </p>
      )}
      {needsStageBeforeCommit && changesCount > 0 && (
        <p className="muted text-sm" style={{ margin: 0 }}>
          Stage files with <strong>Stage</strong> or <strong>Stage all</strong> before committing.
        </p>
      )}
      <textarea rows={3} placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} />
      <label className="amend-check row-inline text-sm">
        <input
          type="checkbox"
          checked={amend}
          disabled={!canAmend || busy}
          onChange={(e) => setAmend(e.target.checked)}
        />
        Amend last commit
      </label>
      {amend && (
        <p className="muted text-xs" style={{ margin: 0 }}>
          Replaces HEAD with this message and any staged changes.
        </p>
      )}
      <label className="amend-check row-inline text-sm">
        <input
          type="checkbox"
          checked={pushAfterCommit}
          disabled={busy}
          onChange={(e) => setPushAfterCommit(e.target.checked)}
        />
        Push to remote
      </label>
      <Button
        variant="primary"
        icon={amend ? <Pencil size={16} strokeWidth={1.75} /> : <Check size={16} strokeWidth={1.75} />}
        hint={hint}
        title={hint}
        disabled={busy || !message.trim() || !identityReady}
        onClick={() => {
          let pushed: RemoteOpResult | undefined
          void run(async () => {
            if (needsStageBeforeCommit) {
              if (changesCount > 0) throw new Error(STAGE_BEFORE_COMMIT)
              throw new Error('Nothing to commit — the working tree is clean.')
            }
            await window.gitManager.git.commit(repoPath, message.trim(), amend)
            // The commit exists now: clear the form before pushing, which can fail on its own.
            setMessage('')
            setAmend(false)
            onCommitted()
            if (pushAfterCommit) {
              try {
                // Same path as Sync → Push: progress and Cancel in the toolbar.
                pushed = await pushCurrentBranch()
              } catch (err) {
                throw new Error(`Committed, but the push failed: ${toErrorMessage(err)}`)
              }
            }
          }).then(() => {
            // A rejected push offers a pull or a force push, once this pane is no longer busy.
            if (pushed) void resolveRemoteOutcome(pushed)
          })
        }}
      >
        {amend ? 'Amend' : 'Commit'}
      </Button>
    </div>
  )
}
