import { createContext, useCallback, useMemo, useState } from 'react'
import type React from 'react'
import type { ProviderAccount, UpdateStatus } from '@shared/ipc'
import { useRequiredContext } from './context'

export interface AppStatus {
  /** A repository-wide Git action is running; most Git controls are disabled meanwhile. */
  busy: boolean
  /** Message for the app-level error banner. */
  error: string | null
  accounts: ProviderAccount[]
  updateStatus: UpdateStatus | null
}

export interface AppStatusActions {
  /** Marks one action as started (true) or finished (false); `busy` holds while any of them runs. */
  setBusy: (busy: boolean) => void
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setAccounts: React.Dispatch<React.SetStateAction<ProviderAccount[]>>
  setUpdateStatus: React.Dispatch<React.SetStateAction<UpdateStatus | null>>
}

const AppStatusContext = createContext<AppStatus | null>(null)
const AppStatusActionsContext = createContext<AppStatusActions | null>(null)

/** App-wide state that no single repository owns. */
export function AppStatusProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  // A count, not a flag: when actions overlap (a refresh during a fetch), the first to finish must not
  // re-enable controls while the other is still running.
  const [busyCount, setBusyCount] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<ProviderAccount[]>([])
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)
  const busy = busyCount > 0

  const setBusy = useCallback((started: boolean): void => {
    setBusyCount((count) => Math.max(0, count + (started ? 1 : -1)))
  }, [])

  const state = useMemo<AppStatus>(
    () => ({ busy, error, accounts, updateStatus }),
    [busy, error, accounts, updateStatus]
  )
  const actions = useMemo<AppStatusActions>(
    () => ({ setBusy, setError, setAccounts, setUpdateStatus }),
    [setBusy]
  )

  return (
    <AppStatusActionsContext.Provider value={actions}>
      <AppStatusContext.Provider value={state}>{children}</AppStatusContext.Provider>
    </AppStatusActionsContext.Provider>
  )
}

export const useAppStatus = (): AppStatus => useRequiredContext(AppStatusContext, 'useAppStatus')

export const useAppStatusActions = (): AppStatusActions =>
  useRequiredContext(AppStatusActionsContext, 'useAppStatusActions')
