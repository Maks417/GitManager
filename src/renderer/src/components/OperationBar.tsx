import type React from 'react'
import { Play, SkipForward, X } from 'lucide-react'
import { Button } from './ui'
import { CONFIRM_ABORT_MERGE, CONFIRM_ABORT_REBASE, confirmAbortSequencer } from '../lib/copy'
import { useConfirm } from '../state/ConfirmProvider'

export type OperationKind = 'rebase' | 'merge' | 'cherry-pick' | 'revert'

interface OperationBarProps {
  /** The multi-step Git operation that is in progress. */
  kind: OperationKind
  busy?: boolean
  /** Not for a merge (a commit finishes it): continue after resolving conflicts. */
  onContinue?: () => Promise<unknown> | void
  /** Not for a merge: drop the commit the operation stopped on. */
  onSkip?: () => Promise<unknown> | void
  onAbort?: () => Promise<unknown> | void
  /** `pane` adds icons for the Changes pane; `toolbar` is the merge editor style. */
  variant?: 'toolbar' | 'pane'
}

const LABEL: Record<OperationKind, string> = {
  rebase: 'Rebase in progress',
  merge: 'Merge in progress — commit to finish it',
  'cherry-pick': 'Cherry-pick in progress',
  revert: 'Revert in progress'
}

export function OperationBar({
  kind,
  busy = false,
  onContinue,
  onSkip,
  onAbort,
  variant = 'toolbar'
}: OperationBarProps): React.JSX.Element | null {
  const confirm = useConfirm()
  const canContinue = kind !== 'merge' && Boolean(onContinue)
  const canSkip = kind !== 'merge' && Boolean(onSkip)
  if (!canContinue && !canSkip && !onAbort) return null

  const pane = variant === 'pane'
  const runAbort = async (): Promise<void> => {
    const request =
      kind === 'rebase' ? CONFIRM_ABORT_REBASE : kind === 'merge' ? CONFIRM_ABORT_MERGE : confirmAbortSequencer(kind)
    if (!(await confirm(request))) return
    await onAbort?.()
  }

  return (
    <div className={pane ? 'rebase-bar' : 'merge-toolbar'}>
      <span className="muted">{LABEL[kind]}</span>
      {canContinue && (
        <Button
          variant="primary"
          disabled={busy}
          hint={`Continue ${kind}`}
          title={`Continue ${kind}`}
          onClick={() => void onContinue?.()}
        >
          {pane && <Play size={14} strokeWidth={2} />}
          Continue {kind}
        </Button>
      )}
      {canSkip && (
        <Button
          disabled={busy}
          hint={`Skip the commit the ${kind} stopped on`}
          title={`Skip the commit the ${kind} stopped on`}
          onClick={() => void onSkip?.()}
        >
          {pane && <SkipForward size={14} strokeWidth={2} />}
          Skip commit
        </Button>
      )}
      {onAbort && (
        <Button
          disabled={busy}
          hint={`Abort the in-progress ${kind}`}
          title={`Abort the in-progress ${kind}`}
          onClick={() => void runAbort()}
        >
          {pane && <X size={14} strokeWidth={2} />}
          Abort {kind}
        </Button>
      )}
    </div>
  )
}
