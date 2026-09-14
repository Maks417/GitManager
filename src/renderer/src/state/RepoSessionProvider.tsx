import { createContext, useCallback, useMemo, useRef } from 'react'
import type React from 'react'
import type { Repository, StatusEntry } from '@shared/ipc'
import { useRepoSession, type HistoryFns } from '../hooks/useRepoSession'
import { useAppStatusActions } from './AppStatusProvider'
import { useRequiredContext } from './context'
import { useDialogActions } from './DialogsProvider'
import { useLayout } from './LayoutProvider'
import { useSelectionActions } from './SelectionProvider'

type SessionBundle = ReturnType<typeof useRepoSession>

export type SessionState = Pick<
  SessionBundle,
  | 'repos'
  | 'activeRepo'
  | 'branches'
  | 'remoteBranches'
  | 'identity'
  | 'rebaseInProgress'
  | 'mergeInProgress'
  | 'gitMissing'
  | 'currentBranch'
  | 'localBranchNames'
  | 'repoPendingRemove'
  | 'repoRemoveBusy'
  | 'repoRemoveError'
>

/** Kept apart from the session: status changes on every file edit while live watch is on. */
export interface StatusState {
  status: StatusEntry[]
  conflictCount: number
}

export type SessionActions = Pick<
  SessionBundle,
  | 'setActiveRepo'
  | 'getActiveRepo'
  | 'setRemoteBranches'
  | 'setIdentity'
  | 'setRepoPendingRemove'
  | 'setRepoRemoveError'
  | 'refreshRepos'
  | 'refreshRepoMeta'
  | 'afterGitMutation'
  | 'removeRepoFromList'
> & {
  /** Lets session refreshes reload history, which is provided further down the tree. */
  historyFnsRef: React.RefObject<HistoryFns | null>
}

const SessionContext = createContext<SessionState | null>(null)
const StatusContext = createContext<StatusState | null>(null)
const SessionActionsContext = createContext<SessionActions | null>(null)

/** Repository list, the active repository, its branches and status, and live-watch refreshes. */
export function RepoSessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { setError, setAccounts, setUpdateStatus } = useAppStatusActions()
  const { hydrateFromPrefs, prefs } = useLayout()
  const { openDialog } = useDialogActions()
  const { setSelection, setViewMode } = useSelectionActions()
  const historyFnsRef = useRef<HistoryFns | null>(null)
  const onConflictsDetected = useCallback(() => openDialog('mergeEditor'), [openDialog])

  const {
    repos,
    activeRepo,
    branches,
    remoteBranches,
    identity,
    rebaseInProgress,
    mergeInProgress,
    gitMissing,
    currentBranch,
    localBranchNames,
    repoPendingRemove,
    repoRemoveBusy,
    repoRemoveError,
    status,
    setActiveRepo,
    getActiveRepo,
    setRemoteBranches,
    setIdentity,
    setRepoPendingRemove,
    setRepoRemoveError,
    refreshRepos,
    refreshRepoMeta,
    afterGitMutation,
    removeRepoFromList
  } = useRepoSession({
    setError,
    hydrateFromPrefs,
    setAccounts,
    setUpdateStatus,
    historyFnsRef,
    setSelection,
    setViewMode,
    liveStatusWatch: prefs?.liveStatusWatch,
    onConflictsDetected
  })

  const state = useMemo<SessionState>(
    () => ({
      repos,
      activeRepo,
      branches,
      remoteBranches,
      identity,
      rebaseInProgress,
      mergeInProgress,
      gitMissing,
      currentBranch,
      localBranchNames,
      repoPendingRemove,
      repoRemoveBusy,
      repoRemoveError
    }),
    [
      repos,
      activeRepo,
      branches,
      remoteBranches,
      identity,
      rebaseInProgress,
      mergeInProgress,
      gitMissing,
      currentBranch,
      localBranchNames,
      repoPendingRemove,
      repoRemoveBusy,
      repoRemoveError
    ]
  )

  const statusState = useMemo<StatusState>(
    () => ({ status, conflictCount: status.filter((s) => s.conflicted).length }),
    [status]
  )

  const actions = useMemo<SessionActions>(
    () => ({
      setActiveRepo,
      getActiveRepo,
      setRemoteBranches,
      setIdentity,
      setRepoPendingRemove,
      setRepoRemoveError,
      refreshRepos,
      refreshRepoMeta,
      afterGitMutation,
      removeRepoFromList,
      historyFnsRef
    }),
    [
      setActiveRepo,
      getActiveRepo,
      setRemoteBranches,
      setIdentity,
      setRepoPendingRemove,
      setRepoRemoveError,
      refreshRepos,
      refreshRepoMeta,
      afterGitMutation,
      removeRepoFromList
    ]
  )

  return (
    <SessionActionsContext.Provider value={actions}>
      <SessionContext.Provider value={state}>
        <StatusContext.Provider value={statusState}>{children}</StatusContext.Provider>
      </SessionContext.Provider>
    </SessionActionsContext.Provider>
  )
}

export const useSession = (): SessionState => useRequiredContext(SessionContext, 'useSession')

export const useStatus = (): StatusState => useRequiredContext(StatusContext, 'useStatus')

export const useSessionActions = (): SessionActions =>
  useRequiredContext(SessionActionsContext, 'useSessionActions')

/** The active repository, for the workspace and dialogs that are only mounted while one is open. */
export function useActiveRepo(): Repository {
  const { activeRepo } = useSession()
  if (!activeRepo) throw new Error('useActiveRepo needs an active repository')
  return activeRepo
}
