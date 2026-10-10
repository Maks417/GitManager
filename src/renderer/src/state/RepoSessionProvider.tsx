import { createContext, useCallback, useMemo, useRef } from 'react'
import type React from 'react'
import type { Repository, StatusEntry } from '@shared/ipc'
import { useRepoSession, type HistoryFns } from '../hooks/useRepoSession'
import { useAppStatusActions } from './AppStatusProvider'
import { useRequiredContext } from './context'
import { useDialogActions } from './DialogsProvider'
import { useLayoutActions, useLayoutPrefsState } from './LayoutProvider'
import { useSelectionActions } from './SelectionProvider'

type SessionBundle = ReturnType<typeof useRepoSession>

export type SessionState = Pick<
  SessionBundle,
  | 'repos'
  | 'startupStatus'
  | 'activeRepo'
  | 'branches'
  | 'remoteBranches'
  | 'identity'
  | 'rebaseInProgress'
  | 'sequencerOp'
  | 'mergeInProgress'
  | 'gitMissing'
  | 'currentBranch'
  | 'localBranchNames'
  | 'watchNotice'
  | 'repoPendingRemove'
  | 'repoRemoveBusy'
  | 'repoRemoveError'
  | 'repoRemoveWarning'
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
  | 'setRepoRemoveWarning'
  | 'refreshRepos'
  | 'retryStartup'
  | 'refreshRepoMeta'
  | 'afterGitMutation'
  | 'removeRepoFromList'
> & {
  /** Lets session refreshes reload history, which is provided further down the tree. */
  historyFnsRef: React.RefObject<HistoryFns | null>
}

const SessionContext = createContext<SessionState | null>(null)
const StatusContext = createContext<StatusState | null>(null)
/** Apart from the status, so a refresh that found the same status renders only what reloads diffs. */
const StatusRevisionContext = createContext<number | null>(null)
const SessionActionsContext = createContext<SessionActions | null>(null)

/** Repository list, the active repository, its branches and status, and live-watch refreshes. */
export function RepoSessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { setError, setAccounts, setUpdateStatus } = useAppStatusActions()
  const { prefs } = useLayoutPrefsState()
  const { hydrateFromPrefs } = useLayoutActions()
  const { openDialog } = useDialogActions()
  const { setSelection, setViewMode } = useSelectionActions()
  const historyFnsRef = useRef<HistoryFns | null>(null)
  const onConflictsDetected = useCallback(() => openDialog('mergeEditor'), [openDialog])

  const {
    repos,
    startupStatus,
    retryStartup,
    activeRepo,
    branches,
    remoteBranches,
    identity,
    rebaseInProgress,
    mergeInProgress,
    sequencerOp,
    gitMissing,
    currentBranch,
    localBranchNames,
    watchNotice,
    repoPendingRemove,
    repoRemoveBusy,
    repoRemoveError,
    repoRemoveWarning,
    status,
    statusRevision,
    setActiveRepo,
    getActiveRepo,
    setRemoteBranches,
    setIdentity,
    setRepoPendingRemove,
    setRepoRemoveError,
    setRepoRemoveWarning,
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
      startupStatus,
      activeRepo,
      branches,
      remoteBranches,
      identity,
      rebaseInProgress,
      mergeInProgress,
      sequencerOp,
      gitMissing,
      currentBranch,
      localBranchNames,
      watchNotice,
      repoPendingRemove,
      repoRemoveBusy,
      repoRemoveError,
      repoRemoveWarning
    }),
    [
      repos,
      startupStatus,
      activeRepo,
      branches,
      remoteBranches,
      identity,
      rebaseInProgress,
      mergeInProgress,
      sequencerOp,
      gitMissing,
      currentBranch,
      localBranchNames,
      watchNotice,
      repoPendingRemove,
      repoRemoveBusy,
      repoRemoveError,
      repoRemoveWarning
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
      setRepoRemoveWarning,
      refreshRepos,
      retryStartup,
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
      setRepoRemoveWarning,
      refreshRepos,
      retryStartup,
      refreshRepoMeta,
      afterGitMutation,
      removeRepoFromList
    ]
  )

  return (
    <SessionActionsContext.Provider value={actions}>
      <SessionContext.Provider value={state}>
        <StatusContext.Provider value={statusState}>
          <StatusRevisionContext.Provider value={statusRevision}>{children}</StatusRevisionContext.Provider>
        </StatusContext.Provider>
      </SessionContext.Provider>
    </SessionActionsContext.Provider>
  )
}

export const useSession = (): SessionState => useRequiredContext(SessionContext, 'useSession')

export const useStatus = (): StatusState => useRequiredContext(StatusContext, 'useStatus')

/** Changes with every status refresh, including one that found the same status. */
export const useStatusRevision = (): number => useRequiredContext(StatusRevisionContext, 'useStatusRevision')

export const useSessionActions = (): SessionActions =>
  useRequiredContext(SessionActionsContext, 'useSessionActions')

/** The active repository, for the workspace and dialogs that are only mounted while one is open. */
export function useActiveRepo(): Repository {
  const { activeRepo } = useSession()
  if (!activeRepo) throw new Error('useActiveRepo needs an active repository')
  return activeRepo
}
