import type React from 'react'
import { Button } from '../../components/ui'
import { useGitActions, useRemoteOp } from '../../state/GitActionsProvider'

export function RemoteOperationStatus(): React.JSX.Element | null {
  const op = useRemoteOp()
  const { cancelRemote } = useGitActions()
  if (!op) return null
  const label = op.kind === 'fetch' ? 'Fetching' : op.kind === 'push' ? 'Pushing' : 'Pulling'
  return <div className="remote-operation-status" role="status" aria-live="polite">
    <span>{op.cancelling ? 'Cancelling…' : `${label}${op.phase ? ` · ${op.phase}` : '…'}${op.percent !== null ? ` ${op.percent}%` : ''}`}</span>
    <Button disabled={!op.cancellable || op.cancelling} onClick={cancelRemote}>Cancel {op.kind}</Button>
  </div>
}
