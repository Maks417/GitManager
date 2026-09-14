import { createContext, useMemo } from 'react'
import type React from 'react'
import { useWorkingTree } from '../hooks/useWorkingTree'
import { useAppStatusActions } from './AppStatusProvider'
import { useRequiredContext } from './context'
import { useHistoryState } from './HistoryProvider'
import { useSession, useStatus } from './RepoSessionProvider'
import { useSelection, useSelectionActions } from './SelectionProvider'

export interface WorkingTreeActions {
  selectWorkingCopy: () => void
  selectCommit: (sha: string) => void
  goHistory: () => void
}

const WorkingTreeActionsContext = createContext<WorkingTreeActions | null>(null)

/** Loads commit detail and diffs for the selection, and switches between history and changes. */
export function WorkingTreeProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const selection = useSelection()
  const selectionActions = useSelectionActions()
  const { activeRepo } = useSession()
  const { status } = useStatus()
  const { commits, headSha } = useHistoryState()
  const { setError } = useAppStatusActions()

  const { selectWorkingCopy, selectCommit, goHistory } = useWorkingTree({
    ...selection,
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

  return <WorkingTreeActionsContext.Provider value={actions}>{children}</WorkingTreeActionsContext.Provider>
}

export const useWorkingTreeActions = (): WorkingTreeActions =>
  useRequiredContext(WorkingTreeActionsContext, 'useWorkingTreeActions')
