import type React from 'react'
import { Play, X } from 'lucide-react'
import { Button } from './ui'
import { CONFIRM_ABORT_REBASE } from '../lib/copy'

interface RebaseProgressBarProps {
  busy?: boolean
  onContinue?: () => Promise<void> | void
  onAbort?: () => Promise<void> | void
  /** Compact icon+label style used in WorkingTreeDetailPane */
  variant?: 'toolbar' | 'pane'
}

export function RebaseProgressBar({
  busy = false,
  onContinue,
  onAbort,
  variant = 'toolbar'
}: RebaseProgressBarProps): React.JSX.Element | null {
  if (!onContinue && !onAbort) return null

  const runAbort = (): void => {
    if (!confirm(CONFIRM_ABORT_REBASE)) return
    void onAbort?.()
  }

  if (variant === 'pane') {
    return (
      <div className="rebase-bar">
        <span className="muted">Rebase in progress</span>
        {onContinue && (
          <Button
            variant="primary"
            disabled={busy}
            hint="Continue rebase"
            title="Continue rebase"
            onClick={() => void onContinue()}
          >
            <Play size={14} strokeWidth={2} />
            Continue rebase
          </Button>
        )}
        {onAbort && (
          <Button
            disabled={busy}
            hint="Abort the in-progress rebase"
            title="Abort the in-progress rebase"
            onClick={runAbort}
          >
            <X size={14} strokeWidth={2} />
            Abort
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="merge-toolbar">
      <span className="muted">Rebase in progress</span>
      {onContinue && (
        <Button variant="primary" disabled={busy} onClick={() => void onContinue()}>
          Continue rebase
        </Button>
      )}
      {onAbort && (
        <Button disabled={busy} onClick={runAbort}>
          Abort rebase
        </Button>
      )}
    </div>
  )
}
