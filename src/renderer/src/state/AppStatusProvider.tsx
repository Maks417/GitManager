import { createContext, useMemo, useState } from 'react'
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
  setBusy: React.Dispatch<React.SetStateAction<boolean>>
  setError: React.Dispatch<React.SetStateAction<string | null>>
  setAccounts: React.Dispatch<React.SetStateAction<ProviderAccount[]>>
  setUpdateStatus: React.Dispatch<React.SetStateAction<UpdateStatus | null>>
}

const AppStatusContext = createContext<AppStatus | null>(null)
const AppStatusActionsContext = createContext<AppStatusActions | null>(null)

/** App-wide state that no single repository owns. */
export function AppStatusProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accounts, setAccounts] = useState<ProviderAccount[]>([])
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  const state = useMemo<AppStatus>(
    () => ({ busy, error, accounts, updateStatus }),
    [busy, error, accounts, updateStatus]
  )
  const actions = useMemo<AppStatusActions>(
    () => ({ setBusy, setError, setAccounts, setUpdateStatus }),
    []
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
