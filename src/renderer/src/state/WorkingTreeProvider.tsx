import { createContext, memo, useMemo } from 'react'
import type React from 'react'
import { useWorkingTree } from '../hooks/useWorkingTree'
import { useAppStatusActions } from './AppStatusProvider'
import { useRequiredContext } from './context'
import { useHistoryState } from './HistoryProvider'
import { useSession, useStatus } from './RepoSessionProvider'
import {
  useSelectionActions,
  useSelectionCore,
  useSelectionDetail,
  useSelectionFocus
} from './SelectionProvider'

export interface WorkingTreeActions {
  selectWorkingCopy: () => void
  selectCommit: (sha: string) => void
  goHistory: () => void
}

const WorkingTreeActionsContext = createContext<WorkingTreeActions | null>(null)

const MemoChildren = memo(function MemoChildren({
  children
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <>{children}</>
})

/**
 * Loads commit detail and diffs for the selection, and switches between history and changes.
 * Children are memoized so status/focus churn in this provider does not re-render Git actions.
 */
export function WorkingTreeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const core = useSelectionCore()
  const detail = useSelectionDetail()
  const focus = useSelectionFocus()
  const selectionActions = useSelectionActions()
  const { activeRepo } = useSession()
  const { status } = useStatus()
  const { commits, headSha } = useHistoryState()
  const { setError } = useAppStatusActions()

  const { selectWorkingCopy, selectCommit, goHistory } = useWorkingTree({
    ...core,
    ...detail,
    ...focus,
    ...selectionActions,
    activeRepo,
    status,
    commits,
    headSha,
    setError
  })

  const actions = useMemo<WorkingTreeActions>(
    () => ({ selectWorkingCopy, selectCommit, goHistory }),
    [selectWorkingCopy, selectCommit, goHistory]
  )

  return (
    <WorkingTreeActionsContext.Provider value={actions}>
      <MemoChildren>{children}</MemoChildren>
    </WorkingTreeActionsContext.Provider>
  )
}

export const useWorkingTreeActions = (): WorkingTreeActions =>
  useRequiredContext(WorkingTreeActionsContext, 'useWorkingTreeActions')
