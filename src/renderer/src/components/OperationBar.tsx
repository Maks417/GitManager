import type React from 'react'
import { Play, SkipForward, X } from 'lucide-react'
import { Button } from './ui'
import { CONFIRM_ABORT_MERGE, CONFIRM_ABORT_REBASE } from '../lib/copy'

interface OperationBarProps {
  /** The multi-step Git operation that is in progress. */
  kind: 'rebase' | 'merge'
  busy?: boolean
  /** Rebase only: continue after resolving conflicts. */
  onContinue?: () => Promise<unknown> | void
  /** Rebase only: drop the commit the rebase stopped on. */
  onSkip?: () => Promise<unknown> | void
  onAbort?: () => Promise<unknown> | void
  /** `pane` adds icons for the Changes pane; `toolbar` is the merge editor style. */
  variant?: 'toolbar' | 'pane'
}

export function OperationBar({
  kind,
  busy = false,
  onContinue,
  onSkip,
  onAbort,
  variant = 'toolbar'
}: OperationBarProps): React.JSX.Element | null {
  const canContinue = kind === 'rebase' && Boolean(onContinue)
  const canSkip = kind === 'rebase' && Boolean(onSkip)
  if (!canContinue && !canSkip && !onAbort) return null

  const pane = variant === 'pane'
  const runAbort = (): void => {
    if (!confirm(kind === 'rebase' ? CONFIRM_ABORT_REBASE : CONFIRM_ABORT_MERGE)) return
    void onAbort?.()
  }

  return (
    <div className={pane ? 'rebase-bar' : 'merge-toolbar'}>
      <span className="muted">
        {kind === 'rebase' ? 'Rebase in progress' : 'Merge in progress — commit to finish it'}
      </span>
      {canContinue && (
        <Button
          variant="primary"
          disabled={busy}
          hint="Continue rebase"
          title="Continue rebase"
          onClick={() => void onContinue?.()}
        >
          {pane && <Play size={14} strokeWidth={2} />}
          Continue rebase
        </Button>
      )}
      {canSkip && (
        <Button
          disabled={busy}
          hint="Skip the commit the rebase stopped on"
          title="Skip the commit the rebase stopped on"
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
          onClick={runAbort}
        >
          {pane && <X size={14} strokeWidth={2} />}
          Abort {kind}
        </Button>
      )}
    </div>
  )
}
